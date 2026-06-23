'use strict';
const path = require('path');
const fs   = require('fs');
const { getConfig } = require('../config-manager');
const { buildImagePrompt, pickImageType } = require('./social-image-prompt');

const LOGO_PATH   = path.join(__dirname, '../assets/midas-logo-white.png');
const FOOTER_PATH = path.join(__dirname, '../assets/midas-footer.png');
// Approximate character width for a given font size (DejaVu proportional estimate)
function approxTextWidth(text, fontSize) {
  return text.length * fontSize * 0.56;
}

// Wrap text into lines that fit within maxWidth pixels at given fontSize
function wrapText(text, fontSize, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (approxTextWidth(test, fontSize) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Build the SVG text overlay for a social infographic
function buildOverlaySvg({ headline, stat, bullets, cta, W = 1024, H = 1024, FOOTER_H = 80 }) {
  // Use system DejaVu fonts (installed via nixpacks.toml on Railway,
  // present on Ubuntu dev). Fallback chain covers both environments.
  const fontDefs = `<defs><style>
    .bold { font-family: 'DejaVu Sans Bold', 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; font-weight: bold; }
    .reg  { font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; font-weight: normal; }
  </style></defs>`;

  const PAD   = 52;
  const TW    = W - PAD * 2;
  const CONTENT_H = H - FOOTER_H;
  let y = 46;
  const els = [];

  // Dark gradient overlay
  els.push(`<defs>
    <linearGradient id="ov" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#080c1e" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#080c1e" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${CONTENT_H}" fill="url(#ov)"/>
  <rect y="${CONTENT_H}" width="${W}" height="${FOOTER_H}" fill="#080c1e" opacity="1"/>`);

  // Headline
  const headLines = wrapText(headline.toUpperCase(), 58, TW);
  for (const l of headLines) {
    // shadow
    els.push(`<text x="${PAD+2}" y="${y+2}" class="bold" font-size="58" fill="black" opacity="0.55">${escXml(l)}</text>`);
    els.push(`<text x="${PAD}"   y="${y}"   class="bold" font-size="58" fill="white">${escXml(l)}</text>`);
    y += 68;
  }
  y += 20;

  // Stat callout
  if (stat) {
    const s = stat.length > 88 ? stat.slice(0, 85) + '…' : stat;
    const sw = Math.min(TW, approxTextWidth(s, 20) + 44);
    const sh = 44;
    els.push(`<rect x="${PAD}" y="${y}" width="${sw}" height="${sh}" rx="6" fill="#c82828" opacity="0.88"/>`);
    els.push(`<text x="${PAD+20}" y="${y+28}" class="bold" font-size="20" fill="white">${escXml(s)}</text>`);
    y += sh + 26;
  }

  // Bullets
  if (bullets && bullets.length) {
    const lh = 24;
    const rpad = 8;
    for (const b of bullets.slice(0, 4)) {
      const txt = '▸  ' + b;
      const rh = lh + rpad * 2;
      els.push(`<rect x="${PAD-10}" y="${y-rpad}" width="${TW+20}" height="${rh}" rx="4" fill="white" opacity="0.11"/>`);
      els.push(`<text x="${PAD}" y="${y+lh-4}" class="reg" font-size="19" fill="white">${escXml(txt)}</text>`);
      y += rh + 6;
    }
    y += 18;
  }

  // CTA
  if (cta && y < CONTENT_H - 60) {
    const cw = Math.min(TW, approxTextWidth(cta, 20) + 64);
    const ch = 48;
    if (y + ch > CONTENT_H - 14) y = CONTENT_H - ch - 14;
    els.push(`<rect x="${PAD}" y="${y}" width="${cw}" height="${ch}" rx="8" fill="#006fa6" opacity="0.92"/>`);
    els.push(`<text x="${PAD+32}" y="${y+32}" class="bold" font-size="20" fill="white">${escXml(cta)}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${fontDefs}${els.join('')}</svg>`;
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// id-keyed cache for scheduler (expires 15 min)
const _imageCache = new Map();

// Last-generated buffer — always set after a successful call, cleared after delivery
let _latestBuffer = null;
let _latestAt = 0;

// Composites the pre-baked Midas Tech footer strip onto the generated image.
async function addBranding(imageBuffer) {
  let sharp;
  try { sharp = require('sharp'); } catch { return imageBuffer; }

  try {
    const fs = require('fs');
    if (!fs.existsSync(FOOTER_PATH)) {
      console.warn('[IMGGEN] Footer PNG not found, skipping branding');
      return imageBuffer;
    }

    const meta = await sharp(imageBuffer).metadata();
    const W = meta.width  || 1024;
    const H = meta.height || 1024;

    // Resize the pre-baked footer to match the image width
    const footerBuf = await sharp(FOOTER_PATH)
      .resize(W, null, { fit: 'fill' })
      .toBuffer();
    const footerMeta = await sharp(footerBuf).metadata();

    return await sharp(imageBuffer)
      .composite([{
        input: footerBuf,
        top: H - footerMeta.height,
        left: 0,
        blend: 'over'
      }])
      .png()
      .toBuffer();
  } catch (err) {
    console.warn('[IMGGEN] Branding composite failed (non-fatal):', err.message);
    return imageBuffer;
  }
}

async function generateImage({ headline = '', caption = '', platform = 'linkedin', topic = '', cta = '', image_type = '', prompt: rawPrompt = '' }) {
  const post = { headline, caption, platform, topic, cta };
  const hasPostData = headline || caption || topic;
  const prompt = hasPostData
    ? buildImagePrompt(post, platform, image_type || pickImageType(post))
    : rawPrompt;

  if (!prompt) return { error: 'headline/caption/topic or prompt required' };

  const config = getConfig();
  const configuredBase = config.llm?.baseUrl || '';
  const apiKey = process.env.OPENAI_API_KEY ||
    (configuredBase.includes('openai.com') ? config.llm?.apiKey : null);

  if (!apiKey) {
    return { error: 'Image generation needs an OpenAI key. Add OPENAI_API_KEY to your Railway environment variables.' };
  }

  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'medium' })
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { error: `Image gen ${resp.status}: ${err.slice(0, 300)}` };
    }

    const data = await resp.json();
    let buffer;
    const b64 = data.data?.[0]?.b64_json;
    const imageUrl = data.data?.[0]?.url;
    if (b64) {
      buffer = Buffer.from(b64, 'base64');
    } else if (imageUrl) {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) return { error: `Image download failed: ${imgResp.status}` };
      buffer = Buffer.from(await imgResp.arrayBuffer());
    } else {
      return { error: 'No image data returned' };
    }

    // Overlay real Midas Tech branding footer
    buffer = await addBranding(buffer);

    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    _imageCache.set(id, buffer);
    setTimeout(() => _imageCache.delete(id), 15 * 60 * 1000);

    // Always track the latest buffer so the WhatsApp handler can send it
    // regardless of whether the LLM includes the [IMAGE_ID:...] tag
    _latestBuffer = buffer;
    _latestAt = Date.now();

    console.log(`[IMGGEN] Generated+branded ${Math.round(buffer.length / 1024)}KB — id=${id}`);
    return { success: true, image_id: id };
  } catch (err) {
    return { error: `Image generation failed: ${err.message}` };
  }
}

