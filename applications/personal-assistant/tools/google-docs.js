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

async function resolveDocId(raw, creds, input) {
  let id = parseDocId(input);
  if (!id || id.includes(' ') || id.length < 20) {
    const searchResult = await searchDrive({ query: input });
    if (searchResult.error) return { error: searchResult.error };
    if (!searchResult.files || searchResult.files.length === 0) {
      return { error: `No Google Doc found with name matching "${input}"` };
    }
    id = searchResult.files[0].id || searchResult.files[0].documentId;
    console.log(`[GDOCS] Resolved name "${input}" → ID ${id}`);
  }
  return { id };
}

async function appendToDoc({ documentId, content }) {
  if (!documentId || !content) return { error: 'documentId and content are required' };
  const raw = loadCreds();
  if (!raw) return { error: 'Google credentials not configured.' };

  let creds;
  try { creds = await ensureFreshToken(raw); } catch (err) { return { error: err.message }; }

  const resolved = await resolveDocId(raw, creds, documentId);
  if (resolved.error) return resolved;
  const id = resolved.id;

  // Get current doc to find end index
  const doc = await authedFetch(`${DOCS_API}/${id}`, { method: 'GET' }, creds);
  if (doc.error) return doc;

  const endIndex = doc.body?.content?.slice(-1)[0]?.endIndex || 1;
  const insertIndex = Math.max(1, endIndex - 1);

  const result = await authedFetch(`${DOCS_API}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ insertText: { location: { index: insertIndex }, text: '\n' + content } }] })
  }, creds);

  if (result.error) return result;
  return { success: true, documentId: id, url: `https://docs.google.com/document/d/${id}/edit` };
}

// Update doc: find-and-replace pairs OR full rewrite with newContent
async function updateDoc({ documentId, replacements = [], newContent = null }) {
  if (!documentId) return { error: 'documentId (or doc name) is required' };
  if (!replacements.length && !newContent) return { error: 'provide replacements array or newContent to rewrite' };

  const raw = loadCreds();
  if (!raw) return { error: 'Google credentials not configured.' };

  let creds;
  try { creds = await ensureFreshToken(raw); } catch (err) { return { error: err.message }; }

  const resolved = await resolveDocId(raw, creds, documentId);
  if (resolved.error) return resolved;
  const id = resolved.id;

  let requests = [];

  if (newContent !== null) {
    // Full rewrite: delete all existing content then insert new
    const doc = await authedFetch(`${DOCS_API}/${id}`, { method: 'GET' }, creds);
    if (doc.error) return doc;
    const endIndex = doc.body?.content?.slice(-1)[0]?.endIndex || 2;
    if (endIndex > 2) {
      requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
    }
    if (newContent.trim()) {
      requests.push({ insertText: { location: { index: 1 }, text: newContent.trim() } });
    }
  } else {
    // Find-and-replace
    for (const { find, replace } of replacements) {
      if (!find) continue;
      requests.push({
        replaceAllText: {
          containsText: { text: find, matchCase: false },
          replaceText: replace || ''
        }
      });
    }
  }

  if (!requests.length) return { error: 'No valid operations to perform' };

  const result = await authedFetch(`${DOCS_API}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests })
  }, creds);

  if (result.error) return result;
  console.log(`[GDOCS] Updated doc ${id} (${newContent !== null ? 'rewrite' : replacements.length + ' replacements'})`);
  return { success: true, documentId: id, url: `https://docs.google.com/document/d/${id}/edit` };
}

function isConfigured() {
  const creds = loadCreds();
  return !!(creds?.refresh_token && creds?.client_id);
}

// Extract plain text from Google Docs body content structure
function extractText(content = [], maxChars = 6000) {
  const lines = [];
  for (const el of content) {
    if (el.paragraph) {
      const line = (el.paragraph.elements || [])
        .map(e => e.textRun?.content || '')
        .join('');
      if (line.trim()) lines.push(line.trimEnd());
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          lines.push(...(cell.content || [])
            .filter(c => c.paragraph)
            .map(c => (c.paragraph.elements || []).map(e => e.textRun?.content || '').join('').trimEnd())
            .filter(Boolean));
        }
      }
    }
  }
  const full = lines.join('\n');
  return full.length > maxChars ? full.slice(0, maxChars) + '\n...(truncated)' : full;
}

// Extract document ID from a URL or return as-is if already an ID
function parseDocId(input) {
  if (!input) return null;
  const match = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input.trim();
}

async function readDoc({ documentId }) {
  if (!documentId) return { error: 'documentId, URL, or document name required' };
  const raw = loadCreds();
  if (!raw) return { error: 'Google credentials not configured.' };

  let creds;
  try { creds = await ensureFreshToken(raw); } catch (err) { return { error: err.message }; }

  // Try to parse as URL or ID first
  let id = parseDocId(documentId);

  // If it doesn't look like a real ID (too short or has spaces), search by name
  if (!id || id.includes(' ') || id.length < 20) {
    const searchResult = await searchDrive({ query: documentId });
    if (searchResult.error) return searchResult;
    if (!searchResult.files || searchResult.files.length === 0) {
      return { error: `No Google Doc found with name matching "${documentId}"` };
    }
    id = searchResult.files[0].id || searchResult.files[0].documentId;
    console.log(`[GDOCS] Resolved name "${documentId}" → ID ${id}`);
  }

  const doc = await authedFetch(`${DOCS_API}/${id}`, { method: 'GET' }, creds);
  if (doc.error) {
    console.error(`[GDOCS] readDoc failed for id=${id}:`, doc.error);
    if (doc.error.includes('404')) {
      return { error: `Document not found (404). The doc "${documentId}" may not exist yet or may have been deleted. If this is the recipe book, create it first via /api/create-recipe-book.` };
    }
    return doc;
  }

  const text = extractText(doc.body?.content || []);
  return {
    documentId: id,
    title: doc.title,
    url: `https://docs.google.com/document/d/${id}/edit`,
    content: text,
    charCount: text.length
  };
}

async function searchDrive({ query = '', type = 'document' } = {}) {
  const raw = loadCreds();
  if (!raw) return { error: 'Google credentials not configured.' };

  let creds;
  try { creds = await ensureFreshToken(raw); } catch (err) { return { error: err.message }; }

  const mimeType = type === 'spreadsheet'
    ? 'application/vnd.google-apps.spreadsheet'
    : 'application/vnd.google-apps.document';

  // If no query, list all docs; otherwise filter by name
  const filter = query.trim()
    ? `name contains '${query.trim()}' and mimeType='${mimeType}' and trashed=false`
    : `mimeType='${mimeType}' and trashed=false`;

  const q = encodeURIComponent(filter);
  const pageSize = query.trim() ? 10 : 30;
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=${pageSize}`;

  const result = await authedFetch(url, { method: 'GET' }, creds);
  if (result.error) return result;

  const files = (result.files || []).map(f => ({
    documentId: f.id,
    name: f.name,
    url: f.webViewLink,
    modified: f.modifiedTime
  }));

  return { query: query || '(all)', count: files.length, files };
}

module.exports = { createDoc, appendToDoc, updateDoc, readDoc, searchDrive, isConfigured };
