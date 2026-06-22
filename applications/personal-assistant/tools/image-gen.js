'use strict';
const { getConfig } = require('../config-manager');

// Buffer cache — image_id → Buffer, auto-expires after 15 minutes
const _imageCache = new Map();

async function generateImage({ prompt }) {
  if (!prompt) return { error: 'prompt required' };

  const config = getConfig();

  // Use a dedicated OPENAI_API_KEY env var if set; otherwise fall back to the
  // configured LLM key only when it is already pointing at OpenAI.
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
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard'
      })
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { error: `DALL-E ${resp.status}: ${err.slice(0, 300)}` };
    }

    const data = await resp.json();

    // Handle both url (dall-e-3 default) and b64_json (gpt-image-1) responses
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
      return { error: 'No image data returned from DALL-E' };
    }
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
