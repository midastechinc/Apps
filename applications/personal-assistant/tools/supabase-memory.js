const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABLE = 'claudia_memory';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = 'text-embedding-3-small'; // 1536 dims, cheap

// In-memory cache — populated on module load so buildSystemPrompt stays synchronous
let _cache = {};
let _cacheLoadedAt = 0; // epoch ms of last successful load

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function embeddingsEnabled() {
  return !!OPENAI_KEY;
}

// Generate an embedding vector for a string via OpenAI. Returns number[] or null on failure.
async function generateEmbedding(text) {
  if (!OPENAI_KEY || !text) return null;
  try {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ input: String(text).slice(0, 8000), model: EMBED_MODEL }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      console.warn(`[MEMORY] Embedding failed: ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn(`[MEMORY] Embedding error: ${err.message}`);
    return null;
  }
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
  const data = await sbFetch(`${TABLE}?select=key,value,category&order=updated_at.desc&limit=500`);
  if (!Array.isArray(data)) { console.error('[MEMORY] Cache load failed:', data?.error); return; }
  _cache = {};
  for (const row of data) _cache[row.key] = { value: row.value, category: row.category || null };
  _cacheLoadedAt = Date.now();
  console.log(`[MEMORY] Cache loaded — ${data.length} entries`);
}

// Refresh if cache is older than 3 minutes (catches facts saved by other sessions or external tools)
async function refreshIfStale(maxAgeMs = 3 * 60 * 1000) {
  if (!isConfigured()) return;
  if (Date.now() - _cacheLoadedAt > maxAgeMs) {
    await loadCache().catch(err => console.warn('[MEMORY] Stale refresh failed:', err.message));
  }
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

  // Embed "key: value" so both the topic and content contribute to semantic match
  const embedding = await generateEmbedding(`${k}: ${v}`);

  const row = { key: k, value: v, ...(cat ? { category: cat } : {}), updated_at: new Date().toISOString() };
  if (embedding) row.embedding = JSON.stringify(embedding); // pgvector accepts the "[...]" string form

  const data = await sbFetch(`${TABLE}?on_conflict=key`, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row)
  });
  if (data?.error) return data;

  _cache[k] = { value: v, category: cat };
  console.log(`[MEMORY] Saved: "${k}" = "${v}"${cat ? ` (${cat})` : ''}${embedding ? ' [embedded]' : ''}`);
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

  // Keyword fallback in Supabase
  const data = await sbFetch(`${TABLE}?key=ilike.*${encodeURIComponent(k)}*&select=key,value,category&limit=3`);
  if (Array.isArray(data) && data.length > 0) {
    return { key: data[0].key, value: data[0].value, category: data[0].category };
  }

  // Semantic fallback — find by meaning when exact/keyword fails
  if (embeddingsEnabled()) {
    const semantic = await semanticSearch({ query: k, count: 1 });
    if (semantic && semantic.length) {
      return { key: semantic[0].key, value: semantic[0].value, category: semantic[0].category, note: 'semantic match' };
    }
  }

  return { found: false, key: k };
}

// Semantic search via embeddings — finds memories by meaning, not keyword
async function semanticSearch({ query, category = null, count = 5 }) {
  const embedding = await generateEmbedding(query);
  if (!embedding) return null; // caller falls back to keyword

  const data = await sbFetch('rpc/match_memories', {
    method: 'POST',
    body: JSON.stringify({
      query_embedding: JSON.stringify(embedding),
      match_count: count,
      filter_category: category ? category.toLowerCase() : null,
    }),
  });
  if (!Array.isArray(data)) return null;
  // Drop weak matches (cosine similarity below 0.3 is usually noise)
  return data.filter(r => (r.similarity ?? 0) > 0.3);
}

async function searchMemory({ query, category = null }) {
  if (!query) return { error: 'query required' };
  const q = String(query).trim();

  // 1. Try semantic search first (matches by meaning)
  if (embeddingsEnabled()) {
    const semantic = await semanticSearch({ query: q, category, count: 10 });
    if (semantic && semantic.length) {
      return {
        query: q,
        count: semantic.length,
        results: semantic.map(r => ({ key: r.key, value: r.value, category: r.category })),
        mode: 'semantic',
      };
    }
  }

  // 2. Fall back to keyword search
  const enc = encodeURIComponent(q);
  let path = `${TABLE}?or=(key.ilike.*${enc}*,value.ilike.*${enc}*)&select=key,value,category&order=updated_at.desc&limit=10`;
  if (category) path += `&category=eq.${encodeURIComponent(category.toLowerCase())}`;

  const data = await sbFetch(path);
  if (!Array.isArray(data)) return data;
  return { query: q, count: data.length, results: data.map(r => ({ key: r.key, value: r.value, category: r.category })), mode: 'keyword' };
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

async function memoryStatus() {
  if (!isConfigured()) return { configured: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_KEY not set in env vars' };
  const testKey = '__status_check__';
  const writeResult = await sbFetch(`${TABLE}?on_conflict=key`, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: testKey, value: 'ok', category: 'system', updated_at: new Date().toISOString() })
  });
  if (writeResult?.error) return { configured: true, writable: false, error: writeResult.error };
  const readResult = await sbFetch(`${TABLE}?key=eq.${encodeURIComponent(testKey)}&select=key,value`);
  const readable = Array.isArray(readResult) && readResult.length > 0;
  return { configured: true, writable: true, readable, cacheSize: Object.keys(_cache).length };
}

// Backfill embeddings for any memories that don't have one yet (run after enabling pgvector)
async function backfillEmbeddings() {
  if (!isConfigured() || !embeddingsEnabled()) return { error: 'Supabase or OpenAI key not configured' };
  const rows = await sbFetch(`${TABLE}?embedding=is.null&select=key,value,category&limit=500`);
  if (!Array.isArray(rows)) return rows;

  let done = 0, failed = 0;
  for (const r of rows) {
    const embedding = await generateEmbedding(`${r.key}: ${r.value}`);
    if (!embedding) { failed++; continue; }
    const res = await sbFetch(`${TABLE}?key=eq.${encodeURIComponent(r.key)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ embedding: JSON.stringify(embedding) }),
    });
    if (res?.error) failed++; else done++;
  }
  console.log(`[MEMORY] Backfill complete — ${done} embedded, ${failed} failed`);
  return { success: true, embedded: done, failed, total: rows.length };
}

module.exports = { saveMemory, recallMemory, searchMemory, semanticSearch, listMemory, deleteMemory, getMemorySync, isConfigured, embeddingsEnabled, loadCache, refreshIfStale, memoryStatus, backfillEmbeddings };
