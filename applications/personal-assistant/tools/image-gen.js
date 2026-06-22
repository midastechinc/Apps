'use strict';
const path = require('path');
const { getConfig } = require('../config-manager');
const { buildImagePrompt, pickImageType } = require('./social-image-prompt');

const LOGO_PATH   = path.join(__dirname, '../assets/midas-logo-white.png');
const FOOTER_PATH = path.join(__dirname, '../assets/midas-footer.png');

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

  // Step 2: Python composer overlays all text accurately
  let composedBuffer;
  try {
    const { spawnSync } = require('child_process');
    const composerPath = path.join(__dirname, 'image-composer.py');
    const payload = JSON.stringify({
      bg_b64: bgBuffer.toString('base64'),
      headline: headline || '',
      stat:     stat     || '',
      bullets:  bullets  || [],
      cta:      cta      || 'Book a free IT assessment → midastech.ca',
    });
    const result = spawnSync('python3', [composerPath], {
      input: payload,
      encoding: 'buffer',
      maxBuffer: 60 * 1024 * 1024,
      timeout: 30000,
    });
    if (result.status !== 0) {
      const stderr = result.stderr?.toString() || 'unknown error';
      console.warn('[IMGGEN] Composer error:', stderr.slice(0, 300));
      composedBuffer = bgBuffer; // fall back to raw background
    } else {
      composedBuffer = result.stdout;
      console.log(`[IMGGEN] Text overlay applied — ${Math.round(composedBuffer.length / 1024)}KB`);
    }
  } catch (err) {
    console.warn('[IMGGEN] Composer spawn failed:', err.message);
    composedBuffer = bgBuffer;
  }

  // Step 3: Add branding footer
  let finalBuffer = await addBranding(composedBuffer);

  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  _imageCache.set(id, finalBuffer);
  setTimeout(() => _imageCache.delete(id), 15 * 60 * 1000);
  _latestBuffer = finalBuffer;
  _latestAt = Date.now();

  console.log(`[IMGGEN] Social image done — ${Math.round(finalBuffer.length / 1024)}KB id=${id}`);
  return { success: true, image_id: id };
}

module.exports = { generateImage, generateSocialImage, getImageBuffer, popLatestImageBuffer };
