const fs = require('fs');
const path = require('path');

const CREDS_PATH = path.join(__dirname, '..', 'auth_info', 'google-creds.json');

function loadCreds() {
  if (!fs.existsSync(CREDS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCreds(creds) {
  const dir = path.dirname(CREDS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
}

async function ensureFreshToken(creds) {
  const expiryMs = creds.expiry ? new Date(creds.expiry).getTime() : 0;
  if (creds.access_token && Date.now() < expiryMs - 60000) return creds;

  if (!creds.refresh_token || !creds.client_id || !creds.client_secret) {
    throw new Error('Google Calendar: missing refresh_token, client_id, or client_secret');
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Google token refresh failed (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  const updated = {
    ...creds,
    access_token: data.access_token,
    expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  };
  saveCreds(updated);
  return updated;
}

async function authedGet(url, creds) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.access_token}` }
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { error: `Google Calendar API ${resp.status}: ${body}` };
  }
  return resp.json();
}

async function authedPost(url, body, creds) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { error: `Google Calendar API ${resp.status}: ${text}` };
  }
  return resp.json();
}

async function listEvents({ days_ahead = 7, calendar_id = 'primary', max_results = 15 } = {}) {
  const raw = loadCreds();
  if (!raw?.refresh_token && !raw?.access_token) {
    return { error: 'Google Calendar not configured. Paste your token.json in the Integrations tab.' };
  }
  let creds;
  try { creds = await ensureFreshToken(raw); } catch (e) { return { error: e.message }; }

  const now = new Date();
  const end = new Date(now.getTime() + days_ahead * 86400000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    maxResults: String(max_results),
    singleEvents: 'true',
    orderBy: 'startTime'
  });

  const data = await authedGet(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events?${params}`,
    creds
  );
  if (data.error) return data;

  return {
    calendar: calendar_id,
    range_days: days_ahead,
    events: (data.items || []).map(e => ({
      id: e.id,
      title: e.summary || '(no title)',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      all_day: !e.start?.dateTime,
      location: e.location || null,
      description: e.description?.slice(0, 200) || null
    }))
  };
}

async function createEvent({ summary, start_time, end_time, description = '', calendar_id = 'primary' }) {
  const raw = loadCreds();
  if (!raw?.refresh_token && !raw?.access_token) {
    return { error: 'Google Calendar not configured.' };
  }
  let creds;
  try { creds = await ensureFreshToken(raw); } catch (e) { return { error: e.message }; }

  const event = {
    summary,
    description: description || undefined,
    start: { dateTime: new Date(start_time).toISOString(), timeZone: 'America/Toronto' },
    end: { dateTime: new Date(end_time).toISOString(), timeZone: 'America/Toronto' }
  };

  const data = await authedPost(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`,
    event,
    creds
  );
  if (data.error) return data;

  return {
    success: true,
    event_id: data.id,
    title: data.summary,
    start: data.start?.dateTime || data.start?.date,
    link: data.htmlLink
  };
}

async function listCalendars() {
  const raw = loadCreds();
  if (!raw?.refresh_token && !raw?.access_token) {
    return { error: 'Google Calendar not configured.' };
  }
  let creds;
  try { creds = await ensureFreshToken(raw); } catch (e) { return { error: e.message }; }

  const data = await authedGet(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    creds
  );
  if (data.error) return data;

  return {
    calendars: (data.items || []).map(c => ({
      id: c.id,
      name: c.summary,
      primary: c.primary || false,
      access_role: c.accessRole
    }))
  };
}

function isConfigured() {
  const creds = loadCreds();
  return !!(creds?.refresh_token || creds?.access_token);
}

module.exports = { listEvents, createEvent, listCalendars, isConfigured };