function getImageBuffer(id) {
  return _imageCache.get(id) || null;
}

// Returns the most recently generated buffer (within 5 min) and clears it
function popLatestImageBuffer() {
  if (!_latestBuffer || Date.now() - _latestAt > 5 * 60 * 1000) return null;
  const buf = _latestBuffer;
  _latestBuffer = null;
  _latestAt = 0;
  return buf;
}

// Calls AI for background-only image, then overlays all text via Python/PIL.
// This guarantees 100% accurate text (correct numbers, no typos).
async function generateSocialImage({ headline, stat, bullets, cta, topic }) {
  const config = getConfig();
  const configuredBase = config.llm?.baseUrl || '';
  const apiKey = process.env.OPENAI_API_KEY ||
    (configuredBase.includes('openai.com') ? config.llm?.apiKey : null);

  if (!apiKey) {
    return { error: 'OPENAI_API_KEY not set in Railway environment variables.' };
  }

  // Step 1: AI generates BACKGROUND ONLY — no text, no numbers
  const bgPrompt = [
    `Dark navy blue cybersecurity background image for a professional IT security social media post.`,
    `Visual elements: A glowing email envelope with a red warning symbol, a fishing hook over a laptop,`,
    `and a translucent shield icon. Abstract digital circuit patterns in the background.`,
    `Color scheme: Very dark navy (#0a0f1e) with electric blue (#0077b5) and red (#dc3232) accents.`,
    `Cinematic lighting, high contrast, modern corporate look.`,
    `CRITICAL: NO text, NO numbers, NO letters, NO words anywhere in the image.`,
    `Pure visual elements only — text will be added in post-processing.`,
    `Topic context: ${topic || 'cybersecurity threat for Canadian SMBs'}`,
  ].join(' ');

  let bgBuffer;
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: bgPrompt, n: 1, size: '1024x1024', quality: 'medium' })
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { error: `Background gen ${resp.status}: ${err.slice(0, 300)}` };
    }
    const data = await resp.json();
    const b64 = data.data?.[0]?.b64_json;
    const url = data.data?.[0]?.url;
    if (b64) {
      bgBuffer = Buffer.from(b64, 'base64');
    } else if (url) {
      const imgResp = await fetch(url);
      bgBuffer = Buffer.from(await imgResp.arrayBuffer());
    } else {
      return { error: 'No background image returned' };
    }
  } catch (err) {
    return { error: `Background generation failed: ${err.message}` };
  }

  // Step 2: Add branding footer (no text overlay — posts deliver text separately)
  let finalBuffer = await addBranding(bgBuffer);

  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  _imageCache.set(id, finalBuffer);
  setTimeout(() => _imageCache.delete(id), 15 * 60 * 1000);
  _latestBuffer = finalBuffer;
  _latestAt = Date.now();

  console.log(`[IMGGEN] Social image done — ${Math.round(finalBuffer.length / 1024)}KB id=${id}`);
  return { success: true, image_id: id };
}

module.exports = { generateImage, generateSocialImage, getImageBuffer, popLatestImageBuffer };
