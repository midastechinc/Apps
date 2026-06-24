'use strict';
const { getConfig } = require('../config-manager');

function getApiKey() {
  const config = getConfig();
  return config.integrations?.openweather?.apiKey || process.env.OPENWEATHER_API_KEY;
}

async function getWeather({ location, lat, lon, units = 'metric' }) {
  const key = getApiKey();
  if (!key) return { error: 'OpenWeatherMap API key not configured. Set OPENWEATHER_API_KEY in Railway environment variables.' };

  let params;
  if (lat !== undefined && lon !== undefined) {
    params = `lat=${lat}&lon=${lon}`;
  } else if (location) {
    params = `q=${encodeURIComponent(location)}`;
  } else {
    return { error: 'Provide a location name or lat/lon coordinates' };
  }

  const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params}&appid=${key}&units=${units}`);
  const data = await resp.json();
  if (!resp.ok) return { error: `OpenWeatherMap: ${data.message || resp.status}` };

  return {
    location: data.name + (data.sys?.country ? `, ${data.sys.country}` : ''),
    description: data.weather?.[0]?.description || '',
    temp: data.main?.temp,
    feels_like: data.main?.feels_like,
    humidity: data.main?.humidity,
    wind_kph: data.wind?.speed != null ? Math.round(data.wind.speed * 3.6) : undefined,
    visibility_km: data.visibility != null ? (data.visibility / 1000).toFixed(1) : undefined,
    clouds_pct: data.clouds?.all,
    units: units === 'metric' ? '°C, km/h' : '°F, m/s',
    timezone_offset_h: data.timezone != null ? data.timezone / 3600 : undefined,
  };
}

async function getForecast({ location, lat, lon, days = 3, units = 'metric' }) {
  const key = getApiKey();
  if (!key) return { error: 'OpenWeatherMap API key not configured.' };

  let params;
  if (lat !== undefined && lon !== undefined) {
    params = `lat=${lat}&lon=${lon}`;
  } else if (location) {
    params = `q=${encodeURIComponent(location)}`;
  } else {
    return { error: 'Provide a location name or lat/lon coordinates' };
  }

  const cnt = Math.min(days, 5) * 8; // 8 slots per day (every 3h)
  const resp = await fetch(`https://api.openweathermap.org/data/2.5/forecast?${params}&appid=${key}&units=${units}&cnt=${cnt}`);
  const data = await resp.json();
  if (!resp.ok) return { error: `OpenWeatherMap forecast: ${data.message || resp.status}` };

  // Group by calendar date and summarise
  const byDay = {};
  for (const item of data.list || []) {
    const day = (item.dt_txt || '').split(' ')[0];
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { temps: [], descs: [] };
    byDay[day].temps.push(item.main?.temp ?? 0);
    byDay[day].descs.push(item.weather?.[0]?.description || '');
  }

  const forecast = Object.entries(byDay)
    .slice(0, Math.min(days, 5))
    .map(([date, d]) => ({
      date,
      high: Math.max(...d.temps).toFixed(1),
      low: Math.min(...d.temps).toFixed(1),
      description: d.descs[Math.floor(d.descs.length / 2)] || d.descs[0],
    }));

  return { location: data.city?.name, units, forecast };
}

function isConfigured() { return !!getApiKey(); }

module.exports = { getWeather, getForecast, isConfigured };
