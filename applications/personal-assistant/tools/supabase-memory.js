const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABLE = 'claudia_memory';

// In-memory cache — populated on module load so buildSystemPrompt stays synchronous
let _cache = {};

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function sbHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function sbFetch(path, options = {}) {
  if (!isConfigured()) return { error: 'Supabase not configured. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to Railway env vars.' };
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: { ...sbHeaders(), ...(options.headers || {}) }
    });
    if (resp.status === 204) return { success: true };
    const body = await resp.text();
    if (!resp.ok) return { error: `Supabase ${resp.status}: ${body.slice(0, 200)}` };
    if (!body) return { success: true };
    return JSON.parse(body);
  } catch (err) {
    return { error: err.message };
  }
}

async function loadCache() {
  if (!isConfigured()) return;
  const data = await sbFetch(`${TABLE}?select=key,value,category&order=updated_at.desc&limit=200`);
  if (!Array.isArray(data)) { console.error('[MEMORY] Cache load failed:', data?.error); return; }
  _cache = {};
  for (const row of data) _cache[row.key] = { value: row.value, category: row.category || null };
  console.log(`[MEMORY] Cache loaded — ${data.length} entries`);
}

// Load cache immediately when module is first required
loadCache().catch(err => console.error('[MEMORY] Cache init error:', err.message));

// Synchronous read for system prompt injection
function getMemorySync(category = null) {
  const entries = Object.entries(_cache);
  const filtered = category ? entries.filter(([, v]) => v.category === category) : entries;
  return Object.fromEntries(filtered.map(([k, v]) => [k, v.value]));
}

async function saveMemory({ key, value, category = null }) {
  if (!key || !value) return { error: 'key and value are required' };
  const k = String(key).trim().toLowerCase();
  const v = String(value).trim();
  const cat = category ? String(category).trim().toLowerCase() : null;

  const data = await sbFetch(TABLE, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: k, value: v, ...(cat ? { category: cat } : {}), updated_at: new Date().toISOString() })
  });
  if (data?.error) return data;

  _cache[k] = { value: v, category: cat };
  console.log(`[MEMORY] Saved: "${k}" = "${v}"${cat ? ` (${cat})` : ''}`);
  return { success: true, key: k, value: v };
}

async function recallMemory({ key }) {
  if (!key) return { error: 'key required' };
  const k = String(key).trim().toLowerCase();

  // Check cache first
  if (_cache[k]) return { key: k, value: _cache[k].value, category: _cache[k].category };

  // Partial cache match
  const partialEntry = Object.entries(_cache).find(([ck]) => ck.includes(k) || k.includes(ck));
  if (partialEntry) return { key: partialEntry[0], value: partialEntry[1].value, category: partialEntry[1].category, note: 'partial match' };

  // Fall back to Supabase search
  const data = await sbFetch(`${TABLE}?key=ilike.*${encodeURIComponent(k)}*&select=key,value,category&limit=3`);
  if (!Array.isArray(data) || data.length === 0) return { found: false, key: k };
  return { key: data[0].key, value: data[0].value, category: data[0].category };
}

async function searchMemory({ query, category = null }) {
  if (!query) return { error: 'query required' };
  const q = String(query).trim();
  const enc = encodeURIComponent(q);
  let path = `${TABLE}?or=(key.ilike.*${enc}*,value.ilike.*${enc}*)&select=key,value,category&order=updated_at.desc&limit=10`;
  if (category) path += `&category=eq.${encodeURIComponent(category.toLowerCase())}`;

  const data = await sbFetch(path);
  if (!Array.isArray(data)) return data;
  return { query, count: data.length, results: data.map(r => ({ key: r.key, value: r.value, category: r.category })) };
}

async function listMemory({ category = null } = {}) {
  let path = `${TABLE}?select=key,value,category&order=updated_at.desc&limit=50`;
  if (category) path += `&category=eq.${encodeURIComponent(category.toLowerCase())}`;

  const data = await sbFetch(path);
  if (!Array.isArray(data)) return data;
  return { count: data.length, facts: data.map(r => ({ key: r.key, value: r.value, category: r.category })) };
}

async function deleteMemory({ key }) {
  if (!key) return { error: 'key required' };
  const k = String(key).trim().toLowerCase();
  const data = await sbFetch(`${TABLE}?key=eq.${encodeURIComponent(k)}`, {
    method: 'DELETE',
    headers: { 'Prefer': 'return=minimal' }
  });
  if (data?.error) return data;
  delete _cache[k];
  return { success: true, key: k };
}

module.exports = { saveMemory, recallMemory, searchMemory, listMemory, deleteMemory, getMemorySync, isConfigured, loadCache };
