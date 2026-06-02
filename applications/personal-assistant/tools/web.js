const { getConfig } = require('../config-manager');

async function webSearch({ query, count = 5 }) {
  const config = getConfig();
  const apiKey = config.integrations?.brave?.apiKey || process.env.BRAVE_API_KEY;
  if (!apiKey) return { error: 'Brave Search API key not configured. Add it in settings under integrations.brave.apiKey' };

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 10)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    }
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    return { error: `Brave Search ${response.status}: ${err.slice(0, 200)}` };
  }

  const data = await response.json();
  const results = (data.web?.results || []).slice(0, count).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description || ''
  }));

  if (results.length === 0) return { query, results: [], message: 'No results found' };
  return { query, results };
}

async function fetchWebpage({ url }) {
  if (!url) return { error: 'URL required' };
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudiaBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return { error: `HTTP ${response.status} from ${url}` };

    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) {
      return { error: `Unsupported content type: ${ct}` };
    }

    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim()
      .slice(0, 3000);

    return { url, content: text + (text.length === 3000 ? '... [truncated]' : '') };
  } catch (err) {
    return { error: `Fetch failed: ${err.message}` };
  }
}

function isConfigured() {
  return !!(getConfig().integrations?.brave?.apiKey || process.env.BRAVE_API_KEY);
}

module.exports = { webSearch, fetchWebpage, isConfigured };
