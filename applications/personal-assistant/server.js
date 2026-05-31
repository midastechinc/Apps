require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { getConfig, updateConfig } = require('./config-manager');
const { processMessage, clearHistory, listConversations } = require('./agents');
const { start: startWhatsApp, getStatus, refreshNumberResolution } = require('./whatsapp');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const app = express();
app.use(cors());
app.use(express.json());

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

app.get('/api/status', (_req, res) => {
  res.json(getStatus());
});

app.get('/api/config', requireAdminKey, (_req, res) => {
  const cfg = getConfig();
  const safe = { ...cfg, llm: { ...cfg.llm, apiKey: cfg.llm.apiKey ? '••••••••' : '' } };
  res.json(safe);
});

app.put('/api/config', requireAdminKey, (req, res) => {
  try {
    const patch = req.body;
    if (patch.llm?.apiKey === '••••••••') {
      const existing = getConfig();
      patch.llm.apiKey = existing.llm.apiKey;
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

app.get('/api/conversations', requireAdminKey, (_req, res) => {
  res.json(listConversations());
});

app.delete('/api/conversations/:jid', requireAdminKey, (req, res) => {
  clearHistory(decodeURIComponent(req.params.jid));
  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Personal Assistant API listening on port ${PORT}`);
});

startWhatsApp(processMessage).catch(err => {
  console.error('WhatsApp startup error:', err);
});
