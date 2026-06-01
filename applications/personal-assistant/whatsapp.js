const path = require('path');
const fs = require('fs');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, 'auth_info');

let currentQR = null;
let qrDataUrl = null;
let isConnected = false;
let connectedAt = null;
let sock = null;
let onMessage = null;
let isResolvingNumbers = false;

// LID (privacy id) → phone number cache, e.g. "117196906852449" -> "16477863361"
const lidToPhone = {};

const logger = pino({ level: 'warn' });

function digits(v) {
  return String(v ?? '').replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

// Pre-warm the LID↔phone cache for every configured number using v7 native mapping.
async function refreshNumberResolution() {
  if (isResolvingNumbers || !isConnected || !sock) return;
  isResolvingNumbers = true;
  try {
    const { getConfig } = require('./config-manager');
    const config = getConfig();
    const allNumbers = [config.mainNumber, ...(config.familyNumbers || [])].filter(Boolean);
    const mapping = sock.signalRepository?.lidMapping;

    for (const raw of allNumbers) {
      const phone = digits(raw);
      if (!phone) continue;
      try {
        const pnJid = `${phone}@s.whatsapp.net`;
        let lid = null;
        if (mapping?.getLIDForPN) {
          lid = await mapping.getLIDForPN(pnJid);
        }
        if (lid) {
          lidToPhone[digits(lid)] = phone;
          console.log(`[WA] Mapped phone ${phone} ↔ LID ${digits(lid)}`);
        } else {
          console.log(`[WA] No LID yet for ${phone} (will resolve on first message)`);
        }
      } catch (err) {
        console.log(`[WA] Could not map ${phone}: ${err.message}`);
      }
    }
  } finally {
    isResolvingNumbers = false;
  }
}

// Resolve an incoming sender JID to a phone-based JID for routing.
async function resolveSenderJid(rawJid) {
  if (!rawJid.endsWith('@lid')) return rawJid;

  const lidNum = digits(rawJid);

  // 1) in-memory cache
  if (lidToPhone[lidNum]) {
    return `${lidToPhone[lidNum]}@s.whatsapp.net`;
  }

  // 2) v7 native LID→PN mapping (populated as Baileys decodes the message)
  try {
    const mapping = sock?.signalRepository?.lidMapping;
    if (mapping?.getPNForLID) {
      const pn = await mapping.getPNForLID(rawJid);
      if (pn) {
        const phone = digits(pn);
        lidToPhone[lidNum] = phone;
        console.log(`[WA] LID ${lidNum} → phone ${phone} (native mapping)`);
        return `${phone}@s.whatsapp.net`;
      }
    }
  } catch (err) {
    console.log(`[WA] getPNForLID failed for ${rawJid}: ${err.message}`);
  }

  // 3) last resort: pre-warm from config then re-check cache
  await refreshNumberResolution().catch(() => {});
  if (lidToPhone[lidNum]) {
    return `${lidToPhone[lidNum]}@s.whatsapp.net`;
  }

  console.log(`[WA] Could not resolve LID ${rawJid} to a phone number`);
  return rawJid;
}

async function start(messageHandler) {
  onMessage = messageHandler;
  await connect();
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Midas Personal Assistant', 'Chrome', '1.0.0'],
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      try {
        qrDataUrl = await QRCode.toDataURL(qr);
      } catch {
        qrDataUrl = null;
      }
    }

    if (connection === 'open') {
      isConnected = true;
      connectedAt = new Date().toISOString();
      currentQR = null;
      qrDataUrl = null;
      console.log(`WhatsApp connected. Bot JID: ${sock.user?.id}`);
      setTimeout(() => {
        refreshNumberResolution().catch(err => {
          console.log('[WA] Initial number resolution failed:', err.message);
        });
      }, 5000);
    }

    if (connection === 'close') {
      isConnected = false;
      connectedAt = null;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`WhatsApp disconnected (code ${code}). Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(() => connect(), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      let text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.buttonsResponseMessage?.selectedDisplayText ||
        msg.message?.listResponseMessage?.title;

      // Handle image messages (direct or forwarded)
      let imageInfo = null;
      const imgMsg = msg.message?.imageMessage;
      if (imgMsg) {
        if (!text && imgMsg.caption) text = imgMsg.caption;
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          imageInfo = {
            data: buffer.toString('base64'),
            mimeType: imgMsg.mimetype || 'image/jpeg'
          };
          console.log(`[WA] Image downloaded ${Math.round(buffer.length / 1024)}KB, caption: "${text || ''}"`);
        } catch (err) {
          console.error('[WA] Image download failed:', err.message);
        }
      }

      if (!text && !imageInfo) continue;
      // Image with no caption → ask Claudia to describe it
      if (!text && imageInfo) text = 'What is in this image? Describe it.';

      const rawJid = msg.key.remoteJid;
      if (!rawJid) continue;

      // Resolve LID → phone JID for routing (v7 native mapping)
      const sender = await resolveSenderJid(rawJid);
      if (sender !== rawJid) {
        console.log(`[WA] Resolved sender: ${rawJid} → ${sender}`);
      }

      // Mark as read (helps establish the session before replying)
      await sock.readMessages([msg.key]).catch(() => {});

      try {
        if (onMessage) {
          const reply = await onMessage(sender, text, imageInfo);
          if (reply && sock) {
            // Reply to the ORIGINAL jid — v7 attaches tctoken automatically (fixes 463)
            await sock.sendMessage(rawJid, { text: reply });
            console.log(`[WA] Reply sent to ${rawJid}`);
          }
        }
      } catch (err) {
        console.error(`[WA] Failed to send reply:`, err.message);
        if (sock) {
          await sock.sendMessage(rawJid, {
            text: 'Something went wrong. Please try again.'
          }).catch(e => console.error('[WA] Error reply failed:', e.message));
        }
      }
    }
  });
}

function getStatus() {
  return {
    connected: isConnected,
    qr: qrDataUrl,
    connectedAt
  };
}

async function resetSession() {
  if (sock) {
    sock.ev.removeAllListeners();
    sock.end?.();
    sock = null;
  }
  isConnected = false;
  connectedAt = null;
  currentQR = null;
  qrDataUrl = null;
  for (const k of Object.keys(lidToPhone)) delete lidToPhone[k];

  // Delete all auth_info files EXCEPT config.json (so contacts/LLM survive)
  if (fs.existsSync(AUTH_DIR)) {
    for (const file of fs.readdirSync(AUTH_DIR)) {
      if (file !== 'config.json') {
        fs.rmSync(path.join(AUTH_DIR, file), { recursive: true, force: true });
      }
    }
  }
  console.log('[WA] Session cleared. Reconnecting for fresh QR...');
  await connect();
}

async function sendProactiveMessage(toNumber, text) {
  if (!sock || !isConnected) {
    console.log('[WA] sendProactiveMessage: not connected, skipping');
    return;
  }
  const jid = `${String(toNumber).replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    await sock.sendMessage(jid, { text });
    console.log(`[WA] Proactive message sent to ${jid}`);
  } catch (err) {
    console.error(`[WA] Proactive send failed:`, err.message);
  }
}

module.exports = { start, getStatus, refreshNumberResolution, resetSession, sendProactiveMessage };
