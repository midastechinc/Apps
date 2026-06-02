const { getConfig } = require('./config-manager');
const { processBriefing } = require('./agents');
const m365 = require('./tools/m365');

const TZ = 'America/Toronto';

let lastBriefingDate = null;
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

    if (!config.schedule?.morningBriefingEnabled) return;
    const target = config.schedule.morningBriefingTime || '08:00';
    if (hhmm !== target || lastBriefingDate === today) return;

    lastBriefingDate = today;
    console.log('[SCHEDULER] Sending morning briefing for', today);
    await runBriefing(config);
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
          '⚠️ M365 token issue detected. Tasks and calendar may not work. Run fix_m365.py to reconnect.'
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
  if (!mainNumber || !sendFn) {
    console.log('[SCHEDULER] Skipping briefing — no mainNumber or sendFn');
    return;
  }

  try {
    const summary = await processBriefing();
    if (summary) {
      const dayName = new Date().toLocaleDateString('en-CA', { timeZone: TZ, weekday: 'long' });
      await sendFn(mainNumber, `Good morning! Here's your ${dayName} briefing:\n\n${summary}`);
      console.log('[SCHEDULER] Morning briefing sent to', mainNumber);
    }
  } catch (err) {
    console.error('[SCHEDULER] Briefing failed:', err.message);
  }
}

module.exports = { startScheduler };


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

    if (!config.schedule?.morningBriefingEnabled) return;
    const target = config.schedule.morningBriefingTime || '08:00';
    if (hhmm !== target || lastBriefingDate === today) return;

    lastBriefingDate = today;
    console.log('[SCHEDULER] Sending morning briefing for', today);
    await runBriefing(config);
  } catch (err) {
    console.error('[SCHEDULER] tick error:', err.message);
  }
}

async function checkM365Token(config) {
  if (!m365.isConfigured()) return;
  try {
    // Light API call — just fetch user profile to verify token is valid
    const result = await m365.listTodos({ list_name: 'Tasks', top: 1 });
    if (result?.error) {
      console.error('[SCHEDULER] M365 token check FAILED:', result.error);
      if (config.mainNumber && sendFn) {
        await sendFn(config.mainNumber,
          '⚠️ M365 token issue detected. Tasks and calendar may not work. Run fix_m365.py to reconnect.'
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
  if (!mainNumber || !sendFn) {
    console.log('[SCHEDULER] Skipping briefing — no mainNumber or sendFn');
    return;
  }

  try {
    const summary = await processBriefing();
    if (summary) {
      const dayName = new Date().toLocaleDateString('en-CA', { timeZone: TZ, weekday: 'long' });
      await sendFn(mainNumber, `Good morning! Here's your ${dayName} briefing:\n\n${summary}`);
      console.log('[SCHEDULER] Morning briefing sent to', mainNumber);
    }
  } catch (err) {
    console.error('[SCHEDULER] Briefing failed:', err.message);
  }
}

module.exports = { startScheduler };
