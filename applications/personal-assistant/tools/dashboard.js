'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function sbFetch(path) {
  if (!isConfigured()) return { error: 'Supabase not configured' };
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: sbHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    const body = await resp.text();
    if (!resp.ok) return { error: `Supabase ${resp.status}: ${body.slice(0, 300)}` };
    return JSON.parse(body);
  } catch (err) {
    return { error: err.message };
  }
}

// Resolve a client name to its row — returns the first matching client object or null
async function resolveClient(client_name) {
  const data = await sbFetch(`clients?select=*&name=ilike.*${encodeURIComponent(client_name)}*&limit=5`);
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function listClients({ search = '', status = '', limit = 25 } = {}) {
  let query = `clients?select=*&limit=${limit}&order=name.asc`;
  if (status) query += `&status=eq.${encodeURIComponent(status)}`;
  if (search) query += `&name=ilike.*${encodeURIComponent(search)}*`;
  const data = await sbFetch(query);
  if (!Array.isArray(data)) return data;
  return { total: data.length, clients: data };
}

async function getClient({ client_id, name } = {}) {
  if (!client_id && !name) return { error: 'client_id or name required' };
  let data;
  if (client_id) {
    data = await sbFetch(`clients?select=*&id=eq.${encodeURIComponent(client_id)}`);
  } else {
    data = await sbFetch(`clients?select=*&name=ilike.*${encodeURIComponent(name)}*&limit=5`);
  }
  if (!Array.isArray(data)) return data;
  if (!data.length) return { error: 'Client not found' };

  const client = data[0];
  const [integrations, devices] = await Promise.all([
    sbFetch(`clients_integrations?select=*&client_id=eq.${client.id}`),
    sbFetch(`devices?select=*&client_id=eq.${client.id}&limit=100`),
  ]);
  return {
    ...client,
    integrations: Array.isArray(integrations) ? integrations : [],
    devices: Array.isArray(devices) ? devices : [],
    device_count: Array.isArray(devices) ? devices.length : 0,
  };
}

async function listDevices({ client_id = '', client_name = '', status = '', limit = 30 } = {}) {
  let resolvedClientId = client_id;
  if (!resolvedClientId && client_name) {
    const client = await resolveClient(client_name);
    if (!client) return { error: `No client found matching "${client_name}"` };
    resolvedClientId = client.id;
  }

  // Build query — no assumed column ordering since schema is unknown
  const params = [`select=*`, `limit=${limit}`];
  if (resolvedClientId) params.push(`client_id=eq.${encodeURIComponent(resolvedClientId)}`);
  if (status) params.push(`status=eq.${encodeURIComponent(status)}`);

  const data = await sbFetch(`devices?${params.join('&')}`);
  if (!Array.isArray(data)) return data;
  return { total: data.length, devices: data };
}

async function listBackupJobs({ client_id = '', client_name = '', status = '', limit = 20 } = {}) {
  let resolvedClientId = client_id;
  if (!resolvedClientId && client_name) {
    const client = await resolveClient(client_name);
    if (!client) return { error: `No client found matching "${client_name}"` };
    resolvedClientId = client.id;
  }

  const params = [`select=*`, `limit=${limit}`, `order=created_at.desc`];
  if (resolvedClientId) params.push(`client_id=eq.${encodeURIComponent(resolvedClientId)}`);
  if (status) params.push(`status=eq.${encodeURIComponent(status)}`);

  const data = await sbFetch(`backup_jobs?${params.join('&')}`);
  if (!Array.isArray(data)) return data;
  return { total: data.length, backup_jobs: data };
}

async function listClientIntegrations({ client_id = '', client_name = '' } = {}) {
  let resolvedClientId = client_id;
  if (!resolvedClientId && client_name) {
    const client = await resolveClient(client_name);
    if (!client) return { error: `No client found matching "${client_name}"` };
    resolvedClientId = client.id;
  }
  if (!resolvedClientId) return { error: 'client_id or client_name required' };

  const data = await sbFetch(`clients_integrations?select=*&client_id=eq.${encodeURIComponent(resolvedClientId)}`);
  if (!Array.isArray(data)) return data;
  return { client_id: resolvedClientId, integrations: data };
}

module.exports = { listClients, getClient, listDevices, listBackupJobs, listClientIntegrations, isConfigured };
