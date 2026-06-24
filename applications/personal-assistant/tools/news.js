'use strict';
const { getConfig } = require('../config-manager');
const { tavilySearch } = require('./web');

function getApiKey() {
  const config = getConfig();
  return config.integrations?.newsapi?.apiKey || process.env.NEWS_API_KEY;
}

async function getNewsFromTavily({ topic, country, count }) {
  const query = topic
    ? `${topic} news today`
    : `${country === 'ca' ? 'Canada' : country} top news today`;
  const results = await tavilySearch({ query, count, search_depth: 'basic' });
  if (!results || !results.results?.length) return null;
  return {
    topic: topic || `${country} headlines`,
    total: results.results.length,
    articles: results.results.map(r => ({
      title: r.title,
      source: new URL(r.url).hostname.replace(/^www\./, ''),
      url: r.url,
      summary: r.snippet,
    })),
    source: 'tavily',
  };
}

async function getNews({ topic = '', category = '', country = 'ca', count = 5 }) {
  const key = getApiKey();

  // Try NewsAPI first if key is present
  if (key) {
    try {
      let url;
      if (topic) {
        const params = new URLSearchParams({ q: topic, language: 'en', pageSize: count, apiKey: key });
        url = `https://newsapi.org/v2/top-headlines?${params}`;
      } else {
        const params = new URLSearchParams({ country, pageSize: count, apiKey: key });
        if (category) params.set('category', category);
        url = `https://newsapi.org/v2/top-headlines?${params}`;
      }

      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await resp.json();

      if (data.status === 'ok' && data.articles?.length) {
        const articles = data.articles.slice(0, count).map(a => ({
          title: a.title,
          source: a.source?.name,
          published: a.publishedAt?.slice(0, 10),
          url: a.url,
          summary: (a.description || '').slice(0, 250),
        }));
        return { topic: topic || category || `${country} headlines`, total: data.totalResults, articles, source: 'newsapi' };
      }

      console.warn(`[NEWS] NewsAPI returned status=${data.status} articles=${data.articles?.length ?? 0} code=${data.code || ''} — falling back to Tavily`);
    } catch (err) {
      console.warn(`[NEWS] NewsAPI error: ${err.message} — falling back to Tavily`);
    }
  }

  // Fallback: Tavily web search for news
  const tavilyResult = await getNewsFromTavily({ topic, country, count });
  if (tavilyResult) return tavilyResult;

  return { error: 'Could not retrieve news from any source. Try again shortly.' };
}

function isConfigured() { return !!(getApiKey() || process.env.TAVILY_API_KEY); }

module.exports = { getNews, isConfigured };
