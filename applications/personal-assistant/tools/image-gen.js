'use strict';
const { getConfig } = require('../config-manager');
const { buildImagePrompt, pickImageType } = require('./social-image-prompt');

// id-keyed cache for scheduler (expires 15 min)
const _imageCache = new Map();

// Last-generated buffer — always set after a successful call, cleared after delivery
let _latestBuffer = null;
let _latestAt = 0;

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

    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    _imageCache.set(id, buffer);
    setTimeout(() => _imageCache.delete(id), 15 * 60 * 1000);

    // Always track the latest buffer so the WhatsApp handler can send it
    // regardless of whether the LLM includes the [IMAGE_ID:...] tag
    _latestBuffer = buffer;
    _latestAt = Date.now();

    console.log(`[IMGGEN] Generated ${Math.round(buffer.length / 1024)}KB — id=${id}`);
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
