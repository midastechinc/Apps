'use strict';

const { getPendingImage, clearPendingImage } = require('./image-store');

// Per-sender accumulator for multi-page PDFs
const _pages = {}; // { [senderJid]: [{ buffer, mimeType }] }

// Send queue — popped once by whatsapp.js to deliver the document, then cleared
let _latestPdf = null; // { buffer, filename }

// Persistent copies of recent PDFs — survive sends so a follow-up "save it to
// OneDrive" works. _lastBuiltPdf = built from images; _lastUploadedPdf = a PDF
// the user uploaded via WhatsApp. Both kept for PDF_TTL_MS.
let _lastBuiltPdf = null;    // { buffer, filename, ts }
let _lastUploadedPdf = null; // { buffer, filename, ts }
const PDF_TTL_MS = 30 * 60 * 1000; // 30 minutes

function popLatestPdf() {
  const p = _latestPdf;
  _latestPdf = null;
  return p;
}

// Called by whatsapp.js when the user uploads a PDF document
function setUploadedPdf(buffer, filename) {
  _lastUploadedPdf = { buffer, filename: filename || 'document.pdf', ts: Date.now() };
}

// Return the most recent savable PDF (built or uploaded) within TTL. Does NOT consume.
function peekLatestPdf() {
  const now = Date.now();
  const built = (_lastBuiltPdf && now - _lastBuiltPdf.ts < PDF_TTL_MS) ? _lastBuiltPdf : null;
  const uploaded = (_lastUploadedPdf && now - _lastUploadedPdf.ts < PDF_TTL_MS) ? _lastUploadedPdf : null;
  if (built && uploaded) return built.ts >= uploaded.ts ? built : uploaded;
  return built || uploaded;
}

// Resolve the image the user just sent — current message buffer first, then pending store
function resolveImage(context = {}) {
  if (context.imageBuffer) {
    return { buffer: context.imageBuffer, mimeType: context.imageMimeType || 'image/jpeg' };
  }
  const pending = getPendingImage(context.senderJid);
  return pending ? { buffer: pending.buffer, mimeType: pending.mimeType } : null;
}

function isPng(buf) { return buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47; }

// Embed an image into the PDF. WhatsApp JPEGs are often progressive/CMYK, which
// pdf-lib's embedJpg accepts but renders BLANK. So we normalize everything to a
// clean baseline PNG via jimp (pure JS — loads reliably where sharp doesn't).
async function embedImage(pdfDoc, buffer) {
  // Already a clean PNG — embed directly
  if (isPng(buffer)) {
    try { return await pdfDoc.embedPng(buffer); } catch { /* fall through to jimp */ }
  }
  // Normalize via jimp → baseline JPEG (handles progressive/CMYK JPEG, orientation,
  // webp). jimp emits BASELINE jpeg, which pdf-lib renders correctly — unlike the
  // progressive jpegs WhatsApp sends. Downscale large photos to keep files small.
  try {
    const { Jimp } = require('jimp');
    const img = await Jimp.read(buffer);
    const MAX = 2000;
    if (img.bitmap.width > MAX || img.bitmap.height > MAX) {
      if (img.bitmap.width >= img.bitmap.height) img.resize({ w: MAX });
      else img.resize({ h: MAX });
    }
    const jpeg = await img.getBuffer('image/jpeg', { quality: 82 });
    return await pdfDoc.embedJpg(jpeg);
  } catch (err) {
    throw new Error(`Could not embed image: ${err.message}`);
  }
}

// Add the current image as a page without building yet
async function addPageToPdf(args = {}, context = {}) {
  const img = resolveImage(context);
  if (!img) return { error: 'No image to add. Send an image first, then say "add to PDF".' };

  const key = context.senderJid || 'default';
  if (!_pages[key]) _pages[key] = [];
  _pages[key].push(img);
  if (context.senderJid) clearPendingImage(context.senderJid);
  return { success: true, pages_collected: _pages[key].length };
}

// Build a PDF from accumulated pages plus the current image (if any)
async function imageToPdf(args = {}, context = {}) {
  const key = context.senderJid || 'default';
  const pages = [...(_pages[key] || [])];
  const current = resolveImage(context);
  if (current) pages.push(current);

  if (!pages.length) {
    return { error: 'No image found. Send an image first, then ask me to convert it to PDF.' };
  }

  try {
    const { PDFDocument } = require('pdf-lib');
    const pdfDoc = await PDFDocument.create();

    for (const page of pages) {
      const img = await embedImage(pdfDoc, page.buffer);
      // Fit to a US Letter page (612x792 pt) preserving aspect ratio
      const maxW = 612, maxH = 792;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const pdfPage = pdfDoc.addPage([maxW, maxH]);
      pdfPage.drawImage(img, { x: (maxW - w) / 2, y: (maxH - h) / 2, width: w, height: h });
    }

    const bytes = await pdfDoc.save();
    let name = (args.filename || 'document').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'document';
    if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';

    const buf = Buffer.from(bytes);
    _latestPdf = { buffer: buf, filename: name };           // send queue (popped once)
    _lastBuiltPdf = { buffer: buf, filename: name, ts: Date.now() }; // persists for follow-up save
    delete _pages[key];
    if (context.senderJid) clearPendingImage(context.senderJid);

    console.log(`[PDF] Built ${name} — ${pages.length} page(s), ${Math.round(bytes.length / 1024)}KB`);
    return { success: true, filename: name, pages: pages.length };
  } catch (err) {
    return { error: `PDF creation failed: ${err.message}` };
  }
}

module.exports = { imageToPdf, addPageToPdf, popLatestPdf, peekLatestPdf, setUploadedPdf };
