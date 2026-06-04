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
      hasOneNoteToken: !!m.oneNoteRefreshToken,
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
    const { clientId, clientSecret, tenantId, refreshToken, accessToken, tokenExpiry, oneNoteRefreshToken } = req.body;
    const current = getConfig().integrations?.m365 || {};

    const resolvedClientId = clientId || current.clientId || '';
    const resolvedTenantId = tenantId || current.tenantId || '';
    const patch = {
      enabled: !!(resolvedClientId && resolvedTenantId),
      clientId: resolvedClientId,
      tenantId: resolvedTenantId,
      clientSecret: clientSecret === '••••••••' ? (current.clientSecret || '') : (clientSecret || current.clientSecret || ''),
      refreshToken: refreshToken === '••••••••' ? (current.refreshToken || '') : (refreshToken || current.refreshToken || ''),
      accessToken: accessToken || current.accessToken || '',
      tokenExpiry: tokenExpiry || current.tokenExpiry || 0,
      oneNoteRefreshToken: oneNoteRefreshToken === '••••••••' ? (current.oneNoteRefreshToken || '') : (oneNoteRefreshToken !== undefined ? oneNoteRefreshToken : (current.oneNoteRefreshToken || ''))
    };

    updateConfig({ integrations: { m365: patch } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OneNote OAuth web flow ───────────────────────────────────────────────────
// Step 1: visit /api/auth/onenote?key=ADMINKEY → redirects to Microsoft login
app.get('/api/auth/onenote', (req, res, next) => {
  const qKey = (req.query.key || '').trim();
  if (ADMIN_KEY && qKey === ADMIN_KEY) return next();
  requireAdminKey(req, res, next);
}, (req, res) => {
  const cfg = getConfig();
  const m365 = cfg.integrations?.m365 || {};
  if (!m365.clientId || !m365.tenantId) {
    return res.status(400).send('M365 not configured — set Client ID and Tenant ID in Integrations first.');
  }
  const redirectUri = `https://${req.headers.host}/api/auth/onenote/callback`;
  const params = new URLSearchParams({
    client_id: m365.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'https://graph.microsoft.com/Notes.ReadWrite.All offline_access openid profile',
    response_mode: 'query',
    state: ADMIN_KEY,
    prompt: 'select_account'
  });
  res.redirect(`https://login.microsoftonline.com/${m365.tenantId}/oauth2/v2.0/authorize?${params}`);
});

// Step 2: Microsoft redirects here after login
app.get('/api/auth/onenote/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.status(400).send(`<pre>Auth error: ${error}\n${error_description || ''}</pre>`);
  }
  if (state !== ADMIN_KEY) return res.status(403).send('Invalid state — possible CSRF');
  if (!code) return res.status(400).send('No code returned from Microsoft');

  const cfg = getConfig();
  const m365 = cfg.integrations?.m365 || {};
  const redirectUri = `https://${req.headers.host}/api/auth/onenote/callback`;

  try {
    const tokenResp = await fetch(
      `https://login.microsoftonline.com/${m365.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: m365.clientId,
          client_secret: m365.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          scope: 'https://graph.microsoft.com/Notes.ReadWrite.All offline_access openid profile'
        })
      }
    );
    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error('[AUTH] OneNote callback token exchange failed:', tokenResp.status, err.slice(0, 400));
      return res.status(500).send(`<pre>Token exchange failed (${tokenResp.status}):\n${err}</pre>`);
    }
    const data = await tokenResp.json();
    const expiry = Date.now() + (data.expires_in || 3600) * 1000;
    const cur = getConfig().integrations?.m365 || {};
    updateConfig({ integrations: { m365: { ...cur,
      oneNoteRefreshToken: data.refresh_token,
      oneNoteAccessToken: data.access_token,
      oneNoteTokenExpiry: expiry
    }}});
    console.log('[AUTH] OneNote OAuth complete, token saved, expires', new Date(expiry).toISOString());
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
<h2 style="color:#107c10">✅ OneNote Connected!</h2>
<p>Claudia can now read and write OneNote pages.</p>
<p style="color:#666;font-size:13px">Token saved. You can close this tab.</p>
</body></html>`);
  } catch (err) {
    console.error('[AUTH] OneNote callback error:', err.message);
    res.status(500).send(`Error: ${err.message}`);
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

// ─── Download fix_onenote.py ──────────────────────────────────────────────────
app.get('/download/fix_onenote.py', (req, res, next) => {
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
OneNote Device Code Login — gets a delegated refresh token for OneNote API.
Microsoft blocked app-only (client_credentials) access to OneNote from March 2025.
Run: python fix_onenote.py
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
SCOPES = "https://graph.microsoft.com/Notes.ReadWrite.All offline_access openid profile"

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

def api_patch(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BACKEND}{path}", data=data, method="PUT",
          headers={"Authorization": f"Bearer {ADMIN_KEY}",
                   "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

print("Requesting device code for OneNote...")
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

print("\\n\\nSaving OneNote token to Railway...")
result = api_patch("/api/integrations/m365", {
    "oneNoteRefreshToken": token["refresh_token"]
})
print(f"Saved: {result}")
print("\\nDone! OneNote is now connected with delegated access.")
`;

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="fix_onenote.py"');
  res.send(script);
});

// ─── OneNote diagnostics ──────────────────────────────────────────────────────
// GET /api/debug/onenote?section=travel  (requires admin key in Authorization header)
app.get('/api/debug/onenote', requireAdminKey, async (req, res) => {
  const sectionName = (req.query.section || 'travel').trim();
  const results = {};

  // Test 1: anchor page lookup
  const ANCHOR_PAGE_ID = '1-a9da38968f2a4e05826e53d9b8c8f5e4!55-07f6fff2-e3b3-4a32-ad6f-3835ead68a3e';
  const pageDetail = await m365Tools.debugGetPageDetail(ANCHOR_PAGE_ID).catch(e => ({ error: e.message }));
  results.anchorPage = pageDetail;

  // Test 2: if we got a notebook ID, list its sections
  const notebookId = pageDetail?.parentSection?.parentNotebook?.id;
  if (notebookId) {
    const sections = await m365Tools.debugListNotebookSections(notebookId).catch(e => ({ error: e.message }));
    results.notebookSections = sections;
  }

  // Test 3: Drive .onetoc2 search
  const tocResult = await m365Tools.debugTocSearch().catch(e => ({ error: e.message }));
  results.tocSearch = tocResult;

  // Test 4: current cached section IDs
  const { getConfig } = require('./config-manager');
  results.cachedSections = getConfig().integrations?.m365?.oneNoteSections || {};

  res.json(results);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const path = require('path');
  const configPath = path.join(__dirname, 'auth_info', 'config.json');
  const cfg = getConfig();
  console.log(`Personal Assistant API listening on port ${PORT}`);
  console.log(`[CONFIG] path=${configPath}`);
  console.log(`[CONFIG] m365.enabled=${cfg.integrations?.m365?.enabled} hasRefreshToken=${!!cfg.integrations?.m365?.refreshToken} hasOneNoteToken=${!!cfg.integrations?.m365?.oneNoteRefreshToken} brave.apiKey=${cfg.integrations?.brave?.apiKey ? 'set' : 'missing'} BRAVE_API_KEY_env=${!!process.env.BRAVE_API_KEY}`);
});

startWhatsApp(processMessage).catch(err => {
  console.error('WhatsApp startup error:', err);
});

startScheduler(sendProactiveMessage);
