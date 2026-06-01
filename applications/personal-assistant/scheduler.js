const { getConfig } = require('./config-manager');
const { processBriefing } = require('./agents');

const TZ = 'America/Toronto';

let lastBriefingDate = null;
let sendFn = null;

function startScheduler(sendMessageFn) {
  sendFn = sendMessageFn;
  setInterval(tick, 60000);
  console.log('[SCHEDULER] Morning briefing scheduler started');
}

async function tick() {
  try {
    const config = getConfig();
    if (!config.schedule?.morningBriefingEnabled) return;

    const tz = config.schedule.timezone || TZ;
    const now = new Date();
    const hhmm = now.toLocaleTimeString('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const today = now.toLocaleDateString('en-CA', { timeZone: tz });
    const target = config.schedule.morningBriefingTime || '08:00';

    if (hhmm !== target || lastBriefingDate === today) return;

    lastBriefingDate = today;
    console.log('[SCHEDULER] Sending morning briefing for', today);
    await runBriefing(config);
  } catch (err) {
    console.error('[SCHEDULER] tick error:', err.message);
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
