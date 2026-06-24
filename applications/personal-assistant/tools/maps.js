'use strict';
const { getConfig } = require('../config-manager');

function getApiKey() {
  const config = getConfig();
  // Reuse same key as geocoding if available, or use a dedicated maps key
  return process.env.GOOGLE_MAPS_API_KEY
    || config.integrations?.googleMaps?.apiKey
    || config.integrations?.geocode?.apiKey
    || process.env.GEOCODE_API_KEY;
}

async function getDistanceMatrix({ origins, destinations, mode = 'driving' }) {
  const key = getApiKey();
  if (!key) return { error: 'Google Maps API key not configured. Set GOOGLE_MAPS_API_KEY in Railway environment variables.' };

  if (!origins || !destinations) return { error: 'origins and destinations are required' };

  const origStr = Array.isArray(origins) ? origins.join('|') : origins;
  const destStr = Array.isArray(destinations) ? destinations.join('|') : destinations;

  const params = new URLSearchParams({
    origins: origStr,
    destinations: destStr,
    mode,
    departure_time: 'now',
    key,
  });
  if (mode === 'driving') params.set('traffic_model', 'best_guess');

  const resp = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`);
  const data = await resp.json();

  if (data.status !== 'OK') {
    return { error: `Maps Distance Matrix: ${data.status}${data.error_message ? ' — ' + data.error_message : ''}` };
  }

  const rows = (data.rows || []).map((row, ri) => ({
    origin: data.origin_addresses?.[ri] || origStr,
    destinations: (row.elements || []).map((el, di) => ({
      destination: data.destination_addresses?.[di] || destStr,
      distance: el.distance?.text,
      distance_m: el.distance?.value,
      duration: el.duration?.text,
      duration_in_traffic: el.duration_in_traffic?.text,
      status: el.status,
    })),
  }));

  return { mode, rows };
}

function isConfigured() { return !!getApiKey(); }

module.exports = { getDistanceMatrix, isConfigured };
