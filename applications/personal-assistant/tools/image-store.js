'use strict';
// Shared in-memory store for pending receipt images.
// whatsapp.js stores the buffer on image receipt.
// receipts.js reads it when save_receipt is called (even from a follow-up message).

const _store = {};
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function storePendingImage(senderJid, buffer, mimeType) {
  if (!senderJid || !buffer) return;
  _store[senderJid] = { buffer, mimeType: mimeType || 'image/jpeg', ts: Date.now() };
  console.log(`[IMG-STORE] Stored ${Math.round(buffer.length / 1024)}KB image for ${senderJid}`);
}

function getPendingImage(senderJid) {
  if (!senderJid) return null;
  const e = _store[senderJid];
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) {
    delete _store[senderJid];
    return null;
  }
  return e;
}

function clearPendingImage(senderJid) {
  delete _store[senderJid];
}

module.exports = { storePendingImage, getPendingImage, clearPendingImage };
