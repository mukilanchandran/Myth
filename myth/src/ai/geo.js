// Free, keyless map data for the Planner — every call degrades to null / []
// instead of throwing, so a plan still renders when a service is slow or down.
//   geocoding  → Open-Meteo geocoding (fallback: OSM Nominatim)
//   routing    → OSRM public demo server
//   weather    → Open-Meteo forecast
//   places     → OpenStreetMap via Overpass (fuel, food, stays, sights, health, ATMs)
// All of them allow browser calls (CORS) and need no account.
const cache = new Map();

async function getJSON(url, { timeout = 15000, method = 'GET', body, headers } = {}) {
  const key = `${method}:${url}:${body ?? ''}`;
  if (cache.has(key)) return cache.get(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method, body, headers, signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    cache.set(key, json);
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- geometry (pure; used by the planner tests too) ----------
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
export const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

// Points along a polyline every `everyKm`, each with its distance from the start.
export function samplePath(geometry, everyKm) {
  if (!geometry?.length) return [];
  const out = [{ ...geometry[0], km: 0 }];
  let acc = 0;
  let nextAt = everyKm;
  for (let i = 1; i < geometry.length; i++) {
    acc += haversineKm(geometry[i - 1], geometry[i]);
    if (acc >= nextAt) { out.push({ ...geometry[i], km: Math.round(acc) }); nextAt += everyKm; }
  }
  return out;
}

// Where along the route a position is: covered / remaining km and the index of the nearest vertex.
export function progressAlong(geometry, pos) {
  if (!geometry?.length || !pos) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < geometry.length; i++) {
    const d = haversineKm(geometry[i], pos);
    if (d < bestD) { bestD = d; best = i; }
  }
  let covered = 0;
  for (let i = 1; i <= best; i++) covered += haversineKm(geometry[i - 1], geometry[i]);
  let remaining = 0;
  for (let i = best + 1; i < geometry.length; i++) remaining += haversineKm(geometry[i - 1], geometry[i]);
  return { index: best, coveredKm: Math.round(covered), remainingKm: Math.round(remaining), offRouteKm: Math.round(bestD * 10) / 10 };
}

export const mapsLink = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
// For places we only know by name (the AI guide's suggestions): a maps search.
export const mapsSearchLink = (name, near) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(near ? `${name}, ${near}` : name)}`;

// ---------- geocoding ----------
// Photon (OSM search) first: it ranks "Goa" as Goa, India, where Open-Meteo's
// fuzzy search returns Genoa. India is preferred when the same name exists
// elsewhere; then an exact name match; then places over streets.
export async function geocode(name) {
  const q = String(name ?? '').trim();
  if (!q) return null;
  const ph = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, { timeout: 10000 });
  const feats = ph?.features ?? [];
  const lower = q.toLowerCase();
  const rank = (f) => {
    const p = f.properties ?? {};
    const inIndia = p.countrycode === 'IN' || p.country === 'India';
    const exact = (p.name ?? '').toLowerCase() === lower;
    const place = /city|state|town|county|village|region|district|locality|suburb|island/.test(`${p.type ?? ''} ${p.osm_value ?? ''}`);
    return (inIndia ? 4 : 0) + (exact ? 2 : 0) + (place ? 1 : 0);
  };
  const best = feats.filter((f) => f.geometry?.coordinates).sort((a, b) => rank(b) - rank(a))[0];
  if (best) {
    const [lon, lat] = best.geometry.coordinates;
    const p = best.properties;
    return { name: p.name ?? q, label: [p.name, p.state, p.country].filter(Boolean).join(', '), lat, lon, country: p.country ?? null, timezone: null };
  }
  const nm = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=en`);
  const n = nm?.[0];
  if (n) return { name: n.display_name.split(',')[0], label: n.display_name.split(',').slice(0, 3).join(','), lat: +n.lat, lon: +n.lon, country: null, timezone: null };
  const om = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
  const hit = om?.results?.find((r) => r.name.toLowerCase() === lower && r.country_code === 'IN') ?? om?.results?.find((r) => r.name.toLowerCase() === lower);
  if (!hit) return null;
  return { name: hit.name, label: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '), lat: hit.latitude, lon: hit.longitude, country: hit.country, timezone: hit.timezone };
}

