require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { getConfig, updateConfig } = require('./config-manager');
const { processMessage, clearHistory, listConversations } = require('./agents');
const { start: startWhatsApp, getStatus, refreshNumberResolution, resetSession, sendProactiveMessage } = require('./whatsapp');
const { startScheduler } = require('./scheduler');
const m365Tools = require('./tools/m365');

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
    const { morningBriefingEnabled, morningBriefingTime, leadHuntEnabled, leadHuntTime, timezone } = req.body;
    const patch = {};
    if (morningBriefingEnabled !== undefined) patch.morningBriefingEnabled = !!morningBriefingEnabled;
    if (morningBriefingTime) patch.morningBriefingTime = String(morningBriefingTime);
    if (leadHuntEnabled !== undefined) patch.leadHuntEnabled = !!leadHuntEnabled;
    if (leadHuntTime) patch.leadHuntTime = String(leadHuntTime);
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

  const braveKeyInConfig = !!(cfg.integrations?.brave?.apiKey);
  const braveKeyInEnv = !!(process.env.BRAVE_API_KEY);

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
    },
    brave: {
      configured: braveKeyInConfig || braveKeyInEnv,
      keyInConfig: braveKeyInConfig,
      keyInEnv: braveKeyInEnv
    }
  });
});

// Brave: save API key to config
app.put('/api/integrations/brave', requireAdminKey, (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
    updateConfig({ integrations: { brave: { apiKey } } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const { clientId, clientSecret, tenantId, refreshToken, accessToken, tokenExpiry } = req.body;
    const current = getConfig().integrations?.m365 || {};

    const patch = {
      enabled: !!(clientId && tenantId),
      clientId: clientId || current.clientId || '',
      tenantId: tenantId || current.tenantId || '',
      clientSecret: clientSecret === '••••••••' ? (current.clientSecret || '') : (clientSecret || current.clientSecret || ''),
      refreshToken: refreshToken === '••••••••' ? (current.refreshToken || '') : (refreshToken || current.refreshToken || ''),
      accessToken: accessToken || '',
      tokenExpiry: tokenExpiry || 0
    };

    updateConfig({ integrations: { m365: patch } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OneNote page ID diagnostic ───────────────────────────────────────────────
app.get('/api/onenote/link-page-ids', requireAdminKey, async (_req, res) => {
  try {
    const ids = await m365Tools.getPageIdsForLinkPages();
    res.json(ids);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── Download fix_m365.py ─────────────────────────────────────────────────────
app.get('/download/fix_m365.py', (req, res, next) => {
  // Allow key as ?key= query param for browser downloads
  const qKey = (req.query.key || '').trim();
  if (ADMIN_KEY && qKey === ADMIN_KEY) return next();
  requireAdminKey(req, res, next);
}, (req, res) => {
  const cfg = getConfig();
  const m365 = cfg.integrations?.m365 || {};
  const TENANT_ID     = m365.tenantId     || '';
  const CLIENT_ID     = m365.clientId     || '';
  const CLIENT_SECRET = m365.clientSecret || '';
  const BACKEND       = `https://${req.headers.host}`;

  const script = `"""
M365 Device Code Login — saves both access token and refresh token to Railway.
Run: python fix_m365.py
"""
import urllib.request
import urllib.parse
import json
import time

BACKEND   = "${BACKEND}"
ADMIN_KEY = "${ADMIN_KEY}"

TENANT_ID     = "${TENANT_ID}"
CLIENT_ID     = "${CLIENT_ID}"
CLIENT_SECRET = "${CLIENT_SECRET}"
SCOPES = "Calendars.ReadWrite Mail.Read Mail.ReadWrite Tasks.ReadWrite Notes.ReadWrite.All Notes.Create Files.ReadWrite Sites.Read.All offline_access User.Read openid profile email"

def ms_post(url, body_dict):
    data = urllib.parse.urlencode(body_dict).encode()
    req = urllib.request.Request(url, data=data,
          headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise Exception(f"HTTP {e.code}: {body}")

def api_put(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BACKEND}{path}", data=data, method="PUT",
          headers={"Authorization": f"Bearer {ADMIN_KEY}",
                   "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

print("Requesting device code...")
device = ms_post(
    f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/devicecode",
    {"client_id": CLIENT_ID, "scope": SCOPES}
)

print("\\n" + "="*55)
print("  Go to:", device.get("verification_uri", "https://microsoft.com/devicelogin"))
print("  Enter code:", device["user_code"])
print("="*55)
print("\\nSign in with ali@midastech.ca then come back here.")
input("\\nPress ENTER after you have approved in the browser...")

print("Fetching token...", end="", flush=True)
interval = int(device.get("interval", 5))
token = None

for _ in range(30):
    time.sleep(interval)
    print(".", end="", flush=True)
    try:
        token = ms_post(
            f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "device_code": device["device_code"]
            }
        )
        if "refresh_token" in token:
            break
        token = None
    except Exception as e:
        if "authorization_pending" in str(e) or "slow_down" in str(e):
            continue
        print(f"\\nError: {e}")
        break

if not token or "refresh_token" not in token:
    print("\\nFailed — try running the script again.")
    exit(1)

print("\\n\\nSaving to Railway...")
expiry_ms = int(time.time() * 1000) + int(token.get("expires_in", 3600)) * 1000

result = api_put("/api/integrations/m365", {
    "tenantId": TENANT_ID,
    "clientId": CLIENT_ID,
    "clientSecret": CLIENT_SECRET,
    "refreshToken": token["refresh_token"],
    "accessToken": token["access_token"],
    "tokenExpiry": expiry_ms
})
print(f"Saved: {result}")
print("\\nDone! M365 is reconnected.")
`;

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="fix_m365.py"');
  res.send(script);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const path = require('path');
  const configPath = path.join(__dirname, 'auth_info', 'config.json');
  const cfg = getConfig();
  console.log(`Personal Assistant API listening on port ${PORT}`);
  console.log(`[CONFIG] path=${configPath}`);
  console.log(`[CONFIG] m365.enabled=${cfg.integrations?.m365?.enabled} hasRefreshToken=${!!cfg.integrations?.m365?.refreshToken} brave.apiKey=${cfg.integrations?.brave?.apiKey ? 'set' : 'missing'} BRAVE_API_KEY_env=${!!process.env.BRAVE_API_KEY}`);
});

startWhatsApp(processMessage).catch(err => {
  console.error('WhatsApp startup error:', err);
});

startScheduler(sendProactiveMessage);
