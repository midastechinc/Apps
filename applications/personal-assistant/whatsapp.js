const path = require('path');
const fs = require('fs');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
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

const lidToPhone = {};
const logger = pino({ level: 'warn' });

async function resolveNumbers(phoneNumbers) {
  if (!sock || !isConnected) return;
  for (const phone of phoneNumbers) {
    if (!phone) continue;
    try {
      const normalized = phone.replace(/\D/g, '');
      const results = await sock.onWhatsApp(`+${normalized}`);
      console.log(`[WA] onWhatsApp(+${normalized}):`, JSON.stringify(results));
      if (results?.length > 0 && results[0].exists) {
        const info = results[0];
        const lidRaw = info.lid || info.jid;
        if (lidRaw) {
          const lidNum = String(lidRaw).replace(/@.*$/, '');
          lidToPhone[lidNum] = normalized;
          console.log(`[WA] Resolved +${normalized} → LID ${lidNum}`);
        }
      }
    } catch (err) {
      console.log(`[WA] Could not resolve +${phone}: ${err.message}`);
    }
  }
}

async function refreshNumberResolution() {
  if (isResolvingNumbers || !isConnected) return;
  isResolvingNumbers = true;
  try {
    const { getConfig } = require('./config-manager');
    const config = getConfig();
    const allNumbers = [config.mainNumber, ...(config.familyNumbers || [])].filter(Boolean);
    if (allNumbers.length > 0) {
      await resolveNumbers(allNumbers);
    }
  } finally {
    isResolvingNumbers = false;
  }
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
    printQRInTerminal: true,
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

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.buttonsResponseMessage?.selectedDisplayText ||
        msg.message?.listResponseMessage?.title;

      if (!text) continue;

      const rawJid = msg.key.remoteJid;
      if (!rawJid) continue;

      let sender = rawJid;

      // Resolve @lid JID to phone-based JID for routing
      if (rawJid.endsWith('@lid')) {
        const lidNum = rawJid.replace(/@.*$/, '');
        const phone = lidToPhone[lidNum];
        if (phone) {
          sender = `${phone}@s.whatsapp.net`;
          console.log(`[WA] LID resolved: ${rawJid} → ${sender}`);
        } else {
          console.log(`[WA] Unknown LID ${rawJid}, triggering resolution...`);
          await refreshNumberResolution().catch(() => {});
          const resolvedPhone = lidToPhone[lidNum];
          if (resolvedPhone) {
            sender = `${resolvedPhone}@s.whatsapp.net`;
            console.log(`[WA] LID resolved (on-the-fly): ${rawJid} → ${sender}`);
          }
        }
      }

      // Mark as read and give session a moment to stabilise
      await sock.readMessages([msg.key]).catch(() => {});
      await new Promise(r => setTimeout(r, 500));

      try {
        if (onMessage) {
          const reply = await onMessage(sender, text);
          if (reply && sock) {
            const replyJid = sender !== rawJid ? sender : rawJid;
            // Try relayMessage (lower-level) to bypass sendMessage wrapper
            const built = generateWAMessageFromContent(replyJid,
              proto.Message.fromObject({ conversation: reply }),
              { userJid: sock.user?.id }
            );
            await sock.relayMessage(replyJid, built.message, { messageId: built.key.id });
            console.log(`[WA] Reply relayed to ${replyJid} (id=${built.key.id})`);
          }
        }
      } catch (err) {
        console.error(`[WA] Failed to relay reply:`, err.message);
        // Fall back to sendMessage
        if (sock) {
          const replyJid = sender !== rawJid ? sender : rawJid;
          await sock.sendMessage(replyJid, {
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
  // Close existing connection
  if (sock) {
    sock.ev.removeAllListeners();
    sock.end?.();
    sock = null;
  }
  isConnected = false;
  connectedAt = null;
  currentQR = null;
  qrDataUrl = null;

  // Delete all auth_info files EXCEPT config.json
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

module.exports = { start, getStatus, refreshNumberResolution, resetSession };
