'use strict';

/**
 * Receipt capture pipeline:
 *  1. uploadReceiptImage()  — saves image to OneDrive /Receipts/YYYY-MM/
 *  2. ensureWorkbook()      — creates Receipts.xlsx if it doesn't exist
 *  3. addReceiptRow()       — appends a row to the Receipts Excel table
 *  4. saveReceipt()         — orchestrates all three (called by LLM tool)
 *
 * The image buffer is passed through context.imageBuffer (set in agents.js from
 * the imageInfo that was already downloaded for vision analysis).
 */

const AdmZip = require('adm-zip');
const { getAccessToken } = require('./m365');
const { getPendingImage, clearPendingImage } = require('./image-store');

const RECEIPTS_FOLDER = 'Receipts';
const WORKBOOK_NAME   = 'Receipts.xlsx';
const TABLE_NAME      = 'Receipts';
const COLUMNS         = ['Date', 'Vendor', 'Subtotal', 'Tax', 'Total', 'Category', 'Notes', 'Receipt Link'];

// ─── Graph helper (binary upload) ────────────────────────────────────────────
async function graphUpload(endpoint, buffer, contentType) {
  const token = await getAccessToken();
  if (!token) return { error: 'M365 not configured or token unavailable.' };

  const resp = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: buffer,
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { error: `Graph upload ${resp.status}: ${body.slice(0, 300)}` };
  }
  return resp.json();
}

async function graphPost(endpoint, body) {
  const token = await getAccessToken();
  if (!token) return { error: 'M365 not configured or token unavailable.' };

  const resp = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { error: `Graph ${resp.status}: ${text.slice(0, 300)}` };
  }
  if (resp.status === 204) return {};
  return resp.json();
}

async function graphGet(endpoint) {
  const token = await getAccessToken();
  if (!token) return { error: 'M365 not configured or token unavailable.' };
  const resp = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return { error: `Graph ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
  return resp.json();
}

async function graphPatch(endpoint, body) {
  const token = await getAccessToken();
  if (!token) return { error: 'M365 not configured or token unavailable.' };
  const resp = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { error: `Graph PATCH ${resp.status}: ${text.slice(0, 300)}` };
  }
  if (resp.status === 204) return {};
  return resp.json();
}

// ─── Create minimal valid xlsx (no table, inline strings — most compatible) ──
function buildXlsx() {
  const zip = new AdmZip();

  // Inline string cells for header row — no sharedStrings.xml dependency
  const colLetters = ['A','B','C','D','E','F','G','H'];
  const cells = COLUMNS.map((col, i) =>
    `<c r="${colLetters[i]}1" t="inlineStr"><is><t>${col}</t></is></c>`
  ).join('');

  zip.addFile('[Content_Types].xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`));

  zip.addFile('_rels/.rels', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`));

  zip.addFile('xl/workbook.xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <fileVersion appName="xl" lastEdited="7" lowestEdited="7"/>
  <sheets><sheet name="Receipts" sheetId="1" r:id="rId1"/></sheets>
</workbook>`));

  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`));

  zip.addFile('xl/styles.xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`));

  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1">${cells}</row></sheetData>
</worksheet>`));

  return zip.toBuffer();
}

// ─── Ensure Receipts.xlsx exists and is openable by the Excel API ────────────
async function ensureWorkbook() {
  const filePath = `/users/ali@midastech.ca/drive/root:/${RECEIPTS_FOLDER}/${WORKBOOK_NAME}`;

  // Check if file exists
  const check = await graphGet(filePath);
  if (!check.error) {
    // Verify the Excel API can actually open it (catches corrupt/minimal files)
    const verify = await graphGet(`${filePath}:/workbook/worksheets`);
    if (!verify.error) {
      console.log('[RECEIPTS] Workbook verified OK, id=', check.id);
      return { id: check.id, webUrl: check.webUrl };
    }
    // File exists but Excel API can't open it — delete and recreate
    console.warn('[RECEIPTS] Workbook exists but Excel API rejected it — recreating');
    await graphPost(`/users/ali@midastech.ca/drive/items/${check.id}`, null);
    // Use trash endpoint
    await fetch(`https://graph.microsoft.com/v1.0/users/ali@midastech.ca/drive/items/${check.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await getAccessToken()}` },
    }).catch(() => {});
  }

  // Create the folder if needed
  const folderCheck = await graphGet(`/users/ali@midastech.ca/drive/root:/${RECEIPTS_FOLDER}`);
  if (folderCheck.error) {
    const folderCreate = await graphPost(`/users/ali@midastech.ca/drive/root/children`, {
      name: RECEIPTS_FOLDER,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename',
    });
    if (folderCreate.error) return folderCreate;
    console.log('[RECEIPTS] Created /Receipts folder');
  }

  // Upload the blank workbook
  const xlsxBuffer = buildXlsx();
  const result = await graphUpload(
    `/users/ali@midastech.ca/drive/root:/${RECEIPTS_FOLDER}/${WORKBOOK_NAME}:/content`,
    xlsxBuffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  if (result.error) return result;
  console.log('[RECEIPTS] Created Receipts.xlsx, id=', result.id);
  return { id: result.id, webUrl: result.webUrl };
}

