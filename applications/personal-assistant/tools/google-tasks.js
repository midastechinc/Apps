const fs = require('fs');
const path = require('path');

const CREDS_PATH = path.join(__dirname, '..', 'auth_info', 'google-creds.json');

function loadCreds() {
  if (!fs.existsSync(CREDS_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8')); } catch { return null; }
}

function saveCreds(creds) {
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
}

async function ensureFreshToken(creds) {
  const expiryMs = creds.expiry ? new Date(creds.expiry).getTime() : 0;
  if (creds.access_token && Date.now() < expiryMs - 60000) return creds;
  if (!creds.refresh_token || !creds.client_id || !creds.client_secret) {
    throw new Error('Google Tasks: missing refresh_token, client_id, or client_secret. Re-authenticate via /api/auth/google.');
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
    let parsed; try { parsed = JSON.parse(body); } catch {}
    if (parsed?.error === 'invalid_grant') throw new Error('Google token expired. Re-authenticate at /api/auth/google.');
    throw new Error(`Google token refresh failed (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  const updated = { ...creds, access_token: data.access_token, expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString() };
  saveCreds(updated);
  return updated;
}

async function tasksFetch(path, options = {}) {
  const raw = loadCreds();
  if (!raw) return { error: 'Google not connected. Authenticate at /api/auth/google.' };
  let creds;
  try { creds = await ensureFreshToken(raw); } catch (e) { return { error: e.message }; }
  const resp = await fetch(`https://tasks.googleapis.com/tasks/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${creds.access_token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (resp.status === 204) return {};
  const text = await resp.text();
  if (!resp.ok) {
    // Scope error means token doesn't have Tasks permission — guide re-auth
    if (resp.status === 403 || resp.status === 401) {
      return { error: 'Google Tasks not authorized. Re-authenticate at: https://apps-production-e6cc.up.railway.app/api/auth/google?key=ADMIN_KEY (Tasks scope has been added to the auth flow).' };
    }
    return { error: `Google Tasks API ${resp.status}: ${text}` };
  }
  try { return JSON.parse(text); } catch { return {}; }
}

async function listTaskLists() {
  const data = await tasksFetch('/users/@me/lists?maxResults=20');
  if (data.error) return data;
  return { lists: (data.items || []).map(l => ({ id: l.id, title: l.title })) };
}

async function listTasks({ list_name = 'My Tasks', show_completed = false } = {}) {
  const listsData = await tasksFetch('/users/@me/lists?maxResults=20');
  if (listsData.error) return listsData;
  const lists = listsData.items || [];
  const list = lists.find(l => l.title.toLowerCase().includes(list_name.toLowerCase()))
    || lists.find(l => l.title === 'My Tasks')
    || lists[0];
  if (!list) return { error: 'No task lists found.' };

  const params = new URLSearchParams({ maxResults: '50', showCompleted: String(show_completed), showHidden: 'false' });
  const data = await tasksFetch(`/lists/${list.id}/tasks?${params}`);
  if (data.error) return data;
  return {
    list: list.title,
    tasks: (data.items || [])
      .filter(t => show_completed || t.status !== 'completed')
      .map(t => ({ id: t.id, title: t.title, notes: t.notes || null, due: t.due || null, status: t.status, updated: t.updated }))
  };
}

async function createTask({ title, notes = '', due = null, list_name = 'My Tasks' }) {
  if (!title) return { error: 'title is required' };
  const listsData = await tasksFetch('/users/@me/lists?maxResults=20');
  if (listsData.error) return listsData;
  const lists = listsData.items || [];
  const list = lists.find(l => l.title.toLowerCase().includes(list_name.toLowerCase()))
    || lists.find(l => l.title === 'My Tasks')
    || lists[0];
  if (!list) return { error: 'No task lists found.' };

  const body = { title };
  if (notes) body.notes = notes;
  if (due) body.due = new Date(due).toISOString();

  const data = await tasksFetch(`/lists/${list.id}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (data.error) return data;
  console.log(`[Google Tasks] Created: "${title}" in "${list.title}"`);
  return { success: true, id: data.id, title: data.title, list: list.title };
}

async function completeTask({ task_id, list_name = 'My Tasks' }) {
  if (!task_id) return { error: 'task_id is required' };
  const listsData = await tasksFetch('/users/@me/lists?maxResults=20');
  if (listsData.error) return listsData;
  const lists = listsData.items || [];
  const list = lists.find(l => l.title.toLowerCase().includes(list_name.toLowerCase()))
    || lists.find(l => l.title === 'My Tasks')
    || lists[0];
  if (!list) return { error: 'No task lists found.' };

  const data = await tasksFetch(`/lists/${list.id}/tasks/${task_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  });
  if (data.error) return data;
  return { success: true, id: data.id, title: data.title, status: 'completed' };
}

function isConfigured() {
  const raw = loadCreds();
  return !!(raw?.refresh_token || raw?.access_token);
}

module.exports = { listTaskLists, listTasks, createTask, completeTask, isConfigured };
