const path = require('path');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
      console.log('WhatsApp connected.');
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

      try {
        if (onMessage) {
          const reply = await onMessage(sender, text);
          if (reply && sock) {
            await sock.sendMessage(rawJid, { text: reply }, { quoted: msg });
            console.log(`[WA] Reply sent to ${rawJid}`);
          }
        }
      } catch (err) {
        console.error(`[WA] Failed to send reply to ${rawJid}:`, err.message);
        if (sock) {
          await sock.sendMessage(rawJid, {
            text: 'Something went wrong. Please try again.'
          }, { quoted: msg }).catch(e => console.error('[WA] Error reply failed:', e.message));
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

module.exports = { start, getStatus, refreshNumberResolution };
