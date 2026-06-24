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
  let query;
  if (client_id) {
    query = `clients?select=*&id=eq.${encodeURIComponent(client_id)}`;
  } else {
    query = `clients?select=*&name=ilike.*${encodeURIComponent(name)}*&limit=5`;
  }
  const data = await sbFetch(query);
  if (!Array.isArray(data)) return data;
  if (!data.length) return { error: 'Client not found' };
  // Also fetch their integrations and device count
  const client = data[0];
  const [integrations, devices] = await Promise.all([
    sbFetch(`clients_integrations?select=*&client_id=eq.${client.id}`),
    sbFetch(`devices?select=id,name,status&client_id=eq.${client.id}&limit=100`),
  ]);
  return {
    ...client,
    integrations: Array.isArray(integrations) ? integrations : [],
    devices: Array.isArray(devices) ? devices : [],
    device_count: Array.isArray(devices) ? devices.length : 0,
  };
}

async function listDevices({ client_id = '', client_name = '', status = '', limit = 30 } = {}) {
  let query = `devices?select=*&limit=${limit}&order=name.asc`;
  if (client_id) query += `&client_id=eq.${encodeURIComponent(client_id)}`;
  if (status) query += `&status=eq.${encodeURIComponent(status)}`;
  if (client_name && !client_id) {
    // Resolve client name to ID first
    const clients = await sbFetch(`clients?select=id,name&name=ilike.*${encodeURIComponent(client_name)}*&limit=5`);
    if (!Array.isArray(clients) || !clients.length) return { error: `No client found matching "${client_name}"` };
    query += `&client_id=eq.${clients[0].id}`;
  }
  const data = await sbFetch(query);
  if (!Array.isArray(data)) return data;
  return { total: data.length, devices: data };
}

async function listBackupJobs({ client_id = '', client_name = '', status = '', limit = 20 } = {}) {
  let query = `backup_jobs?select=*&limit=${limit}&order=created_at.desc`;
  if (client_id) query += `&client_id=eq.${encodeURIComponent(client_id)}`;
  if (status) query += `&status=eq.${encodeURIComponent(status)}`;
  if (client_name && !client_id) {
    const clients = await sbFetch(`clients?select=id,name&name=ilike.*${encodeURIComponent(client_name)}*&limit=5`);
    if (!Array.isArray(clients) || !clients.length) return { error: `No client found matching "${client_name}"` };
    query += `&client_id=eq.${clients[0].id}`;
  }
  const data = await sbFetch(query);
  if (!Array.isArray(data)) return data;
  return { total: data.length, backup_jobs: data };
}

async function listClientIntegrations({ client_id = '', client_name = '' } = {}) {
  let resolvedClientId = client_id;
  if (!resolvedClientId && client_name) {
    const clients = await sbFetch(`clients?select=id,name&name=ilike.*${encodeURIComponent(client_name)}*&limit=5`);
    if (!Array.isArray(clients) || !clients.length) return { error: `No client found matching "${client_name}"` };
    resolvedClientId = clients[0].id;
  }
  if (!resolvedClientId) return { error: 'client_id or client_name required' };
  const data = await sbFetch(`clients_integrations?select=*&client_id=eq.${resolvedClientId}`);
  if (!Array.isArray(data)) return data;
  return { client_id: resolvedClientId, integrations: data };
}

module.exports = { listClients, getClient, listDevices, listBackupJobs, listClientIntegrations, isConfigured };
