const { getConfig, updateConfig } = require('./config-manager');
const { processBriefing, processLeadHunt, processSocialContent } = require('./agents');
const m365 = require('./tools/m365');
const { popLatestImageBuffer } = require('./tools/image-gen');
const { sendProactiveImage } = require('./whatsapp');

const TZ = 'America/Toronto';

let lastBriefingDate = null;
let lastLeadHuntDate = null;
let lastSocialContentDate = null;
let lastTokenCheckDate = null;
let sendFn = null;

function startScheduler(sendMessageFn) {
  sendFn = sendMessageFn;
  setInterval(tick, 60000);
  // Proactive M365 token refresh every 6 hours to keep refresh token rolling
  setInterval(silentTokenRefresh, 6 * 60 * 60 * 1000);
  // Also refresh once on startup (after 15s to let WhatsApp connect first)
  setTimeout(silentTokenRefresh, 15000);
  console.log('[SCHEDULER] Morning briefing scheduler started');
}

// Silently refresh M365 token in background — keeps 90-day expiry clock reset
async function silentTokenRefresh() {
  if (!m365.isConfigured()) return;
  try {
    const result = await m365.listTodos({ list_name: 'Tasks', top: 1 });
    if (result?.error) {
      console.warn('[SCHEDULER] Silent M365 refresh failed:', result.error);
    } else {
      console.log('[SCHEDULER] M365 token refreshed silently');
    }
  } catch (err) {
    console.warn('[SCHEDULER] Silent M365 refresh error:', err.message);
  }
}

async function tick() {
  try {
    const config = getConfig();
    const tz = config.schedule?.timezone || TZ;
    const now = new Date();
    const hhmm = now.toLocaleTimeString('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const today = now.toLocaleDateString('en-CA', { timeZone: tz });

    // Daily M365 token health check at 07:55 (5 min before briefing)
    if (hhmm === '07:55' && lastTokenCheckDate !== today) {
      lastTokenCheckDate = today;
      await checkM365Token(config);
    }

    // Morning briefing
    if (config.schedule?.morningBriefingEnabled) {
      const briefingTime = config.schedule.morningBriefingTime || '08:00';
      if (hhmm === briefingTime && lastBriefingDate !== today) {
        lastBriefingDate = today;
        console.log('[SCHEDULER] Sending morning briefing for', today);
        await runBriefing(config);
      }
    }

    // Daily lead hunt
    if (config.schedule?.leadHuntEnabled) {
      const leadTime = config.schedule.leadHuntTime || '09:00';
      if (hhmm === leadTime && lastLeadHuntDate !== today) {
        lastLeadHuntDate = today;
        console.log('[SCHEDULER] Running daily lead hunt for', today);
        await runLeadHunt(config);
      }
    }

    // Daily social content generation
    if (config.schedule?.socialContentEnabled) {
      const socialTime = config.schedule.socialContentTime || '07:00';
      if (hhmm === socialTime && lastSocialContentDate !== today) {
        lastSocialContentDate = today;
        console.log('[SCHEDULER] Generating daily social content for', today);
        await runSocialContent(config);
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] tick error:', err.message);
  }
}

async function checkM365Token(config) {
  if (!m365.isConfigured()) return;
  try {
    const result = await m365.listTodos({ list_name: 'Tasks', top: 1 });
    if (result?.error) {
      console.error('[SCHEDULER] M365 token check FAILED:', result.error);
      if (config.mainNumber && sendFn) {
        await sendFn(config.mainNumber,
          '⚠️ M365 connection issue detected. Tasks and calendar may not work. Check Railway logs for details.'
        );
      }
    } else {
      console.log('[SCHEDULER] M365 token check OK');
    }
  } catch (err) {
    console.error('[SCHEDULER] M365 token check error:', err.message);
  }
}

async function runBriefing(config) {
  const mainNumber = config.mainNumber;
  if (!mainNumber || !sendFn) return;
  try {
    const summary = await processBriefing();
    if (summary) {
      await sendFn(mainNumber, summary);
      console.log('[SCHEDULER] Morning briefing sent to', mainNumber);
    }
  } catch (err) {
    console.error('[SCHEDULER] Briefing failed:', err.message);
  }
}

async function runLeadHunt(config) {
  const mainNumber = config.mainNumber;
  if (!mainNumber || !sendFn) return;
  try {
    const leads = await processLeadHunt();
    if (leads) {
      await sendFn(mainNumber, leads);
      console.log('[SCHEDULER] Lead hunt sent to', mainNumber);
    }
  } catch (err) {
    console.error('[SCHEDULER] Lead hunt failed:', err.message);
  }
}

async function runSocialContent(config) {
  const mainNumber = config.mainNumber;
  if (!mainNumber || !sendFn) return;
  try {
    const reply = await processSocialContent();
    if (!reply) return;

    const cleanText = reply.replace(/\[IMAGE_ID:[^\]]*\]/gi, '').trim();

    // Send image first so it arrives before the text summary
    const buf = popLatestImageBuffer();
    if (buf) {
      await sendProactiveImage(mainNumber, buf, '');
      console.log('[SCHEDULER] Social content image sent to', mainNumber);
    }

    if (cleanText) {
      await sendFn(mainNumber, cleanText);
      console.log('[SCHEDULER] Social content summary sent to', mainNumber);
    }
  } catch (err) {
    console.error('[SCHEDULER] Social content failed:', err.message);
  }
}

module.exports = { startScheduler };