export async function reverseGeocode(lat, lon) {
  const bd = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, { timeout: 10000 });
  if (bd && (bd.locality || bd.city)) {
    const parts = [bd.locality || bd.city, bd.city && bd.city !== bd.locality ? bd.city : null, bd.principalSubdivision].filter(Boolean);
    return [...new Set(parts)].slice(0, 3).join(', ');
  }
  const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14&accept-language=en`);
  const a = j?.address;
  if (!a) return null;
  const parts = [a.suburb ?? a.village ?? a.town ?? a.neighbourhood, a.city ?? a.county ?? a.state_district, a.state].filter(Boolean);
  return [...new Set(parts)].slice(0, 3).join(', ') || j.display_name?.split(',').slice(0, 2).join(',') || null;
}

// ---------- routing ----------
// profile: 'driving' | 'cycling'. Returns km, minutes and a simplified [ {lat,lon} ] polyline.
export async function route(from, to, profile = 'driving') {
  const all = await routeAlternatives(from, to, profile);
  return all[0] ?? null;
}

// Every road OSRM knows between two points (up to three), fastest first. Each
// carries the highways it follows so the planner can name it ("via NH48").
export async function routeAlternatives(from, to, profile = 'driving') {
  const j = await getJSON(`https://router.project-osrm.org/route/v1/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=simplified&geometries=geojson&alternatives=3&steps=true`, { timeout: 25000 });
  const routes = j?.routes ?? [];
  const out = routes.map((r, i) => {
    const names = [];
    for (const leg of r.legs ?? []) {
      for (const st of leg.steps ?? []) {
        const ref = st.ref ?? st.name;
        if (ref && st.distance > 15000 && !names.includes(ref)) names.push(ref);
      }
    }
    const via = names.slice(0, 3).map((n) => n.split(';')[0]);
    return {
      id: `r${i}`,
      km: Math.round(r.distance / 1000),
      minutes: Math.round(r.duration / 60),
      geometry: r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
      via,
      name: via.length ? `via ${via.join(' · ')}` : i === 0 ? 'Fastest' : `Alternative ${i}`,
    };
  });
  // OSRM sometimes returns the same road twice with a tiny detour — keep genuinely different ones
  return out.filter((r, i) => out.findIndex((x) => Math.abs(x.km - r.km) < 5 && Math.abs(x.minutes - r.minutes) < 8) === i);
}

// ---------- weather ----------
// Daily forecast between two dates (Open-Meteo covers 16 days ahead; beyond that → null).
export async function forecastRange(lat, lon, start, end) {
  const j = await getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=auto&start_date=${start}&end_date=${end}`,
  );
  const d = j?.daily;
  if (!d?.time?.length) return null;
  return d.time.map((date, i) => ({
    date, code: d.weather_code[i], tmax: Math.round(d.temperature_2m_max[i]), tmin: Math.round(d.temperature_2m_min[i]),
    rainProb: d.precipitation_probability_max?.[i] ?? null, rainMm: d.precipitation_sum?.[i] ?? null,
  }));
}

// Current conditions plus the next 12 hours.
export async function weatherNow(lat, lon) {
  const j = await getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&hourly=temperature_2m,weather_code,precipitation_probability&timezone=auto&forecast_days=2`,
    { timeout: 12000 },
  );
  if (!j?.current) return null;
  const nowIso = j.current.time;
  const idx = Math.max(0, j.hourly.time.findIndex((t) => t >= nowIso));
  const hourly = j.hourly.time.slice(idx, idx + 12).map((time, k) => ({
    time, hour: time.slice(11, 16), temp: Math.round(j.hourly.temperature_2m[idx + k]),
    code: j.hourly.weather_code[idx + k], rainProb: j.hourly.precipitation_probability?.[idx + k] ?? 0,
  }));
  return {
    temp: Math.round(j.current.temperature_2m), feels: Math.round(j.current.apparent_temperature),
    code: j.current.weather_code, wind: Math.round(j.current.wind_speed_10m), rainNow: j.current.precipitation > 0, hourly,
  };
}

