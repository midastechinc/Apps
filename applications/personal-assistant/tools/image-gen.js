'use strict';
const path = require('path');
const { getConfig } = require('../config-manager');
const { buildImagePrompt, pickImageType } = require('./social-image-prompt');

const LOGO_PATH = path.join(__dirname, '../assets/midas-logo-white.png');

// id-keyed cache for scheduler (expires 15 min)
const _imageCache = new Map();

// Last-generated buffer — always set after a successful call, cleared after delivery
let _latestBuffer = null;
let _latestAt = 0;

// Composites the Midas Tech branded footer strip onto the generated image.
// Falls back silently if sharp is unavailable or errors.
async function addBranding(imageBuffer) {
  let sharp;
  try { sharp = require('sharp'); } catch { return imageBuffer; }

  try {
    const W = 1024;
    const H = 1024;
    const STRIP_H = 80;
    const LOGO_H = 52;

    // Resize the white logo to fit in the strip
    const logoBuffer = await sharp(LOGO_PATH)
      .resize(null, LOGO_H, { fit: 'inside' })
      .toBuffer();
    const logoMeta = await sharp(logoBuffer).metadata();
    const logoTop = H - STRIP_H + Math.round((STRIP_H - LOGO_H) / 2);
    const logoLeft = 18;
    const textX = logoLeft + logoMeta.width + 18;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="0" y="${H - STRIP_H}" width="${W}" height="${STRIP_H}" fill="rgba(0,0,0,0.78)"/>
      <text x="${textX}" y="${H - STRIP_H + 34}" font-family="sans-serif" font-size="19" font-weight="bold" fill="white">(905) 787-2038  |  info@midastech.ca  |  midastech.ca</text>
      <text x="${textX}" y="${H - STRIP_H + 58}" font-family="sans-serif" font-size="14" fill="rgba(255,255,255,0.75)">30 Via Renzo Dr, Suite #200, Richmond Hill, ON  L4S 0B8</text>
    </svg>`;

    return await sharp(imageBuffer)
      .composite([
        { input: Buffer.from(svg), blend: 'over' },
        { input: logoBuffer, top: logoTop, left: logoLeft, blend: 'over' }
      ])
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

module.exports = { generateImage, getImageBuffer, popLatestImageBuffer };
