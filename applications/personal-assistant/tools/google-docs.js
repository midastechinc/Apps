const fs = require('fs');
const path = require('path');

const CREDS_PATH = path.join(__dirname, '..', 'auth_info', 'google-creds.json');
const DOCS_API = 'https://docs.googleapis.com/v1/documents';

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
    throw new Error('Google Docs: missing OAuth credentials in google-creds.json');
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
    const parsed = JSON.parse(body).catch?.() || {};
    if (parsed?.error === 'invalid_grant') throw new Error('Google token expired — re-authenticate via management UI → Integrations → Google Calendar.');
    throw new Error(`Token refresh failed (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  const updated = { ...creds, access_token: data.access_token, expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString() };
  saveCreds(updated);
  return updated;
}

async function authedFetch(url, options, creds) {
  const resp = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${creds.access_token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await resp.text();
  if (!resp.ok) return { error: `Google Docs API ${resp.status}: ${body.slice(0, 300)}` };
  return body ? JSON.parse(body) : { success: true };
}

// Build batchUpdate requests to insert text into a document
function buildInsertRequests(content) {
  if (!content || !content.trim()) return [];
  // Insert at end of document (index 1 = after the title newline)
  return [{
    insertText: {
      location: { index: 1 },
      text: content
    }
  }];
}

async function createDoc({ title, content = '' }) {
  if (!title) return { error: 'title is required' };
  const raw = loadCreds();
  if (!raw) return { error: 'Google credentials not configured. Set up Google Calendar integration first.' };

  let creds;
  try { creds = await ensureFreshToken(raw); } catch (err) { return { error: err.message }; }

  // 1. Create empty document
  const doc = await authedFetch(DOCS_API, {
    method: 'POST',
    body: JSON.stringify({ title })
  }, creds);

  if (doc.error) return doc;
  const docId = doc.documentId;
  const url = `https://docs.google.com/document/d/${docId}/edit`;

  // 2. Insert content if provided
  if (content && content.trim()) {
    const requests = buildInsertRequests(content.trim());
    const updateResult = await authedFetch(`${DOCS_API}/${docId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests })
    }, creds);
    if (updateResult.error) {
      // Doc was created but content failed — still return the URL
      return { success: true, documentId: docId, url, title, warning: `Doc created but content write failed: ${updateResult.error}` };
    }
  }

  console.log(`[GDOCS] Created: "${title}" → ${url}`);
  return { success: true, documentId: docId, url, title };
}

async function appendToDoc({ documentId, content }) {
  if (!documentId || !content) return { error: 'documentId and content are required' };
  const raw = loadCreds();
  if (!raw) return { error: 'Google credentials not configured.' };

  let creds;
  try { creds = await ensureFreshToken(raw); } catch (err) { return { error: err.message }; }

  // Get current doc to find end index
  const doc = await authedFetch(`${DOCS_API}/${documentId}`, { method: 'GET' }, creds);
  if (doc.error) return doc;

  const endIndex = doc.body?.content?.slice(-1)[0]?.endIndex || 1;
  const insertIndex = Math.max(1, endIndex - 1);

  const result = await authedFetch(`${DOCS_API}/${documentId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ insertText: { location: { index: insertIndex }, text: '\n' + content } }] })
  }, creds);

  if (result.error) return result;
  return { success: true, documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
}

function isConfigured() {
  const creds = loadCreds();
  return !!(creds?.refresh_token && creds?.client_id);
}

module.exports = { createDoc, appendToDoc, isConfigured };
