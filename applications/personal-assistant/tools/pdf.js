'use strict';

const { getPendingImage, clearPendingImage } = require('./image-store');

// Per-sender accumulator for multi-page PDFs
const _pages = {}; // { [senderJid]: [{ buffer, mimeType }] }

// Latest built PDF, popped by whatsapp.js to send as a document
let _latestPdf = null; // { buffer, filename }

function popLatestPdf() {
  const p = _latestPdf;
  _latestPdf = null;
  return p;
}

// Read the last-built PDF without consuming it (so it can also be sent to WhatsApp)
function peekLatestPdf() {
  return _latestPdf;
}

// Resolve the image the user just sent — current message buffer first, then pending store
function resolveImage(context = {}) {
  if (context.imageBuffer) {
    return { buffer: context.imageBuffer, mimeType: context.imageMimeType || 'image/jpeg' };
  }
  const pending = getPendingImage(context.senderJid);
  return pending ? { buffer: pending.buffer, mimeType: pending.mimeType } : null;
}

function isJpeg(buf) { return buf && buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF; }
function isPng(buf) { return buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47; }

// Embed an image buffer into the PDF. Prefers direct embed (no sharp); falls back to
// sharp only for unusual formats, and only if sharp is actually available.
async function embedImage(pdfDoc, buffer) {
  if (isJpeg(buffer)) return pdfDoc.embedJpg(buffer);
  if (isPng(buffer))  return pdfDoc.embedPng(buffer);
  // Unknown format (webp, heic, etc.) — try sharp to convert to JPEG
  try {
    const sharp = require('sharp');
    const jpeg = await sharp(buffer).rotate().jpeg({ quality: 85 }).toBuffer();
    return pdfDoc.embedJpg(jpeg);
  } catch (err) {
    throw new Error(`Unsupported image format (and sharp unavailable: ${err.message})`);
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

    _latestPdf = { buffer: Buffer.from(bytes), filename: name };
    delete _pages[key];
    if (context.senderJid) clearPendingImage(context.senderJid);

    console.log(`[PDF] Built ${name} — ${pages.length} page(s), ${Math.round(bytes.length / 1024)}KB`);
    return { success: true, filename: name, pages: pages.length };
  } catch (err) {
    return { error: `PDF creation failed: ${err.message}` };
  }
}

module.exports = { imageToPdf, addPageToPdf, popLatestPdf, peekLatestPdf };
