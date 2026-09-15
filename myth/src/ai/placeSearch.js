// Place-name autocomplete for the Planner: type "ko" and get Kodaikanal,
// Kochi, Kolkata… Photon (OpenStreetMap search) answers prefix queries and
// allows browser calls without a key; Open-Meteo's geocoder is the fallback.
// India ranks first when the same name exists elsewhere.
const cache = new Map();
const inflight = new Map();

function labelOf(p) {
  const bits = [p.name, p.city && p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean);
  return [...new Set(bits)].join(', ');
}

function rank(p, q) {
  const name = (p.name ?? '').toLowerCase();
  const inIndia = p.countrycode === 'IN' || p.country === 'India';
  const place = /city|state|town|county|village|region|district|locality|suburb|island|hamlet|municipality/.test(`${p.type ?? ''} ${p.osm_value ?? ''}`);
  const starts = name.startsWith(q);
  const exact = name === q;
  return (inIndia ? 4 : 0) + (place ? 3 : 0) + (starts ? 2 : 0) + (exact ? 2 : 0) + (p.osm_value === 'city' ? 1 : 0);
}

/** Suggestions for a partial place name → [{ name, label, lat, lon, country, state }]. Never throws. */
export async function suggestPlaces(query, { limit = 7 } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    let out = [];
    try {
      // two lookups at once: places only, biased to India (so "ko" finds Kodaikanal and
      // Kochi, not only Kolkata) and the same query unbiased for the rest of the world
      const base = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=en&osm_tag=place`;
      const [india, world] = await Promise.all([
        fetch(`${base}&limit=10&lat=20.5937&lon=78.9629&zoom=5&location_bias_scale=0.6`, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${base}&limit=8`, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const features = [...(india?.features ?? []), ...(world?.features ?? [])];
      if (features.length) {
        const seen = new Set();
        out = features
          .filter((f) => f.geometry?.coordinates && f.properties?.name)
          .map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
          .filter((p) => /place|boundary|natural|tourism/.test(p.osm_key ?? '') || !/highway|building|shop|amenity/.test(p.osm_key ?? ''))
          .sort((a, b) => rank(b, key) - rank(a, key))
          .map((p) => ({ name: p.name, label: labelOf(p), lat: p.lat, lon: p.lon, country: p.country ?? null, state: p.state ?? null }))
          .filter((p) => { const k = p.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, limit);
      }
    } catch { /* fall through to the second geocoder */ }
    if (!out.length) {
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${limit}&language=en&format=json`, { signal: AbortSignal.timeout(6000) });
        const json = res.ok ? await res.json() : null;
        out = (json?.results ?? [])
          .sort((a, b) => (b.country_code === 'IN') - (a.country_code === 'IN'))
          .map((r) => ({ name: r.name, label: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, country: r.country ?? null, state: r.admin1 ?? null }));
      } catch { /* offline */ }
    }
    cache.set(key, out);
    inflight.delete(key);
    return out;
  })();
  inflight.set(key, run);
  return run;
}
