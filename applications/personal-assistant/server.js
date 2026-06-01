require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { getConfig, updateConfig } = require('./config-manager');
const { processMessage, clearHistory, listConversations } = require('./agents');
const { start: startWhatsApp, getStatus, refreshNumberResolution, resetSession, sendProactiveMessage } = require('./whatsapp');
const { startScheduler } = require('./scheduler');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const AUTH_DIR = path.join(__dirname, 'auth_info');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function requireAdminKey(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY environment variable is not set.' });
  }
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── WhatsApp status (public) ────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  res.json(getStatus());
});

// ─── Config ──────────────────────────────────────────────────────────────────
app.get('/api/config', requireAdminKey, (_req, res) => {
  const cfg = getConfig();
  const safe = { ...cfg, llm: { ...cfg.llm, apiKey: cfg.llm.apiKey ? '••••••••' : '' } };
  res.json(safe);
});

app.put('/api/config', requireAdminKey, (req, res) => {
  try {
    const patch = req.body;
    if (patch.llm?.apiKey === '••••••••') {
      patch.llm.apiKey = getConfig().llm.apiKey;
    }
    const updated = updateConfig(patch);
    const safe = { ...updated, llm: { ...updated.llm, apiKey: updated.llm.apiKey ? '••••••••' : '' } };
    if (patch.mainNumber !== undefined || patch.familyNumbers !== undefined) {
      refreshNumberResolution().catch(err => console.log('[WA] Number refresh failed:', err.message));
    }
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Conversations ────────────────────────────────────────────────────────────
app.get('/api/conversations', requireAdminKey, (_req, res) => {
  res.json(listConversations());
});

app.delete('/api/conversations/:jid', requireAdminKey, (req, res) => {
  clearHistory(decodeURIComponent(req.params.jid));
  res.json({ ok: true });
});

// ─── Reset WhatsApp session ───────────────────────────────────────────────────
app.post('/api/reset-session', requireAdminKey, async (_req, res) => {
  try {
    await resetSession();
    res.json({ ok: true, message: 'Session cleared. Scan new QR code.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Family members ───────────────────────────────────────────────────────────
app.get('/api/family-members', requireAdminKey, (_req, res) => {
  res.json(getConfig().familyMembers || []);
});

app.put('/api/family-members', requireAdminKey, (req, res) => {
  try {
    const members = (req.body.familyMembers || []).map(m => ({
      name: String(m.name || '').trim(),
      number: String(m.number || '').replace(/[^0-9]/g, ''),
      relationship: String(m.relationship || '').trim()
    })).filter(m => m.name && m.number);
    updateConfig({ familyMembers: members });
    res.json({ ok: true, count: members.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Schedule ─────────────────────────────────────────────────────────────────
app.get('/api/schedule', requireAdminKey, (_req, res) => {
  res.json(getConfig().schedule || {});
});

app.put('/api/schedule', requireAdminKey, (req, res) => {
  try {
    const { morningBriefingEnabled, morningBriefingTime, timezone } = req.body;
    const patch = {};
    if (morningBriefingEnabled !== undefined) patch.morningBriefingEnabled = !!morningBriefingEnabled;
    if (morningBriefingTime) patch.morningBriefingTime = String(morningBriefingTime);
    if (timezone) patch.timezone = String(timezone);
    updateConfig({ schedule: patch });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Integrations ─────────────────────────────────────────────────────────────
app.get('/api/integrations', requireAdminKey, (_req, res) => {
  const cfg = getConfig();
  const g = cfg.integrations?.google || {};
  const m = cfg.integrations?.m365 || {};

  const GOOGLE_CREDS = path.join(AUTH_DIR, 'google-creds.json');
  let googleCredsOnDisk = false;
  try {
    const c = JSON.parse(fs.readFileSync(GOOGLE_CREDS, 'utf-8'));
    googleCredsOnDisk = !!(c.access_token || c.refresh_token);
  } catch {}

  res.json({
    google: {
      enabled: g.enabled || googleCredsOnDisk,
      configured: googleCredsOnDisk
    },
    m365: {
      enabled: m.enabled || false,
      hasClientId: !!m.clientId,
      hasClientSecret: !!m.clientSecret,
      hasTenantId: !!m.tenantId,
      hasRefreshToken: !!m.refreshToken,
      configured: !!(m.clientId && m.tenantId && (m.accessToken || m.refreshToken))
    }
  });
});

// Google: paste token.json (from Python OAuth flow)
app.post('/api/integrations/google', requireAdminKey, (req, res) => {
  try {
    const { tokenJson, credentialsJson } = req.body;
    if (!tokenJson) return res.status(400).json({ error: 'tokenJson required' });

    const tok = typeof tokenJson === 'string' ? JSON.parse(tokenJson) : tokenJson;
    const creds = {};

    if (credentialsJson) {
      const raw = typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;
      const installed = raw.installed || raw.web;
      if (installed) {
        creds.client_id = installed.client_id;
        creds.client_secret = installed.client_secret;
      }
    }

    creds.access_token = tok.token || tok.access_token;
    creds.refresh_token = tok.refresh_token;
    if (tok.expiry) creds.expiry = typeof tok.expiry === 'string' ? tok.expiry : new Date(tok.expiry).toISOString();
    if (tok.client_id && !creds.client_id) creds.client_id = tok.client_id;
    if (tok.client_secret && !creds.client_secret) creds.client_secret = tok.client_secret;

    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUTH_DIR, 'google-creds.json'), JSON.stringify(creds, null, 2));
    updateConfig({ integrations: { google: { enabled: true } } });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Google: clear credentials
app.delete('/api/integrations/google', requireAdminKey, (req, res) => {
  try {
    const p = path.join(AUTH_DIR, 'google-creds.json');
    if (fs.existsSync(p)) fs.rmSync(p);
    updateConfig({ integrations: { google: { enabled: false } } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M365: save credentials
app.put('/api/integrations/m365', requireAdminKey, (req, res) => {
  try {
    const { clientId, clientSecret, tenantId, refreshToken } = req.body;
    const current = getConfig().integrations?.m365 || {};

    const patch = {
      enabled: !!(clientId && tenantId),
      clientId: clientId || current.clientId || '',
      tenantId: tenantId || current.tenantId || '',
      clientSecret: clientSecret === '••••••••' ? (current.clientSecret || '') : (clientSecret || current.clientSecret || ''),
      refreshToken: refreshToken === '••••••••' ? (current.refreshToken || '') : (refreshToken || current.refreshToken || ''),
      accessToken: '',
      tokenExpiry: 0
    };

    updateConfig({ integrations: { m365: patch } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Personal Assistant API listening on port ${PORT}`);
});

startWhatsApp(processMessage).catch(err => {
  console.error('WhatsApp startup error:', err);
});

startScheduler(sendProactiveMessage);
