// Model-side helpers for the Planner. Everything here is optional: the
// rule-based plan is always built first and these only improve wording or
// re-order real places. They never invent places and never throw.
import { resolveAI } from './assistant';
import { resolvePlannerAI } from './tripGuide';
import { streamChat } from './llm';
import { APP_NAME } from '../config/env';

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
const jsonIn = (text) => { const m = text?.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

// Rewrite each variant's days using only the real places we found. Returns
// { [variantId]: days } or null. Item titles must be place names we passed or
// plain words like "Lunch" / "Check in" — anything else is dropped.
export async function aiTripItineraries(ctx, result, state) {
  try {
    const ai = await resolvePlannerAI(state);
    if (!ai.ok) return null;
    const names = new Set([...(ctx.pois.attractions ?? []), ...(ctx.pois.food ?? []), ...(ctx.pois.stays ?? [])].map((p) => p.name).filter(Boolean));
    const list = (arr, n) => arr.slice(0, n).map((p) => `${p.name} (${p.sub}${p.km != null ? `, ${p.km} km` : ''})`).join('; ');
    const text = await withTimeout(streamChat({
      endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 0.4,
      messages: [
        { role: 'system', content: 'You are a travel planner. Reply with ONLY JSON, no prose, no code fences: {"variants":[{"id":"balanced","days":[{"day":1,"items":[{"time":"09:00","kind":"sight|food|travel|fuel|free","title":"...","note":"..."}]}]}],"tips":["..."]}. Use ONLY the place names given for sights, food and stays; generic titles like "Lunch", "Check in", "Drive to X" are fine. Keep travel days realistic. Max 6 items a day.' },
        { role: 'user', content: `Trip: ${ctx.from ? `${ctx.from} → ` : ''}${ctx.to}, ${result.days} day(s) from ${ctx.start}, ${ctx.travellers ?? 2} travellers, ${ctx.transport}${ctx.route ? `, ${ctx.route.km} km / ${Math.round(ctx.route.minutes / 60)} h each way` : ''}. Weather: ${(ctx.weather ?? []).map((w) => `${w.date}: ${w.tmin}-${w.tmax}°, rain ${w.rainProb ?? '?'}%`).join('; ') || 'unknown'}. Sights: ${list(ctx.pois.attractions ?? [], 24)}. Food: ${list(ctx.pois.food ?? [], 10)}. Stays: ${list(ctx.pois.stays ?? [], 6)}. Write these variants: ${result.variants.map((v) => `${v.id} (${v.name}: ${v.tagline})`).join('; ')}. Add 3-5 practical tips specific to this trip.` },
      ],
    }), 40000);
    const json = jsonIn(text);
    if (!Array.isArray(json?.variants)) return null;
    const out = {};
    for (const v of json.variants) {
      const base = result.variants.find((x) => x.id === v.id);
      if (!base || !Array.isArray(v.days)) continue;
      const days = base.days.map((bd) => {
        const src = v.days.find((d) => Number(d.day) === bd.day);
        if (!src || !Array.isArray(src.items)) return bd;
        const items = src.items
          .filter((it) => it && typeof it.title === 'string' && /^\d{2}:\d{2}$/.test(it.time ?? ''))
          .map((it) => ({ time: it.time, kind: ['sight', 'food', 'travel', 'fuel', 'free'].includes(it.kind) ? it.kind : 'sight', title: String(it.title).slice(0, 90), note: it.note ? String(it.note).slice(0, 140) : null }))
          .filter((it) => it.kind !== 'sight' || names.has(it.title) || /^(?:lunch|dinner|breakfast|check.?in|check.?out|free|drive|depart|arrive|rest|beach time|walk)/i.test(it.title))
          .slice(0, 7);
        return items.length >= 2 ? { ...bd, items } : bd;
      });
      out[v.id] = { days, tips: Array.isArray(json.tips) ? json.tips.filter((t) => typeof t === 'string').slice(0, 5) : [] };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

// One spoken-style line for the Live screen from the facts already on it.
export async function aiLiveLine(facts, state) {
  try {
    const ai = await resolveAI(state);
    if (!ai.ok) return null;
    const text = await withTimeout(streamChat({
      endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 0.6,
      messages: [
        { role: 'system', content: `You are ${APP_NAME}, a calm co-pilot on a road trip. One or two sentences, max 40 words, plain text, no emojis. Use only the facts given.` },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    }), 12000);
    const clean = text?.replace(/\s+/g, ' ').trim();
    return clean && clean.length > 15 && clean.length < 320 ? clean : null;
  } catch {
    return null;
  }
}
