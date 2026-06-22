'use strict';
const { getConfig } = require('../config-manager');

// Buffer cache — image_id → Buffer, auto-expires after 15 minutes
const _imageCache = new Map();

async function generateImage({ prompt }) {
  if (!prompt) return { error: 'prompt required' };

  const config = getConfig();
  const apiKey = config.llm?.apiKey;
  if (!apiKey) return { error: 'API key not configured. Set it in the LLM Settings tab.' };

  const baseUrl = config.llm?.baseUrl || 'https://api.openai.com/v1';
  if (!baseUrl.includes('openai.com')) {
    return { error: 'Image generation requires OpenAI. Current LLM provider is not OpenAI.' };
  }

  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
        quality: 'standard'
      })
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { error: `DALL-E ${resp.status}: ${err.slice(0, 300)}` };
    }

    const data = await resp.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return { error: 'No image data returned from DALL-E' };

    const buffer = Buffer.from(b64, 'base64');
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    _imageCache.set(id, buffer);
    setTimeout(() => _imageCache.delete(id), 15 * 60 * 1000);

    console.log(`[IMGGEN] Generated ${Math.round(buffer.length / 1024)}KB — id=${id}`);
    return { success: true, image_id: id };
  } catch (err) {
    return { error: `Image generation failed: ${err.message}` };
  }
}

function getImageBuffer(id) {
  return _imageCache.get(id) || null;
}

module.exports = { generateImage, getImageBuffer };
