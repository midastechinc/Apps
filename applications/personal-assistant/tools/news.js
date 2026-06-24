'use strict';
const { getConfig } = require('../config-manager');

function getApiKey() {
  const config = getConfig();
  return config.integrations?.newsapi?.apiKey || process.env.NEWS_API_KEY;
}

async function getNews({ topic = '', category = '', country = 'ca', count = 5 }) {
  const key = getApiKey();
  if (!key) return { error: 'NewsAPI key not configured. Set NEWS_API_KEY in Railway environment variables.' };

  let url;
  if (topic) {
    // top-headlines supports q= on free plans; /v2/everything is paid-only
    const params = new URLSearchParams({ q: topic, language: 'en', pageSize: count, apiKey: key });
    url = `https://newsapi.org/v2/top-headlines?${params}`;
  } else {
    // Top headlines for a country/category
    const params = new URLSearchParams({ country, pageSize: count, apiKey: key });
    if (category) params.set('category', category);
    url = `https://newsapi.org/v2/top-headlines?${params}`;
  }

  const resp = await fetch(url);
  const data = await resp.json();

  if (data.status !== 'ok') return { error: `NewsAPI: ${data.message || data.code || data.status}` };

  const articles = (data.articles || []).slice(0, count).map(a => ({
    title: a.title,
    source: a.source?.name,
    published: a.publishedAt?.slice(0, 10),
    url: a.url,
    summary: (a.description || '').slice(0, 250),
  }));

  return { topic: topic || category || `${country} headlines`, total: data.totalResults, articles };
}

function isConfigured() { return !!getApiKey(); }

module.exports = { getNews, isConfigured };
