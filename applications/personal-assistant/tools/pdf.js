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

// Normalize any image buffer to a JPEG (pdf-lib only embeds JPEG/PNG natively)
async function toJpeg(buffer) {
  const sharp = require('sharp');
  return sharp(buffer).rotate().jpeg({ quality: 85 }).toBuffer();
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
      const jpeg = await toJpeg(page.buffer);
      const img = await pdfDoc.embedJpg(jpeg);
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
