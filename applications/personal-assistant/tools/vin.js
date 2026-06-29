'use strict';

// Decode a VIN using the free NHTSA vPIC API — no API key required.
async function decodeVin({ vin } = {}) {
  if (!vin) return { error: 'vin is required' };
  const clean = String(vin).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 17) {
    return { error: `VIN should be 17 characters — got ${clean.length}. Double-check the number.` };
  }

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${clean}?format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return { error: `VIN decode service ${resp.status}` };
    const data = await resp.json();
    const r = data.Results?.[0];
    if (!r) return { error: 'No data returned for that VIN' };

    // Only surface the fields that are actually populated
    const pick = (label, val) => (val && val !== 'Not Applicable' && val.trim() ? { [label]: val } : {});
    const result = {
      vin: clean,
      ...pick('year', r.ModelYear),
      ...pick('make', r.Make),
      ...pick('model', r.Model),
      ...pick('trim', r.Trim),
      ...pick('body', r.BodyClass),
      ...pick('engine', [r.EngineCylinders ? `${r.EngineCylinders}cyl` : '', r.DisplacementL ? `${r.DisplacementL}L` : '', r.FuelTypePrimary]
        .filter(Boolean).join(' ')),
      ...pick('drive', r.DriveType),
      ...pick('transmission', r.TransmissionStyle),
      ...pick('doors', r.Doors),
      ...pick('plant', [r.PlantCity, r.PlantCountry].filter(Boolean).join(', ')),
      ...pick('vehicle_type', r.VehicleType),
    };

    if (r.ErrorCode && r.ErrorCode !== '0' && !result.make) {
      return { error: `VIN could not be decoded: ${r.ErrorText || 'invalid VIN'}` };
    }
    return result;
  } catch (err) {
    return { error: `VIN decode failed: ${err.message}` };
  }
}

function isConfigured() { return true; } // no key needed

module.exports = { decodeVin, isConfigured };
