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

const logger = pino({ level: 'warn' });

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

      const sender = msg.key.remoteJid;
      if (!sender) continue;

      try {
        if (onMessage) {
          const reply = await onMessage(sender, text);
          if (reply && sock) {
            await sock.sendMessage(sender, { text: reply });
          }
        }
      } catch (err) {
        console.error('Error processing message from', sender, err.message);
        if (sock) {
          await sock.sendMessage(sender, {
            text: 'Something went wrong. Please try again.'
          }).catch(() => {});
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

module.exports = { start, getStatus };
