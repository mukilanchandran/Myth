// The Planner's research brain. The map services give real coordinates; the
// model (ChatGPT when a planner key is set in Settings, otherwise the same AI
// the chat uses) gives what a knowledgeable friend would: the areas to stay
// in, the must-sees and hidden gems, what to eat, every way to get there,
// several themed itineraries and the practical tips. Everything degrades to
// null/[] so the rule-based plan still renders when the model is offline.
import dayjs from 'dayjs';
import { estimateBudget, STYLE_META } from './planner.js';
import { mapsSearchLink } from './geo.js';

// The model transport and the everyday-assistant resolver are loaded on first
// use: they read Vite's import.meta.env, and the pure helpers below (map
// linking, themes, transport options) must also run in plain node tests.
const OPENAI = { endpoint: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' };
const transport = () => import('./llm.js');
const everyday = () => import('./assistant.js');

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

function jsonIn(text) {
  if (!text) return null;
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { /* try a fenced block */ }
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Which model does the planner's research: a dedicated ChatGPT key wins, else the everyday assistant. */
export async function resolvePlannerAI(state) {
  const { plannerAiKey, plannerAiEndpoint, plannerAiModel } = state.settings ?? {};
  if (plannerAiKey) {
    return { ok: true, endpoint: plannerAiEndpoint || OPENAI.endpoint, apiKey: plannerAiKey, model: plannerAiModel || OPENAI.defaultModel, dedicated: true };
  }
  const { resolveAI } = await everyday();
  return resolveAI(state);
}

const str = (v, n = 160) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

// Shape the model's answer into exactly what the UI expects (and nothing else).
function normalizeGuide(json) {
  if (!json || typeof json !== 'object') return null;
  const g = {
    overview: str(json.overview, 600),
    bestTime: str(json.bestTime ?? json.best_time, 220),
    areas: arr(json.areas).map((a) => ({ name: str(a.name, 60), why: str(a.why, 200), budget: str(a.budget ?? a.price, 60) })).filter((a) => a.name).slice(0, 6),
    mustSee: arr(json.mustSee ?? json.must_see).map((p) => ({ name: str(p.name, 70), kind: str(p.kind, 24).toLowerCase(), why: str(p.why, 200), time: str(p.time, 30), bestAt: str(p.bestAt ?? p.best_at, 40), cost: str(p.cost, 40) })).filter((p) => p.name).slice(0, 16),
    hiddenGems: arr(json.hiddenGems ?? json.hidden_gems).map((p) => ({ name: str(p.name, 70), why: str(p.why, 200) })).filter((p) => p.name).slice(0, 8),
    food: arr(json.food).map((f) => ({ name: str(f.name, 70), what: str(f.what ?? f.why, 160), area: str(f.area, 60) })).filter((f) => f.name).slice(0, 10),
    stays: arr(json.stays).map((s) => ({ name: str(s.name, 70), tier: /lux|premium|resort/i.test(s.tier) ? 'luxury' : /budget|hostel|cheap/i.test(s.tier) ? 'budget' : 'mid', area: str(s.area, 60), price: str(s.price, 50), why: str(s.why, 160) })).filter((s) => s.name).slice(0, 12),
    routes: arr(json.routes).map((r) => ({ name: str(r.name, 60), summary: str(r.summary, 220), km: num(r.km), hours: num(r.hours), stops: arr(r.stops).map((s) => str(s, 60)).filter(Boolean).slice(0, 6), notes: str(r.notes, 200) })).filter((r) => r.name).slice(0, 4),
    transport: arr(json.transport).map((t) => ({ mode: str(t.mode, 20).toLowerCase(), how: str(t.how, 220), cost: str(t.cost, 60), hours: num(t.hours), note: str(t.note, 160) })).filter((t) => t.mode).slice(0, 6),
    themes: arr(json.themes).map((t) => ({
      id: str(t.id ?? t.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: str(t.name, 50), tagline: str(t.tagline, 120),
      days: arr(t.days).map((d) => ({
        day: Number(d.day) || 0,
        title: str(d.title, 60),
        items: arr(d.items).map((it) => ({ time: /^\d{1,2}:\d{2}$/.test(it.time ?? '') ? String(it.time).padStart(5, '0') : null, kind: ['sight', 'food', 'travel', 'fuel', 'free', 'stay'].includes(it.kind) ? it.kind : 'sight', title: str(it.title, 90), note: str(it.note, 160) || null })).filter((it) => it.title && it.time).slice(0, 8),
      })).filter((d) => d.day > 0 && d.items.length).slice(0, 14),
    })).filter((t) => t.id && t.days.length).slice(0, 5),
    events: arr(json.events).map((e) => ({ name: str(e.name, 80), when: str(e.when, 60), note: str(e.note, 160) })).filter((e) => e.name).slice(0, 6),
    tips: arr(json.tips).map((t) => str(t, 220)).filter(Boolean).slice(0, 10),
    packingExtras: arr(json.packingExtras ?? json.packing).map((t) => str(t, 60)).filter(Boolean).slice(0, 8),
    budgetNotes: str(json.budgetNotes ?? json.budget_notes, 300),
  };
  const filled = ['areas', 'mustSee', 'food', 'stays', 'routes', 'transport', 'themes', 'tips'].filter((k) => g[k].length).length;
  return filled >= 3 ? g : null;
}

/**
 * Research a destination with the model. ctx: { from, to, start, end, travellers, budget, style, transport, route, weather, pois }.
 * Returns the normalized guide or null. Never throws.
 */
export async function aiDestinationGuide(ctx, state) {
  try {
    const ai = await resolvePlannerAI(state);
    if (!ai.ok) return null;
    const { streamChat } = await transport();
    const days = Math.max(1, dayjs(ctx.end ?? ctx.start).diff(dayjs(ctx.start), 'day') + 1);
    const known = [...(ctx.pois?.attractions ?? []).slice(0, 20), ...(ctx.pois?.stays ?? []).slice(0, 8), ...(ctx.pois?.food ?? []).slice(0, 8)].map((p) => p.name).filter(Boolean);
    const text = await withTimeout(streamChat({
      endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: [
            'You are an expert travel researcher for Indian and international destinations. Reply with ONLY one JSON object, no prose, no markdown fences.',
            'Be specific and real: actual place names, neighbourhoods, roads, dishes and typical Indian-rupee prices. Never invent hotels; use well-known real ones or describe the area and type instead. Keep every string short.',
            'Schema: {"overview":"2-3 sentences","bestTime":"...","areas":[{"name":"","why":"","budget":"₹ per night range"}],"mustSee":[{"name":"","kind":"beach|fort|temple|museum|nature|market|viewpoint|activity|other","why":"","time":"e.g. 2 h","bestAt":"morning|sunset|...","cost":"free|₹..."}],"hiddenGems":[{"name":"","why":""}],"food":[{"name":"dish or place","what":"","area":""}],"stays":[{"name":"","tier":"budget|mid|luxury","area":"","price":"₹ per night","why":""}],"routes":[{"name":"via NH..","summary":"","km":0,"hours":0,"stops":["worth a stop on the way"],"notes":"road condition, tolls, night driving"}],"transport":[{"mode":"car|bike|train|bus|flight","how":"which train/airport/bus stand, booking tips","cost":"₹ per person","hours":0,"note":""}],"themes":[{"id":"slug","name":"Theme name","tagline":"","days":[{"day":1,"title":"","items":[{"time":"09:00","kind":"sight|food|travel|free|stay","title":"","note":""}]}]}],"events":[{"name":"","when":"","note":""}],"tips":[""],"packingExtras":[""],"budgetNotes":""}',
            'Counts: areas 4-6, mustSee 10-15, hiddenGems 4-6, food 6-8, stays 6-9 spread across all three tiers, routes 2-3 (only when a starting point is given), transport: every mode that makes sense, themes: 3-4 different full itineraries (e.g. Nature & waterfalls, Heritage & culture, Food & markets, Beaches & sunsets, Adventure) each covering EVERY day of the trip with 4-6 timed items a day, tips 6-8, events: festivals/markets around the dates or [].',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Destination: ${ctx.to}${ctx.from ? `. Starting from: ${ctx.from}` : ''}. Dates: ${ctx.start}${ctx.end && ctx.end !== ctx.start ? ` to ${ctx.end}` : ''} (${days} day${days === 1 ? '' : 's'}). Travellers: ${ctx.travellers ?? 2}. Style: ${STYLE_META[ctx.style]?.name ?? ctx.style ?? 'balanced'}. Transport: ${ctx.transport ?? 'car'}.${ctx.budget ? ` Budget: ₹${ctx.budget} total.` : ''}${ctx.route ? ` Road distance: ${ctx.route.km} km, about ${Math.round(ctx.route.minutes / 60)} h.` : ''}${known.length ? ` Places I already found on the map (reuse these names where relevant): ${known.join('; ')}.` : ''} Today is ${dayjs().format('YYYY-MM-DD')}.`,
        },
      ],
    }), 75000);
    const guide = normalizeGuide(jsonIn(text));
    return guide ? { ...guide, model: ai.model, dedicated: !!ai.dedicated } : null;
  } catch {
    return null;
  }
}

// ---------- joining the guide with the map ----------
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Give every guide place a map link: exact/partial match to an OSM place when possible, otherwise a maps search near the destination. */
export function linkGuideToMap(guide, pois, toName) {
  if (!guide) return guide;
  const all = [...(pois?.attractions ?? []), ...(pois?.food ?? []), ...(pois?.stays ?? [])];
  const find = (name) => {
    const n = norm(name);
    if (!n) return null;
    return all.find((p) => norm(p.name) === n) ?? all.find((p) => p.name && (norm(p.name).includes(n) || n.includes(norm(p.name))) && norm(p.name).length > 4) ?? null;
  };
  const link = (list) => list.map((x) => {
    const p = find(x.name);
    return p ? { ...x, lat: p.lat, lon: p.lon, poi: p.id, mapUrl: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}` } : { ...x, mapUrl: mapsSearchLink(x.name, toName) };
  });
  return { ...guide, mustSee: link(guide.mustSee), hiddenGems: link(guide.hiddenGems), food: link(guide.food), stays: link(guide.stays), areas: link(guide.areas) };
}

/** The guide's themed itineraries as extra variants next to the rule-based ones. */
export function themesToVariants(guide, ctx, days) {
  if (!guide?.themes?.length) return [];
  const start = dayjs(ctx.start);
  const nights = Math.max(0, days - 1);
  const all = [...(ctx.pois?.attractions ?? []), ...(ctx.pois?.food ?? []), ...(ctx.pois?.stays ?? [])];
  const poiFor = (title) => { const n = norm(title); return all.find((p) => p.name && norm(p.name) === n)?.id ?? all.find((p) => p.name && norm(p.name).length > 4 && n.includes(norm(p.name)))?.id ?? null; };
  const weatherByDate = Object.fromEntries((ctx.weather ?? []).map((d) => [d.date, d]));
  return guide.themes.map((t) => {
    const byDay = new Map(t.days.map((d) => [d.day, d]));
    const dayPlans = [];
    for (let d = 1; d <= days; d++) {
      const src = byDay.get(d);
      const date = start.add(d - 1, 'day').format('YYYY-MM-DD');
      const items = (src?.items ?? []).map((it) => ({ ...it, poi: it.kind === 'sight' || it.kind === 'food' || it.kind === 'stay' ? poiFor(it.title) : null })).sort((a, b) => a.time.localeCompare(b.time));
      dayPlans.push({ day: d, date, title: src?.title || (d === 1 ? 'Arrive & settle in' : d === days && days > 1 ? 'Last day' : `Day ${d}`), weather: weatherByDate[date] ?? null, items: items.length ? items : [{ time: '09:00', kind: 'free', title: 'Free day', note: 'the theme did not cover this day — mix in stops from the other plans' }], tips: [] });
    }
    const budget = estimateBudget({ days, nights, travellers: ctx.travellers ?? 2, style: 'balanced', transport: ctx.transport, route: ctx.route });
    return { id: `theme-${t.id}`, style: 'theme', name: t.name, tagline: t.tagline, stay: null, days: dayPlans, budget, source: 'guide' };
  });
}

// ---------- every way to get there ----------
const MODE_LABEL = { car: 'Car', bike: 'Bike', train: 'Train', bus: 'Bus', flight: 'Flight' };
export function transportOptions({ km, minutes, travellers = 2, from, to, guide }) {
  if (!km) return [];
  const byMode = Object.fromEntries((guide?.transport ?? []).map((t) => [t.mode, t]));
  const est = (mode) => estimateBudget({ days: 1, nights: 0, travellers, style: 'balanced', transport: mode, route: { km } }).transport;
  const hours = (h) => (h >= 1 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.round(h * 60)} min`);
  const rows = [
    { mode: 'car', hours: minutes ? minutes / 60 : km / 55, cost: est('car'), note: 'fuel + tolls, both ways' },
    { mode: 'bike', hours: km / 45, cost: est('bike'), note: 'fuel, both ways' },
    { mode: 'train', hours: km / 60 + 1, cost: est('train'), note: 'per booking, both ways' },
    { mode: 'bus', hours: km / 50 + 1, cost: est('bus'), note: 'sleeper / AC, both ways' },
    ...(km >= 350 ? [{ mode: 'flight', hours: 1.5 + km / 700 + 2.5, cost: est('flight'), note: 'incl. airport time, both ways' }] : []),
  ];
  return rows.map((r) => {
    const g = byMode[r.mode];
    return { ...r, label: MODE_LABEL[r.mode], time: hours(g?.hours ?? r.hours), costLabel: g?.cost || `≈ ₹${r.cost.toLocaleString('en-IN')}`, how: g?.how ?? null, extra: g?.note ?? null, from, to };
  });
}
