'use strict';
const fs = require('fs');
const path = require('path');

const REMINDERS_PATH = path.join(__dirname, '..', 'auth_info', 'reminders.json');

function loadReminders() {
  try {
    if (!fs.existsSync(REMINDERS_PATH)) return [];
    return JSON.parse(fs.readFileSync(REMINDERS_PATH, 'utf-8'));
  } catch { return []; }
}

function saveReminders(list) {
  const dir = path.dirname(REMINDERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(list, null, 2));
}

let _nextId = null;
function allocateId() {
  if (_nextId === null) {
    const list = loadReminders();
    _nextId = list.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  }
  return _nextId++;
}

function parseAt(at) {
  // Already an ISO string?
  if (/^\d{4}-\d{2}-\d{2}T/.test(at)) return new Date(at);

  const lower = at.toLowerCase().trim();
  const now = new Date();

  const mins = lower.match(/(\d+)\s*min/);
  const hours = lower.match(/(\d+)\s*h(our)?/);
  const days = lower.match(/(\d+)\s*day/);
  const weeks = lower.match(/(\d+)\s*week/);

  if (mins) { now.setMinutes(now.getMinutes() + parseInt(mins[1])); return now; }
  if (hours) { now.setHours(now.getHours() + parseInt(hours[1])); return now; }
  if (days) { now.setDate(now.getDate() + parseInt(days[1])); return now; }
  if (weeks) { now.setDate(now.getDate() + parseInt(weeks[1]) * 7); return now; }

  const parsed = new Date(at);
  return isNaN(parsed.getTime()) ? null : parsed;
}

async function setReminder({ message, at, recipient_jid, repeat = 'none' }) {
  if (!message) return { error: 'message is required' };
  if (!at) return { error: 'at (time) is required — use ISO datetime (2025-06-24T14:00:00) or relative (30 min, 2 hours, 1 day)' };

  const due = parseAt(at);
  if (!due) return { error: `Could not parse time "${at}". Use ISO format or relative (30 min, 2 hours, 1 day, 1 week)` };

  const validRepeats = ['none', 'daily', 'weekly'];
  if (!validRepeats.includes(repeat)) return { error: `repeat must be one of: ${validRepeats.join(', ')}` };

  const list = loadReminders();
  const id = allocateId();
  const reminder = {
    id,
    message,
    due_at: due.toISOString(),
    recipient_jid: recipient_jid || null,
    repeat,
    created_at: new Date().toISOString(),
    sent: false,
  };
  list.push(reminder);
  saveReminders(list);

  console.log(`[REMINDER] Set #${id}: "${message}" at ${due.toISOString()} (repeat=${repeat})`);
  return { success: true, reminder_id: id, message, due_at: due.toISOString(), repeat };
}

function listReminders({ include_sent = false } = {}) {
  const list = loadReminders();
  const active = list.filter(r => !r.sent || r.repeat !== 'none');
  const shown = include_sent ? list : active;
  return {
    count: shown.length,
    reminders: shown.map(r => ({
      id: r.id,
      message: r.message,
      due_at: r.due_at,
      repeat: r.repeat,
      sent: r.sent,
    })),
  };
}

function cancelReminder({ id }) {
  if (id == null) return { error: 'id is required' };
  const list = loadReminders();
  const idx = list.findIndex(r => r.id === Number(id) || r.id === id);
  if (idx === -1) return { error: `Reminder #${id} not found` };
  const [removed] = list.splice(idx, 1);
  saveReminders(list);
  return { success: true, cancelled: removed.message };
}

// Called by scheduler every tick — returns reminders that are now due and advances their next fire time
function popDueReminders(defaultJid = null) {
  const list = loadReminders();
  const now = new Date();
  const due = [];
  let changed = false;

  for (const r of list) {
    if (r.sent && r.repeat === 'none') continue;
    if (new Date(r.due_at) <= now) {
      due.push({ ...r, jid: r.recipient_jid || defaultJid });
      if (r.repeat === 'daily') {
        const next = new Date(r.due_at);
        next.setDate(next.getDate() + 1);
        r.due_at = next.toISOString();
        r.sent = false;
      } else if (r.repeat === 'weekly') {
        const next = new Date(r.due_at);
        next.setDate(next.getDate() + 7);
        r.due_at = next.toISOString();
        r.sent = false;
      } else {
        r.sent = true;
      }
      changed = true;
    }
  }

  if (changed) saveReminders(list);
  return due;
}

module.exports = { setReminder, listReminders, cancelReminder, popDueReminders };