// ---------- places (Overpass) ----------
const KINDS = {
  fuel: ['["amenity"="fuel"]'],
  food: ['["amenity"~"restaurant|cafe|fast_food|food_court"]'],
  stay: ['["tourism"~"hotel|guest_house|resort|hostel|apartment|motel|chalet"]'],
  attraction: [
    '["tourism"~"attraction|viewpoint|museum|zoo|theme_park|aquarium|gallery"]',
    '["natural"~"beach|waterfall|peak|cave_entrance|hot_spring"]',
    '["historic"~"monument|castle|fort|temple|ruins|archaeological_site|palace|memorial"]',
    '["leisure"~"park|garden|nature_reserve"]',
  ],
  health: ['["amenity"~"hospital|pharmacy|clinic|doctors"]'],
  atm: ['["amenity"~"atm|bank"]'],
  parking: ['["amenity"="parking"]'],
};
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// Public Overpass mirrors rate-limit per IP, so calls run one at a time and a
// refused mirror is followed by the next one after a short pause.
let chain = Promise.resolve();
function overpass(query) {
  const run = async () => {
    for (let i = 0; i < ENDPOINTS.length; i++) {
      const j = await getJSON(ENDPOINTS[i], { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
      if (j?.elements) return j.elements;
      if (i < ENDPOINTS.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }
    return [];
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

function kindOf(tags) {
  if (tags.amenity === 'fuel') return 'fuel';
  if (/restaurant|cafe|fast_food|food_court/.test(tags.amenity ?? '')) return 'food';
  if (/hotel|guest_house|resort|hostel|apartment|motel|chalet/.test(tags.tourism ?? '')) return 'stay';
  if (/hospital|pharmacy|clinic|doctors/.test(tags.amenity ?? '')) return 'health';
  if (/atm|bank/.test(tags.amenity ?? '')) return 'atm';
  if (tags.amenity === 'parking') return 'parking';
  return 'attraction';
}

function normalize(el, origin) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  const tags = el.tags ?? {};
  const kind = kindOf(tags);
  const sub = tags.tourism ?? tags.natural ?? tags.historic ?? tags.leisure ?? tags.amenity ?? '';
  const importance = (tags.wikidata ? 3 : 0) + (tags.wikipedia ? 2 : 0) + (tags.name ? 1 : 0) + (tags.tourism === 'attraction' ? 1 : 0) + (tags.stars ? 1 : 0);
  return {
    id: `${el.type}/${el.id}`, name: tags.name ?? tags.brand ?? null, kind, sub: sub.replace(/_/g, ' '),
    lat, lon, tags: { cuisine: tags.cuisine, brand: tags.brand, stars: tags.stars, phone: tags.phone ?? tags['contact:phone'], website: tags.website, opening: tags.opening_hours },
    importance,
    km: origin ? Math.round(haversineKm(origin, { lat, lon }) * 10) / 10 : null,
  };
}

// Places of the given kinds around one point. `kinds` = ['fuel','food',…].
export async function nearby(center, kinds, radiusM = 5000, limitPerKind = 25) {
  const clauses = kinds.flatMap((k) => (KINDS[k] ?? []).flatMap((sel) => [`node(around:${radiusM},${center.lat},${center.lon})${sel};`, `way(around:${radiusM},${center.lat},${center.lon})${sel};`]));
  if (!clauses.length) return [];
  const els = await overpass(`[out:json][timeout:25];(${clauses.join('')});out center tags 400;`);
  const seen = new Set();
  const out = [];
  for (const el of els) {
    const p = normalize(el, center);
    if (!p || !kinds.includes(p.kind)) continue;
    if (p.kind !== 'fuel' && p.kind !== 'parking' && !p.name) continue; // unnamed cafés and hotels are noise
    const key = `${p.kind}|${(p.name ?? '').toLowerCase()}|${p.lat.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  const byKind = {};
  for (const p of out) (byKind[p.kind] ??= []).push(p);
  return Object.values(byKind).flatMap((list) =>
    list.sort((a, b) => (a.kind === 'attraction' ? b.importance - a.importance || a.km - b.km : a.km - b.km)).slice(0, limitPerKind),
  );
}

// Fuel stations near sample points along a route — one Overpass call for all of them.
export async function fuelAlong(geometry, everyKm = 120, radiusM = 6000) {
  let total = 0;
  for (let i = 1; i < (geometry?.length ?? 0); i++) total += haversineKm(geometry[i - 1], geometry[i]);
  const step = Math.max(everyKm, Math.ceil(total / 10)); // never more than ~10 sample points, however long the road
  const samples = samplePath(geometry, step).slice(1);
  if (!samples.length) return [];
  const clauses = samples.map((s) => `node(around:${radiusM},${s.lat},${s.lon})["amenity"="fuel"];`).join('');
  const els = await overpass(`[out:json][timeout:25];(${clauses});out center tags 200;`);
  const out = [];
  for (const el of els) {
    const p = normalize(el, null);
    if (!p) continue;
    let nearest = samples[0];
    let d = Infinity;
    for (const s of samples) { const dd = haversineKm(s, p); if (dd < d) { d = dd; nearest = s; } }
    out.push({ ...p, km: nearest.km, offKm: Math.round(d * 10) / 10 });
  }
  // one or two per sample point, nearest to the road first
  const perKm = {};
  for (const p of out.sort((a, b) => a.km - b.km || a.offKm - b.offKm)) {
    (perKm[p.km] ??= []);
    if (perKm[p.km].length < 2) perKm[p.km].push(p);
  }
  return Object.values(perKm).flat();
}

// Browser geolocation as a promise / watcher. Never throws.
export function watchPosition(onPos, onError) {
  if (!navigator.geolocation) { onError?.('Geolocation is not available in this browser.'); return () => {}; }
  const id = navigator.geolocation.watchPosition(
    (p) => onPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
    (e) => onError?.(e.code === 1 ? 'Location permission was denied.' : 'Could not read your location.'),
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
