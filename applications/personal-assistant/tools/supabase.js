'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// Build a PostgREST filter string from a plain object like { status: 'active', client_id: '123' }
// Also accepts a raw string like "status=eq.active&name=ilike.*foo*"
function buildFilters(filters) {
  if (!filters) return '';
  if (typeof filters === 'string') return filters;
  return Object.entries(filters)
    .map(([k, v]) => {
      if (typeof v === 'string' && v.includes('*')) return `${k}=ilike.${v}`;
      return `${k}=eq.${encodeURIComponent(v)}`;
    })
    .join('&');
}

async function supabaseQuery({
  table,
  operation = 'select',
  columns = '*',
  filters = '',
  data = null,
  limit = 100,
  order = '',
} = {}) {
  if (!table) return { error: 'table is required' };
  if (!isConfigured()) return { error: 'Supabase not configured' };

  const filterStr = buildFilters(filters);
  const op = operation.toLowerCase();

  try {
    let url, method, body, headers;

    if (op === 'select') {
      const params = [`select=${encodeURIComponent(columns)}`];
      if (filterStr) params.push(filterStr);
      if (limit) params.push(`limit=${limit}`);
      if (order) params.push(`order=${order}`);
      url = `${SUPABASE_URL}/rest/v1/${table}?${params.join('&')}`;
      method = 'GET';
      headers = sbHeaders({ Prefer: 'count=exact' });
    } else if (op === 'insert') {
      if (!data) return { error: 'data required for insert' };
      url = `${SUPABASE_URL}/rest/v1/${table}`;
      method = 'POST';
      body = JSON.stringify(Array.isArray(data) ? data : [data]);
      headers = sbHeaders({ Prefer: 'return=representation' });
    } else if (op === 'upsert') {
      if (!data) return { error: 'data required for upsert' };
      url = `${SUPABASE_URL}/rest/v1/${table}`;
      method = 'POST';
      body = JSON.stringify(Array.isArray(data) ? data : [data]);
      headers = sbHeaders({ Prefer: 'return=representation,resolution=merge-duplicates' });
    } else if (op === 'update') {
      if (!data) return { error: 'data required for update' };
      if (!filterStr) return { error: 'filters required for update (safety: must target specific rows)' };
      url = `${SUPABASE_URL}/rest/v1/${table}?${filterStr}`;
      method = 'PATCH';
      body = JSON.stringify(data);
      headers = sbHeaders({ Prefer: 'return=representation' });
    } else if (op === 'delete') {
      if (!filterStr) return { error: 'filters required for delete (safety: must target specific rows)' };
      url = `${SUPABASE_URL}/rest/v1/${table}?${filterStr}`;
      method = 'DELETE';
      headers = sbHeaders({ Prefer: 'return=representation' });
    } else {
      return { error: `Unknown operation: ${operation}` };
    }

    const resp = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });

    if (resp.status === 204) return { success: true };
    const text = await resp.text();
    if (!resp.ok) return { error: `Supabase ${resp.status}: ${text.slice(0, 400)}` };
    const result = text ? JSON.parse(text) : [];
    console.log(`[SB] ${op.toUpperCase()} ${table} — ${Array.isArray(result) ? result.length + ' rows' : 'ok'}`);
    return Array.isArray(result) ? { rows: result, count: result.length } : result;
  } catch (err) {
    return { error: err.message };
  }
}

async function supabaseRunSql({ sql } = {}) {
  if (!sql) return { error: 'sql is required' };

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  // Self-hosted: use direct PostgreSQL connection via DATABASE_URL
  if (dbUrl) {
    try {
      const { Client } = require('pg');
      const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await client.connect();
      try {
        const res = await client.query(sql);
        console.log(`[SB] SQL (pg) — ${sql.slice(0, 80).replace(/\n/g, ' ')}`);
        return {
          success: true,
          rows: res.rows || [],
          rowCount: res.rowCount,
          command: res.command,
        };
      } finally {
        await client.end();
      }
    } catch (err) {
      return { error: `SQL error: ${err.message}` };
    }
  }

  // Cloud-hosted fallback: Supabase Management API
  if (!SUPABASE_PROJECT_REF || !SUPABASE_ACCESS_TOKEN) {
    return {
      error: 'No SQL execution method configured. Add DATABASE_URL (self-hosted) or SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN (cloud) to Railway env vars.',
    };
  }

  try {
    const resp = await fetch(
      `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ query: sql }),
        signal: AbortSignal.timeout(20000),
      }
    );

    const text = await resp.text();
    if (!resp.ok) return { error: `Supabase Management API ${resp.status}: ${text.slice(0, 400)}` };
    const result = text ? JSON.parse(text) : { success: true };
    console.log(`[SB] SQL executed — ${sql.slice(0, 80).replace(/\n/g, ' ')}...`);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { supabaseQuery, supabaseRunSql, isConfigured };
