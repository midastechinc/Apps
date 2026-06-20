const NOMINATIM = 'https://nominatim.openstreetmap.org';
const HEADERS = { 'User-Agent': 'ClaudiaBot/1.0 (personal-assistant)' };

async function geocodeLocation({ lat, lng, nearby = null, radius = 500 }) {
  if (!lat || !lng) return { error: 'lat and lng are required' };
  const flat = parseFloat(lat);
  const flng = parseFloat(lng);
  if (isNaN(flat) || isNaN(flng)) return { error: 'Invalid coordinates' };

  // 1. Reverse geocode — get exact address
  let address = null;
  try {
    const resp = await fetch(
      `${NOMINATIM}/reverse?lat=${flat}&lon=${flng}&format=json&addressdetails=1&zoom=18`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      const a = data.address || {};
      const parts = [
        a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road,
        a.suburb || a.neighbourhood || a.quarter,
        a.city || a.town || a.village,
        a.state,
        a.postcode
      ].filter(Boolean);
      address = {
        display: data.display_name,
        street:  a.house_number ? `${a.house_number} ${a.road || ''}`.trim() : (a.road || null),
        area:    a.suburb || a.neighbourhood || null,
        city:    a.city || a.town || a.village || null,
        province: a.state || null,
        postal:  a.postcode || null,
        short:   parts.slice(0, 3).join(', ')
      };
    }
  } catch (err) {
    console.error('[GEOCODE] Reverse geocode failed:', err.message);
  }

  // 2. Optional nearby search via Overpass API
  let places = null;
  if (nearby) {
    const amenityMap = {
      coffee: 'cafe', cafe: 'cafe', restaurant: 'restaurant', food: 'restaurant',
      gas: 'fuel', 'gas station': 'fuel', fuel: 'fuel', petrol: 'fuel',
      pharmacy: 'pharmacy', hospital: 'hospital', clinic: 'clinic',
      grocery: 'supermarket', supermarket: 'supermarket', atm: 'atm', bank: 'bank',
      parking: 'parking', school: 'school', gym: 'fitness_centre',
      hotel: 'hotel', motel: 'motel'
    };
    const amenity = amenityMap[nearby.toLowerCase()] || nearby.toLowerCase();
    const r = Math.min(radius, 2000);

    try {
      const query = `[out:json][timeout:10];(node["amenity"="${amenity}"](around:${r},${flat},${flng});way["amenity"="${amenity}"](around:${r},${flat},${flng}););out center 8;`;
      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...HEADERS },
        signal: AbortSignal.timeout(12000)
      });
      if (resp.ok) {
        const data = await resp.json();
        places = (data.elements || []).slice(0, 6).map(el => {
          const elLat = el.lat ?? el.center?.lat;
          const elLng = el.lon ?? el.center?.lon;
          const dist = elLat && elLng ? Math.round(haversine(flat, flng, elLat, elLng)) : null;
          return {
            name:    el.tags?.name || el.tags?.brand || amenity,
            address: [el.tags?.['addr:housenumber'], el.tags?.['addr:street']].filter(Boolean).join(' ') || null,
            phone:   el.tags?.phone || el.tags?.['contact:phone'] || null,
            dist_m:  dist
          };
        }).sort((a, b) => (a.dist_m ?? 9999) - (b.dist_m ?? 9999));
      }
    } catch (err) {
      console.error('[GEOCODE] Overpass nearby search failed:', err.message);
    }
  }

  return { lat: flat, lng: flng, address, ...(places !== null ? { nearby_type: nearby, radius_m: radius, places } : {}) };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { geocodeLocation };
