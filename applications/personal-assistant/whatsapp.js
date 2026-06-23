const path = require('path');
const fs = require('fs');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, 'auth_info');

// Must match SOCIAL_MSG_SEP in agents.js
const SOCIAL_MSG_SEP = '\x1ESOCIAL_MSG\x1E';

async function transcribeAudio(buffer, llmConfig, mimetype) {
  if (!llmConfig?.apiKey) throw new Error('No API key configured');
  const baseUrl = (llmConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');

  // Derive audio format for input_audio block — WhatsApp voice notes are opus
  const baseMime = (mimetype || 'audio/ogg').split(';')[0].trim();
  const fmt = baseMime.includes('mp4') || baseMime.includes('m4a') ? 'mp3'
    : baseMime.includes('webm') ? 'webm'
    : baseMime.includes('mpeg') || baseMime.includes('mp3') ? 'mp3'
    : baseMime.includes('wav') ? 'wav'
    : baseMime.includes('flac') ? 'flac'
    : 'opus'; // default: WhatsApp voice notes are ogg/opus

  // Use chat/completions with input_audio — same endpoint as text (no multipart needed)
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.apiKey}`
    },
    body: JSON.stringify({
      model: llmConfig.model || 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'input_audio', input_audio: { data: buffer.toString('base64'), format: fmt } },
          { type: 'text', text: 'Transcribe this audio exactly as spoken. Return only the transcribed text, nothing else.' }
        ]
      }],
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Audio transcription ${response.status}: ${err.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

let currentQR = null;
let qrDataUrl = null;
let isConnected = false;
let connectedAt = null;
let sock = null;
let onMessage = null;
let isResolvingNumbers = false;

// LID (privacy id) → phone number cache, e.g. "117196906852449" -> "16477863361"
const lidToPhone = {};

// Per-sender pending PDF buffer (5-min TTL).
// When a PDF arrives with no caption, we store the extracted text here
// so the next message from the same sender automatically gets it prepended.
const pendingPdf = {};  // { [senderKey]: { text: string, fileName: string, at: number } }
const PDF_TTL_MS = 5 * 60 * 1000;

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
      if (!msg.key) continue;
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

      // Handle voice notes and audio messages — check multiple possible paths
      const audioMsg =
        msg.message?.audioMessage ||
        msg.message?.viewOnceMessage?.message?.audioMessage ||
        msg.message?.viewOnceMessageV2?.message?.audioMessage;
      if (audioMsg && !text && !imageInfo) {
        console.log(`[WA] Audio message detected — ptt=${audioMsg.ptt}, mime=${audioMsg.mimetype}`);
        try {
          const { getConfig } = require('./config-manager');
          const llmConfig = getConfig().llm;
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          console.log(`[WA] Audio downloaded ${Math.round(buffer.length / 1024)}KB`);
          const transcript = await transcribeAudio(buffer, llmConfig, audioMsg.mimetype);
          if (transcript) {
            text = transcript;
            console.log(`[WA] Transcribed: "${transcript.slice(0, 100)}"`);
          } else {
            text = '[Voice note received but no speech detected — please try again]';
          }
        } catch (err) {
          console.error('[WA] Voice transcription failed:', err.message);
          // Send raw error directly — bypasses LLM so we see the exact message
          if (sock && msg.key.remoteJid) {
            await sock.sendMessage(msg.key.remoteJid, { text: `[Voice note error] ${err.message}` }).catch(() => {});
          }
          continue;
        }
      }

      // Handle location messages (static pin or live location)
      const locMsg = msg.message?.locationMessage || msg.message?.liveLocationMessage;
      if (locMsg && !text && !imageInfo) {
        const lat = locMsg.degreesLatitude?.toFixed(6);
        const lng = locMsg.degreesLongitude?.toFixed(6);
        const name = locMsg.name || '';
        const address = locMsg.address || '';
        const isLive = !!msg.message?.liveLocationMessage;
        const parts = [`[${isLive ? 'Live ' : ''}Location shared: ${lat}, ${lng}`];
        if (name) parts.push(`Place: ${name}`);
        if (address) parts.push(`Address: ${address}`);
        text = parts.join(' | ') + ']';
        console.log(`[WA] Location received: ${text}`);
      }

      // Handle document messages (PDFs, Word docs, etc.)
      const docMsg =
        msg.message?.documentMessage ||
        msg.message?.documentWithCaptionMessage?.message?.documentMessage;
      if (docMsg && !imageInfo) {
        const fileName = docMsg.fileName || 'document';
        const mimeType = docMsg.mimetype || '';
        const docCaption = docMsg.caption || '';
        if (docCaption && !text) text = docCaption;

        if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
          const senderKey = (msg.key.remoteJid || '') + (msg.key.participant || '');
          try {
            const { PDFParse } = require('pdf-parse');
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
            console.log(`[WA] PDF downloaded ${Math.round(buffer.length / 1024)}KB: ${fileName}`);
            const parser = new PDFParse({ data: buffer });
            const result = await parser.getText();
            const pdfText = result.text?.trim() || '';
            if (pdfText) {
              const truncated = pdfText.length > 8000;
              const body = truncated ? pdfText.slice(0, 8000) + '\n...(truncated)' : pdfText;
              const pdfBlock = `[PDF: ${fileName}]\n${body}`;
              console.log(`[WA] PDF extracted ${pdfText.length} chars from ${fileName}`);
              if (text) {
                // Caption came with the PDF — process immediately
                text = text + '\n\n' + pdfBlock;
              } else {
                // No caption: buffer for 5 min, send an invite and skip LLM this round
                pendingPdf[senderKey] = { text: pdfBlock, fileName, at: Date.now() };
                if (sock) {
                  await sock.sendMessage(msg.key.remoteJid, {
                    text: `📄 Got your PDF (*${fileName}*). What would you like to know? Ask me anything about it.`
                  }).catch(() => {});
                }
                continue;
              }
            } else {
              // PDF has no extractable text (scanned/encrypted)
              if (sock) {
                await sock.sendMessage(msg.key.remoteJid, {
                  text: `📄 I received *${fileName}* but couldn't extract any text from it — it may be a scanned image or password-protected. Try sending it as a Word doc, or copy-paste the key sections as text.`
                }).catch(() => {});
              }
              continue;
            }
          } catch (err) {
            console.error('[WA] PDF extraction failed:', err.message);
            if (sock) {
              await sock.sendMessage(msg.key.remoteJid, {
                text: `📄 Couldn't read *${fileName}* (${err.message}). Try sending the text content directly.`
              }).catch(() => {});
            }
            continue;
          }
        } else {
          text = (text || '') + `[Document received: ${fileName}]`;
        }
      }

      // If no text yet, check if there's a recently buffered PDF from this sender
      if (!text && !imageInfo) {
        const senderKey = (msg.key.remoteJid || '') + (msg.key.participant || '');
        const pending = pendingPdf[senderKey];
        if (pending && Date.now() - pending.at < PDF_TTL_MS) {
          // No incoming text at all — skip
        }
      }

      // For text messages: prepend any buffered PDF from this sender (sent without caption)
      if (text) {
        const senderKey = (msg.key.remoteJid || '') + (msg.key.participant || '');
        const pending = pendingPdf[senderKey];
        if (pending && Date.now() - pending.at < PDF_TTL_MS) {
          text = pending.text + '\n\n' + text;
          delete pendingPdf[senderKey];
          console.log(`[WA] Prepended buffered PDF (${pending.fileName}) to message`);
        }
      }

      if (!text && !imageInfo) continue;
      // Image with no caption → describe only, no tool calls
      if (!text && imageInfo) text = '[Image received with no caption — describe what you see. Do NOT add tasks, save links, or call any tools.]';

      const rawJid = msg.key.remoteJid;
      if (!rawJid) continue;

      const isGroup = rawJid.endsWith('@g.us');

      // For group messages the actual sender is msg.key.participant, not the group JID
      const senderRaw = isGroup ? (msg.key.participant || rawJid) : rawJid;

      // Resolve LID → phone JID for routing (v7 native mapping)
      const sender = await resolveSenderJid(senderRaw);
      if (sender !== senderRaw) {
        console.log(`[WA] Resolved sender: ${senderRaw} → ${sender}`);
      }

      if (isGroup) {
        const botPhone = digits((sock.user?.id || '').split(':')[0]);
        // In WhatsApp v7 the bot may be identified by LID in mentions, not phone.
        // sock.user.id = "phone:device@s.whatsapp.net" — device suffix (e.g. "12") is
        // also appended to the LID, so strip it to get the bare LID that appears in mentionedJid.
        const deviceSuffix = (sock.user?.id || '').split(':')[1]?.split('@')[0] || '';
        const botLidRaw = sock.user?.lid ? digits(String(sock.user.lid).split('@')[0]) : null;
        const botLid = botLidRaw && deviceSuffix && botLidRaw.endsWith(deviceSuffix)
          ? botLidRaw.slice(0, -deviceSuffix.length)
          : botLidRaw;

        // Collect contextInfo from any message container that might hold it
        const contextInfo =
          msg.message?.extendedTextMessage?.contextInfo ||
          msg.message?.imageMessage?.contextInfo ||
          msg.message?.videoMessage?.contextInfo ||
          msg.message?.audioMessage?.contextInfo ||
          {};

        const mentionedJids = contextInfo?.mentionedJid || [];

        // Match bot by phone OR by LID (v7)
        const isMentionedByJid = mentionedJids.some(jid => {
          const d = digits(jid);
          return d === botPhone || (botLid && d === botLid);
        });

        // Fallback: "claudia" at the start (case-insensitive) in case mention tag missing
        const isMentionedByName = !!(text && /^claudia[,\s!?]*/i.test(text.trim()));

        const isMentioned = isMentionedByJid || isMentionedByName;

        console.log(`[WA] Group ${rawJid} | botPhone=${botPhone} botLid=${botLid} | mentionedJids=${JSON.stringify(mentionedJids)} | byJid=${isMentionedByJid} byName=${isMentionedByName} | text="${(text || '').slice(0, 80)}"`);

        if (!isMentioned) continue;

        // Strip mention tag and "Claudia" prefix so LLM sees clean text
        if (text) text = text.replace(/@\d+/g, '').replace(/^claudia[,\s!?]*/i, '').trim();
      }

      // Mark as read (helps establish the session before replying)
      await sock.readMessages([msg.key]).catch(() => {});

      try {
        if (onMessage) {
          const reply = await onMessage(sender, text, imageInfo, { fromGroup: isGroup });
          if (reply && sock) {
            // Always check for a freshly generated image — send it before the text reply.
            // This works even if the LLM forgets to include the [IMAGE_ID:...] tag.
            try {
              const { popLatestImageBuffer } = require('./tools/image-gen');
              const buf = popLatestImageBuffer();
              if (buf) {
                await sock.sendMessage(rawJid, { image: buf, caption: '', mimetype: 'image/png' });
                console.log(`[WA] Image reply sent to ${rawJid} (${Math.round(buf.length / 1024)}KB)`);
              }
            } catch (imgErr) {
              console.error('[WA] Image reply send failed:', imgErr.message);
            }

            // Strip any [IMAGE_ID:...] tag from the text before sending
            const cleanReply = reply.replace(/\[IMAGE_ID:[^\]]*\]/gi, '').trim();
            if (cleanReply) {
              // Split social content into separate messages (LinkedIn / Instagram / Google Business)
              const parts = cleanReply.includes(SOCIAL_MSG_SEP)
                ? cleanReply.split(SOCIAL_MSG_SEP).map(p => p.trim()).filter(Boolean)
                : [cleanReply];
              for (const part of parts) {
                await sock.sendMessage(rawJid, { text: part });
              }
              console.log(`[WA] Reply sent to ${rawJid} (${parts.length} message${parts.length > 1 ? 's' : ''})`);
            }
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

async function sendProactiveImage(toNumber, imageBuffer, caption = '') {
  if (!sock || !isConnected) {
    console.log('[WA] sendProactiveImage: not connected, skipping');
    return;
  }
  const jid = `${String(toNumber).replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    await sock.sendMessage(jid, { image: imageBuffer, caption, mimetype: 'image/png' });
    console.log(`[WA] Image sent to ${jid} (${Math.round(imageBuffer.length / 1024)}KB)`);
  } catch (err) {
    console.error(`[WA] Image send failed:`, err.message);
  }
}

module.exports = { start, getStatus, refreshNumberResolution, resetSession, sendProactiveMessage, sendProactiveImage };
