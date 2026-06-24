'use strict';
const { getConfig } = require('../config-manager');

function getAlphaKey() {
  const config = getConfig();
  return config.integrations?.alphavantage?.apiKey || process.env.ALPHA_VANTAGE_API_KEY;
}

async function getStockPrice({ symbol }) {
  if (!symbol) return { error: 'symbol is required (e.g. "AAPL", "MSFT", "SHOP.TO")' };
  const sym = symbol.trim().toUpperCase();

  // Try Alpha Vantage if key configured
  const key = getAlphaKey();
  if (key) {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${key}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const q = data['Global Quote'];
    if (q?.['05. price']) {
      return {
        symbol: q['01. symbol'],
        price: parseFloat(q['05. price']),
        change: parseFloat(q['09. change']),
        change_percent: q['10. change percent']?.trim(),
        volume: parseInt(q['06. volume'], 10),
        previous_close: parseFloat(q['08. previous close']),
        latest_trading_day: q['07. latest trading day'],
        source: 'Alpha Vantage',
      };
    }
    if (data['Information']?.includes('rate limit') || data['Note']?.includes('rate limit')) {
      // Fall through to Yahoo fallback
      console.warn('[FINANCE] Alpha Vantage rate limit, falling back to Yahoo Finance');
    } else if (data['Information'] || data['Note']) {
      return { error: `Alpha Vantage: ${data['Information'] || data['Note']}` };
    }
  }

  // Yahoo Finance fallback (no API key needed)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return { error: `Stock lookup failed: HTTP ${resp.status}` };
    const data = await resp.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return { error: `No price data found for ${sym}` };
    const prev = meta.previousClose || meta.chartPreviousClose || 0;
    const price = meta.regularMarketPrice;
    const change = price - prev;
    return {
      symbol: meta.symbol || sym,
      price,
      currency: meta.currency,
      exchange: meta.exchangeName,
      previous_close: prev,
      change: Math.round(change * 100) / 100,
      change_percent: prev ? (change / prev * 100).toFixed(2) + '%' : '—',
      source: 'Yahoo Finance',
    };
  } catch (err) {
    return { error: `Stock lookup failed: ${err.message}` };
  }
}

async function convertCurrency({ amount = 1, from, to }) {
  if (!from || !to) return { error: 'from and to currency codes are required (e.g. "USD", "CAD", "GBP")' };
  from = from.toUpperCase();
  to = to.toUpperCase();
  if (amount <= 0) return { error: 'amount must be a positive number' };

  // open.er-api.com — free, no API key needed
  const resp = await fetch(`https://open.er-api.com/v6/latest/${from}`, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) return { error: `Exchange rate API: HTTP ${resp.status}` };
  const data = await resp.json();
  if (data.result === 'error') return { error: `Exchange rate API: ${data['error-type'] || 'unknown error'}` };
  if (!data.rates?.[to]) return { error: `No rate available for ${to}` };

  const rate = data.rates[to];
  const result = Math.round(amount * rate * 100) / 100;
  return {
    from, to, amount,
    rate: Math.round(rate * 10000) / 10000,
    result,
    updated: data.time_last_update_utc,
  };
}

function isConfigured() { return true; } // Yahoo Finance + free currency work without keys

module.exports = { getStockPrice, convertCurrency, isConfigured };