// ─── Upload receipt image to /Receipts/YYYY-MM/ ──────────────────────────────
async function uploadReceiptImage(imageBuffer, mimeType, date, vendor) {
  const month = date.slice(0, 7); // "2026-06"
  const ext   = mimeType?.includes('png') ? 'png' : 'jpg';
  const safeVendor = (vendor || 'receipt').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const filename   = `${date}_${safeVendor}.${ext}`;
  const path       = `/${RECEIPTS_FOLDER}/${month}/${filename}`;

  const result = await graphUpload(
    `/users/ali@midastech.ca/drive/root:${path}:/content`,
    imageBuffer,
    mimeType || 'image/jpeg'
  );
  if (result.error) return result;
  console.log(`[RECEIPTS] Image uploaded → ${path}`);
  return { path, webUrl: result.webUrl, id: result.id };
}

// ─── Append a row using worksheet range (no table dependency) ────────────────
async function addReceiptRow({ date, vendor, subtotal, tax, total, category, notes, receiptUrl }) {
  const base = `/users/ali@midastech.ca/drive/root:/${RECEIPTS_FOLDER}/${WORKBOOK_NAME}:/workbook/worksheets('Receipts')`;

  // Find the current used range to determine next empty row
  const used = await graphGet(`${base}/usedRange?$select=rowCount`);
  const nextRow = (used.error || !used.rowCount) ? 2 : used.rowCount + 1;

  const values = [[
    date || '',
    vendor || '',
    subtotal != null ? Number(subtotal) : '',
    tax != null ? Number(tax) : '',
    total != null ? Number(total) : '',
    category || '',
    notes || '',
    receiptUrl || '',
  ]];

  const address = `A${nextRow}:H${nextRow}`;
  const result = await graphPatch(`${base}/range(address='${address}')`, { values });
  if (result.error) return result;
  console.log(`[RECEIPTS] Row ${nextRow} written: ${date} | ${vendor} | $${total}`);
  return { success: true };
}

// ─── Main tool function ───────────────────────────────────────────────────────
async function saveReceipt(args, context = {}) {
  const { date, vendor, subtotal, tax, total, category, notes } = args;
  if (!date || !vendor || total == null) {
    return { error: 'date, vendor, and total are required to save a receipt' };
  }

  const results = { date, vendor, total };

  // 1. Ensure workbook exists
  const wb = await ensureWorkbook();
  if (wb.error) return { error: `Could not ensure workbook: ${wb.error}` };

  // 2. Upload receipt image — try current message buffer first, then pending store (follow-up messages)
  let receiptUrl = '';
  const pendingImg = !context.imageBuffer ? getPendingImage(context.senderJid) : null;
  const imgBuffer = context.imageBuffer || pendingImg?.buffer;
  const imgMime   = context.imageMimeType || pendingImg?.mimeType;
  if (imgBuffer) {
    const imgResult = await uploadReceiptImage(imgBuffer, imgMime, date, vendor);
    if (imgResult.error) {
      console.warn('[RECEIPTS] Image upload failed:', imgResult.error);
      results.imageWarning = imgResult.error;
    } else {
      receiptUrl = imgResult.webUrl || imgResult.sharingUrl || '';
      results.imageUrl = receiptUrl;
      results.imagePath = imgResult.path;
      if (context.senderJid) clearPendingImage(context.senderJid);
      console.log('[RECEIPTS] Image URL:', receiptUrl || '(no webUrl returned)');
    }
  } else {
    results.imageNote = 'No image buffer available — data logged without photo';
    console.log('[RECEIPTS] No image buffer in context or pending store for', context.senderJid);
  }

  // 3. Append row to Excel
  const row = await addReceiptRow({ date, vendor, subtotal, tax, total, category, notes, receiptUrl });
  if (row.error) return { error: `Row append failed: ${row.error}`, ...results };

  results.success = true;
  results.workbookUrl = wb.webUrl;
  return results;
}

function isConfigured() {
  try { const { isConfigured: m365ok } = require('./m365'); return m365ok(); } catch { return false; }
}

module.exports = { saveReceipt, isConfigured };
