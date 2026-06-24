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
  if (!resp.ok) return { error: `Graph ${resp.status}` };
  return resp.json();
}

// ─── Create minimal xlsx workbook with a named Table ─────────────────────────
function buildXlsx() {
  const zip = new AdmZip();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Receipts" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

  // Build shared strings from column headers
  const ssEntries = COLUMNS.map(c => `<si><t>${c}</t></si>`).join('');
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${COLUMNS.length}" uniqueCount="${COLUMNS.length}">
${ssEntries}
</sst>`;

  // Header row — cells reference shared strings by index
  const colLetters = ['A','B','C','D','E','F','G','H'];
  const cells = COLUMNS.map((_, i) => `<c r="${colLetters[i]}1" t="s"><v>${i}</v></c>`).join('');
  const lastCol = colLetters[COLUMNS.length - 1];

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>
    <row r="1">${cells}</row>
  </sheetData>
  <tableParts count="1"><tablePart r:id="rId1"/></tableParts>
</worksheet>`;

  const tableColumns = COLUMNS.map((c, i) => `<tableColumn id="${i+1}" name="${c}"/>`).join('');
  const table = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  id="1" name="${TABLE_NAME}" displayName="${TABLE_NAME}" ref="A1:${lastCol}1" totalsRowShown="0">
  <autoFilter ref="A1:${lastCol}1"/>
  <tableColumns count="${COLUMNS.length}">${tableColumns}</tableColumns>
  <tableStyleInfo name="TableStyleMedium9" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>
</table>`;

  zip.addFile('[Content_Types].xml',          Buffer.from(contentTypes));
  zip.addFile('_rels/.rels',                  Buffer.from(rootRels));
  zip.addFile('xl/workbook.xml',              Buffer.from(workbook));
  zip.addFile('xl/_rels/workbook.xml.rels',   Buffer.from(wbRels));
  zip.addFile('xl/styles.xml',                Buffer.from(styles));
  zip.addFile('xl/sharedStrings.xml',         Buffer.from(sharedStrings));
  zip.addFile('xl/worksheets/sheet1.xml',     Buffer.from(sheet));
  zip.addFile('xl/worksheets/_rels/sheet1.xml.rels', Buffer.from(sheetRels));
  zip.addFile('xl/tables/table1.xml',         Buffer.from(table));

  return zip.toBuffer();
}

// ─── Ensure Receipts.xlsx exists, create it if not ───────────────────────────
async function ensureWorkbook() {
  // Check if file exists
  const check = await graphGet(`/me/drive/root:/${RECEIPTS_FOLDER}/${WORKBOOK_NAME}`);
  if (!check.error) {
    console.log('[RECEIPTS] Workbook already exists, id=', check.id);
    return { id: check.id, webUrl: check.webUrl };
  }

  // Create the folder if needed
  const folderCheck = await graphGet(`/me/drive/root:/${RECEIPTS_FOLDER}`);
  if (folderCheck.error) {
    const folderCreate = await graphPost(`/me/drive/root/children`, {
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
    `/me/drive/root:/${RECEIPTS_FOLDER}/${WORKBOOK_NAME}:/content`,
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
    `/me/drive/root:${path}:/content`,
    imageBuffer,
    mimeType || 'image/jpeg'
  );
  if (result.error) return result;
  console.log(`[RECEIPTS] Image uploaded → ${path}`);
  return { path, webUrl: result.webUrl, id: result.id };
}

// ─── Append a row to the Receipts table ──────────────────────────────────────
async function addReceiptRow({ date, vendor, subtotal, tax, total, category, notes, receiptUrl }) {
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

  const result = await graphPost(
    `/me/drive/root:/${RECEIPTS_FOLDER}/${WORKBOOK_NAME}:/workbook/tables/${TABLE_NAME}/rows/add`,
    { values }
  );
  if (result.error) return result;
  console.log(`[RECEIPTS] Row added: ${date} | ${vendor} | $${total}`);
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
  const imgBuffer = context.imageBuffer || getPendingImage(context.senderJid)?.buffer;
  const imgMime   = context.imageMimeType || getPendingImage(context.senderJid)?.mimeType;
  if (imgBuffer) {
    const imgResult = await uploadReceiptImage(imgBuffer, imgMime, date, vendor);
    if (imgResult.error) {
      console.warn('[RECEIPTS] Image upload failed:', imgResult.error);
      results.imageWarning = `Image upload failed: ${imgResult.error}`;
    } else {
      receiptUrl = imgResult.webUrl || '';
      results.imageUrl = receiptUrl;
      clearPendingImage(context.senderJid); // consumed — remove from store
    }
  } else {
    console.log('[RECEIPTS] No image buffer available — row saved without image link');
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
