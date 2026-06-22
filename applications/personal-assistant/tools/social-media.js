'use strict';

// Connects to the same Supabase project as the LeadTracker Social Studio.
// Posts saved here appear in the LeadTracker "Saved Posts" tab.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABLE = 'social_posts';

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

async function sbFetch(path, options = {}) {
  if (!isConfigured()) {
    return { error: 'Supabase not configured — SUPABASE_URL or SUPABASE_SERVICE_KEY missing in Railway env vars.' };
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: { ...sbHeaders(), ...(options.headers || {}) }
    });
    if (resp.status === 204) return { success: true };
    const body = await resp.text();
    if (!resp.ok) return { error: `Supabase ${resp.status}: ${body.slice(0, 300)}` };
    return body ? JSON.parse(body) : { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function saveSocialPost({ platform, headline = '', category = '', caption, hashtags = '', cta = '', source_topic = '', notes = '', image_prompt = '' }) {
  if (!platform || !caption) return { error: 'platform and caption are required' };

  const payload = {
    platform: platform.toLowerCase(),
    headline,
    category,
    caption,
    hashtags,
    cta,
    notes,
    source_topic,
    status: 'draft',
    image_engine: 'post',
    image_style: image_prompt,
    image_url: '',
    attachment_image_url: '',
    attachment_image_name: '',
    target_audience: 'Business Owners & Decision Makers',
    brand_voice: 'premium trusted advisor',
    post_payload: { generatedByClaudia: true, caption, hashtags, cta, headline, category, imagePrompt: image_prompt }
  };

  const result = await sbFetch(TABLE, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (result.error) return result;
  const saved = Array.isArray(result) ? result[0] : result;
  return {
    success: true,
    id: saved?.id,
    platform,
    headline,
    message: `Saved to LeadTracker Social Studio as a draft. It will appear in the Saved Posts tab.`
  };
}

async function listSocialPosts({ platform = '', limit = 20 } = {}) {
  let q = `${TABLE}?select=id,platform,headline,category,caption,hashtags,cta,source_topic,status,created_at&order=created_at.desc&limit=${limit}`;
  if (platform) q += `&platform=eq.${encodeURIComponent(platform.toLowerCase())}`;

  const result = await sbFetch(q, { method: 'GET', headers: { Prefer: '' } });
  if (result.error) return result;

  const posts = Array.isArray(result) ? result : [];
  return {
    count: posts.length,
    posts: posts.map(p => ({
      id: p.id,
      platform: p.platform,
      headline: p.headline,
      category: p.category,
      caption_preview: (p.caption || '').slice(0, 150) + ((p.caption || '').length > 150 ? '…' : ''),
      hashtags: p.hashtags,
      cta: p.cta,
      source_topic: p.source_topic,
      status: p.status,
      created_at: p.created_at
    }))
  };
}

async function deleteSocialPost({ id }) {
  if (!id) return { error: 'id is required' };
  const result = await sbFetch(`${TABLE}?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: '' } });
  if (result.error) return result;
  return { success: true, deleted: id };
}

module.exports = { saveSocialPost, listSocialPosts, deleteSocialPost, isConfigured };
