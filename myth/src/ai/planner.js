// Myth Planner — the brain. Detects what kind of plan a sentence asks for,
// pulls the facts out of it (places, dates, people, budget, style), turns
// live map/weather data into day-by-day itineraries, and gives the Live mode
// its advice. Pure functions: no network, no React. The network lives in
// geo.js and the orchestration in tripEngine.js.
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import { haversineKm, bearingDeg, compass } from './geo.js';
import { titleCase } from './projectPlanner.js';

// ---------- modes ----------
export const MODES = {
  trip: { label: 'Trip', color: '#1971c2', hint: 'Start, destination, dates → itineraries, weather, stays, fuel, then live guidance on the road.' },
  event: { label: 'Event', color: '#e64980', hint: 'Wedding, party, conference → budget, venue, guests, run-of-show.' },
  study: { label: 'Study / exam', color: '#7048e8', hint: 'Syllabus → practice → mocks → revision, scheduled to the exam date.' },
  fitness: { label: 'Fitness', color: '#e8590c', hint: 'A race or a goal → base, build, peak, taper.' },
  business: { label: 'Business', color: '#1b5a38', hint: 'Validate, plan, set up, brand, build, launch.' },
  website: { label: 'Website / app', color: '#0D2D1C', hint: 'Research, content, design, build, test, launch.' },
  writing: { label: 'Writing', color: '#5f3dc4', hint: 'Outline, research, draft, edit, format, publish.' },
  home: { label: 'Home', color: '#f08c00', hint: 'Renovation or a move — scope, design, contractors, execution.' },
  career: { label: 'Career', color: '#1098ad', hint: 'Direction, profile, preparation, applications, offer.' },
  generic: { label: 'Project', color: '#495057', hint: 'Define, research, plan, build, review, deliver.' },
};
// mode → projectPlanner template key
export const MODE_TEMPLATE = { event: 'event', study: 'learning', fitness: 'fitness', business: 'business', website: 'website', writing: 'content', home: 'home', career: 'career', generic: 'generic', trip: 'travel' };

const MODE_WORDS = [
  ['trip', /\b(?:trip|travel(?:ling)?|vacation|holiday|tour|road\s*trip|drive\s+to|fly(?:ing)?\s+to|ride\s+to|going\s+to|visit(?:ing)?|getaway|weekend\s+(?:in|at)|pilgrimage|trek(?:king)?|honeymoon|backpack\w*|itinerary|from\s+\w+.*\bto\s+\w+)\b/i],
  ['event', /\b(?:wedding|marriage|reception|engagement|party|conference|meetup|workshop|hackathon|birthday|anniversary|function|ceremony|celebration|fundraiser|expo|event)\b/i],
  ['study', /\b(?:exam|study|syllabus|learn\w*|course|certification|certificate|degree|semester|test\s+prep|prepare\s+for|revision|mock\s+test|gate|neet|jee|upsc|ielts|toefl|gre|gmat)\b/i],
  ['fitness', /\b(?:marathon|10k|5k|half\s+marathon|triathlon|workout|gym|fitness|weight\s+loss|lose\s+\d+|gain\s+muscle|training\s+plan|cycling|swim\w*|get\s+fit)\b/i],
  ['website', /\b(?:website|web\s*site|landing\s+page|web\s+app|app|application|saas|platform|dashboard|prototype|mvp|software|portfolio)\b/i],
  ['writing', /\b(?:book|novel|ebook|thesis|dissertation|blog|newsletter|podcast|youtube\s+channel|screenplay|manuscript)\b/i],
  ['business', /\b(?:business|startup|company|shop|store|brand|agency|freelanc\w*|side\s+hustle|cafe|café|restaurant|bakery|boutique|e-?commerce)\b/i],
  ['home', /\b(?:renovat\w*|remodel\w*|interior|kitchen|bathroom|house|apartment|flat|move\s+(?:house|home)|relocat\w*|shifting)\b/i],
  ['career', /\b(?:job|career|promotion|interview|resume|cv|placement|internship|switch\s+jobs)\b/i],
];

export function detectMode(text) {
  const t = String(text ?? '').trim();
  if (!t) return { mode: null, confidence: 0 };
  for (const [mode, rx] of MODE_WORDS) {
    if (rx.test(t)) return { mode, confidence: mode === 'trip' && /\bfrom\s+\w+.*\bto\s+\w+/i.test(t) ? 0.95 : 0.8 };
  }
  if (/\bplan\b/i.test(t)) return { mode: 'generic', confidence: 0.5 };
  return { mode: null, confidence: 0 };
}

// ---------- trip input parsing ----------
const cleanPlace = (s) =>
  titleCase(
    String(s ?? '')
      .replace(/^(?:the\s+)/i, '')
      .replace(/[.,;!?]+$/, '')
      .replace(/\s+(?:on|from|between|in|for|with|by|during|around|next|this|tomorrow|starting|leaving|dates?|budget|₹|rs)\b.*$/i, '')
      .trim(),
  );

export function parseTripInput(text, now = dayjs()) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const out = { from: '', to: '', start: null, end: null, travellers: null, budget: null, style: 'balanced', transport: 'car', raw: t };

  // places
  let m = t.match(/\bfrom\s+([A-Za-z][\w'&. -]*?)\s+to\s+([A-Za-z][\w'&. -]*?)(?=\s+(?:on|from|between|in|for|with|by|during|around|next|this|tomorrow|starting|leaving|dates?|budget|\d)|[,.;]|$)/i);
  if (m) { out.from = cleanPlace(m[1]); out.to = cleanPlace(m[2]); }
  else if ((m = t.match(/\b(?:trip|travel|go|going|drive|driving|fly|flying|ride|riding|visit|visiting|getaway|weekend|holiday|vacation)\s+(?:to|in|at)\s+([A-Za-z][\w'&. -]*?)(?=\s+(?:from|on|between|in|for|with|by|during|around|next|this|tomorrow|starting|leaving|dates?|budget|\d)|[,.;]|$)/i))) {
    out.to = cleanPlace(m[1]);
    const f = t.match(/\bfrom\s+([A-Za-z][\w'&. -]*?)(?=\s+(?:on|between|in|for|with|by|during|around|next|this|tomorrow|starting|leaving|dates?|budget|to|\d)|[,.;]|$)/i);
    if (f) out.from = cleanPlace(f[1]);
  } else if ((m = t.match(/^([A-Za-z][\w'&. -]*?)\s+(?:to|→|->)\s+([A-Za-z][\w'&. -]*?)(?=\s+(?:on|from|between|in|for|with|by|during|around|next|this|tomorrow|starting|leaving|dates?|budget|\d)|[,.;]|$)/i))) {
    out.from = cleanPlace(m[1]); out.to = cleanPlace(m[2]);
  }

  // dates — chrono handles "20-24 Dec", "from Dec 20 to Dec 24", "next weekend"
  // "3 days from Oct 10": the duration is not the date — skip pure durations
  const results = chrono.parse(t, now.toDate(), { forwardDate: true })
    .filter((r) => !/^(?:in\s+|for\s+)?\d+\s*(?:days?|nights?|weeks?|d|n)$/i.test(r.text.trim()));
  const ranged = results.find((r) => r.end) ?? results[0];
  if (ranged) {
    out.start = dayjs(ranged.start.date()).format('YYYY-MM-DD');
    if (ranged.end) out.end = dayjs(ranged.end.date()).format('YYYY-MM-DD');
    else if (/next\s+weekend|this\s+weekend|weekend/i.test(ranged.text)) { out.start = dayjs(ranged.start.date()).day(6).format('YYYY-MM-DD'); out.end = dayjs(out.start).add(1, 'day').format('YYYY-MM-DD'); }
  }
  const dur = t.match(/\b(\d+)\s*(?:-|to)?\s*(days?|nights?|d\b|n\b)/i);
  if (dur && out.start && !out.end) {
    const n = parseInt(dur[1], 10);
    out.end = dayjs(out.start).add(/night|n$/i.test(dur[2]) ? n : Math.max(0, n - 1), 'day').format('YYYY-MM-DD');
  }
  if (out.start && out.end && out.end < out.start) [out.start, out.end] = [out.end, out.start];

  // people
  if (/\b(?:solo|alone|myself)\b/i.test(t)) out.travellers = 1;
  else if (/\bcouple|honeymoon|two of us\b/i.test(t)) out.travellers = 2;
  else if ((m = t.match(/\bfamily\s+of\s+(\d+)/i))) out.travellers = +m[1];
  else if ((m = t.match(/\b(\d+)\s*(?:people|persons?|adults|pax|friends|of us|travellers|travelers|members)\b/i))) out.travellers = +m[1];
  else if ((m = t.match(/\bfor\s+(\d+)\b(?!\s*(?:days?|nights?|weeks?|hours?|k\b|lakh))/i))) out.travellers = +m[1];
  else if (/\bfamily\b/i.test(t)) out.travellers = 4;

  // budget (₹) — "30k", "budget 30000", "₹25,000", "1.5 lakh", "under 20k"
  if ((m = t.match(/(?:budget(?:\s+of)?|under|within|around|about|max(?:imum)?)\s*(?:is\s+)?(?:₹|rs\.?|inr)?\s*([\d,.]+)\s*(k|thousand|lakhs?|l)?\b/i)) || (m = t.match(/(?:₹|rs\.?|inr)\s*([\d,.]+)\s*(k|thousand|lakhs?|l)?\b/i)) || (m = t.match(/\b([\d,.]+)\s*(k|lakhs?)\b/i))) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] ?? '').toLowerCase();
    if (Number.isFinite(num)) out.budget = Math.round(unit.startsWith('l') ? num * 100000 : unit ? num * 1000 : num);
  }

  // style + transport
  if (/\b(?:relax\w*|chill|slow|easy|laid[- ]back|leisure\w*)\b/i.test(t)) out.style = 'relaxed';
  else if (/\b(?:adventure|trek\w*|hike|hiking|explore|exploring|thrill|camping)\b/i.test(t)) out.style = 'adventure';
  else if (/\b(?:budget|cheap|backpack\w*|economical|shoestring)\b/i.test(t)) out.style = 'budget';
  else if (/\b(?:luxury|premium|resort|5[- ]star|five[- ]star|pamper)\b/i.test(t)) out.style = 'luxury';
  else if (/\b(?:food|foodie|eat\w*|cuisine|street food)\b/i.test(t)) out.style = 'foodie';
  else if (/\b(?:family|kids|children|parents)\b/i.test(t)) out.style = 'family';
  if (/\b(?:bike|motorcycle|ride|riding|scooter)\b/i.test(t)) out.transport = 'bike';
  else if (/\b(?:train|rail)\b/i.test(t)) out.transport = 'train';
  else if (/\b(?:flight|fly|flying|plane)\b/i.test(t)) out.transport = 'flight';
  else if (/\bbus\b/i.test(t)) out.transport = 'bus';
  else if (/\b(?:car|drive|driving|road\s*trip|self[- ]drive)\b/i.test(t)) out.transport = 'car';
  return out;
}

// What the chat should say back after parsing a trip sentence.
export function describeTripInput(inp) {
  const bits = [];
  if (inp.from && inp.to) bits.push(`${inp.from} → ${inp.to}`); else if (inp.to) bits.push(`to ${inp.to}`);
  if (inp.start) bits.push(inp.end && inp.end !== inp.start ? `${dayjs(inp.start).format('MMM D')}–${dayjs(inp.end).format('MMM D')}` : dayjs(inp.start).format('MMM D'));
  if (inp.travellers) bits.push(`${inp.travellers} traveller${inp.travellers === 1 ? '' : 's'}`);
  if (inp.budget) bits.push(`₹${inp.budget.toLocaleString('en-IN')} budget`);
  bits.push(inp.style, `by ${inp.transport}`);
  const missing = [];
  if (!inp.to) missing.push('destination');
  if (!inp.from && inp.transport !== 'flight') missing.push('starting point');
  if (!inp.start) missing.push('dates');
  return { summary: bits.join(' · '), missing };
}

// ---------- itineraries ----------
export const STYLE_META = {
  balanced: { name: 'Classic highlights', tagline: 'The must-sees at a comfortable pace.', perDay: 3, startHour: 8.5, stayTier: 'mid' },
  relaxed: { name: 'Slow & easy', tagline: 'Late starts, long lunches, two stops a day.', perDay: 2, startHour: 10, stayTier: 'mid' },
  adventure: { name: 'Explorer', tagline: 'Pack the days: nature, viewpoints, early starts.', perDay: 4, startHour: 7.5, stayTier: 'mid' },
  budget: { name: 'Budget saver', tagline: 'Free sights, local food, simple stays.', perDay: 3, startHour: 8.5, stayTier: 'budget' },
  luxury: { name: 'Premium', tagline: 'Resorts, fine dining, unhurried days.', perDay: 2, startHour: 9.5, stayTier: 'luxury' },
  foodie: { name: 'Food first', tagline: 'Plan the days around where to eat.', perDay: 2, startHour: 9.5, stayTier: 'mid' },
  family: { name: 'Family friendly', tagline: 'Short hops, parks and beaches, early dinners.', perDay: 2, startHour: 9, stayTier: 'mid' },
};
const STAY_PRICE = { budget: 1500, mid: 3200, luxury: 8500 };
const FOOD_PER_DAY = { budget: 500, balanced: 900, relaxed: 1000, adventure: 900, luxury: 2200, foodie: 1400, family: 900 };
const FUEL_PRICE = 102; // ₹ per litre, rough
const MILEAGE = { car: 15, bike: 40 };

const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const isIndoor = (p) => /museum|gallery|aquarium|temple|palace|mall|church|mosque|monument/i.test(`${p.sub} ${p.name}`);
const isNature = (p) => /beach|waterfall|peak|park|garden|viewpoint|nature|lake|cave|hot spring/i.test(`${p.sub} ${p.name}`);

function variantKinds(style) {
  const order = [style, 'balanced', 'relaxed', 'adventure', 'budget'];
  return [...new Set(order)].slice(0, 4);
}

// Estimate a trip's cost in rupees. `route` may be null (flight/train/unknown distance).
export function estimateBudget({ days, nights, travellers = 2, style = 'balanced', transport = 'car', route }) {
  const rooms = Math.max(1, Math.ceil(travellers / 2));
  const tier = STYLE_META[style]?.stayTier ?? 'mid';
  const km = route?.km ?? 0;
  let transportCost = 0;
  if (transport === 'car' || transport === 'bike') transportCost = Math.round(((km * 2) / MILEAGE[transport]) * FUEL_PRICE) + (transport === 'car' ? Math.round(km * 2 * 0.6) : 0); // fuel + tolls
  else if (transport === 'train') transportCost = Math.round(travellers * km * 2 * 1.1);
  else if (transport === 'bus') transportCost = Math.round(travellers * km * 2 * 1.5);
  else if (transport === 'flight') transportCost = Math.round(travellers * Math.max(6000, km * 2 * 4.5));
  const stay = nights * rooms * STAY_PRICE[tier];
  const food = days * travellers * (FOOD_PER_DAY[style] ?? 900);
  const activities = days * travellers * (style === 'budget' ? 150 : style === 'luxury' ? 900 : 350);
  const total = transportCost + stay + food + activities;
  return { transport: transportCost, stay, food, activities, total, rooms, tier };
}

// Packing list from weather, style, places and transport.
export function packingList({ weather = [], style = 'balanced', transport = 'car', attractions = [], days = 2 }) {
  const items = new Set(['ID proof', 'Phone charger + power bank', 'Medicines you take', 'Water bottle', 'Cash for small stops']);
  if (transport === 'car' || transport === 'bike') ['Driving licence, RC, insurance', 'FASTag topped up', 'Offline maps for the route'].forEach((i) => items.add(i));
  if (transport === 'bike') ['Helmet + riding gloves', 'Rain cover for the bag'].forEach((i) => items.add(i));
  if (transport === 'flight' || transport === 'train') ['Tickets / boarding passes downloaded', 'Small lock for luggage'].forEach((i) => items.add(i));
  const rainy = weather.some((d) => (d.rainProb ?? 0) >= 50);
  const hot = weather.some((d) => d.tmax >= 33);
  const cold = weather.some((d) => d.tmin <= 15);
  if (rainy) ['Umbrella / rain jacket', 'Extra pair of footwear'].forEach((i) => items.add(i));
  if (hot) ['Sunscreen + cap', 'Light cotton clothes'].forEach((i) => items.add(i));
  if (cold) ['A warm layer for evenings'].forEach((i) => items.add(i));
  if (attractions.some((p) => /beach|waterfall|lake|hot spring/i.test(`${p.sub} ${p.name}`))) ['Swimwear + towel', 'Flip-flops'].forEach((i) => items.add(i));
  if (attractions.some((p) => /peak|trek|nature|cave/i.test(`${p.sub} ${p.name}`)) || style === 'adventure') ['Trekking shoes', 'Small first-aid kit'].forEach((i) => items.add(i));
  if (attractions.some((p) => /temple|mosque|church|palace|monument/i.test(`${p.sub} ${p.name}`))) items.add('Modest clothes for temples / monuments');
  if (days >= 3) items.add('Laundry bag');
  if (style === 'family') ['Snacks for the road', 'Kids\' entertainment for the drive'].forEach((i) => items.add(i));
  return [...items];
}

// Day-by-day itineraries for several styles from real places.
// ctx: { from, to, start, end, travellers, budget, style, transport, route, weather, pois: { attractions, stays, food, fuel } }
export function buildTripVariants(ctx) {
  const start = dayjs(ctx.start);
  const end = ctx.end ? dayjs(ctx.end) : start;
  const days = Math.max(1, end.diff(start, 'day') + 1);
  const nights = Math.max(0, days - 1);
  const pois = ctx.pois ?? {};
  const attractions = [...(pois.attractions ?? [])].sort((a, b) => b.importance - a.importance || a.km - b.km);
  const food = pois.food ?? [];
  const stays = pois.stays ?? [];
  const fuel = pois.fuel ?? [];
  const weatherByDate = Object.fromEntries((ctx.weather ?? []).map((d) => [d.date, d]));
  const driveMin = ctx.route?.minutes ?? null;
  const driving = (ctx.transport === 'car' || ctx.transport === 'bike') && ctx.route;

  const variants = variantKinds(ctx.style ?? 'balanced').map((style) => {
    const meta = STYLE_META[style];
    let pool = attractions.slice();
    if (style === 'adventure') pool.sort((a, b) => (isNature(b) ? 1 : 0) - (isNature(a) ? 1 : 0) || b.importance - a.importance);
    if (style === 'family') pool = pool.filter((p) => !/peak|cave|ruins/i.test(p.sub)).concat(pool.filter((p) => /peak|cave|ruins/i.test(p.sub)));
    let foodIdx = 0;
    const nextFood = () => (food.length ? food[foodIdx++ % food.length] : null);
    const stay = stays.find((s) => (meta.stayTier === 'luxury' ? /resort|hotel/i.test(s.sub) : meta.stayTier === 'budget' ? /guest house|hostel|apartment|motel/i.test(s.sub) : true)) ?? stays[0] ?? null;
    const usedIds = new Set();
    const take = (n, preferIndoor) => {
      const picks = [];
      const ordered = preferIndoor ? [...pool].sort((a, b) => (isIndoor(b) ? 1 : 0) - (isIndoor(a) ? 1 : 0)) : pool;
      for (const p of ordered) {
        if (picks.length >= n) break;
        if (usedIds.has(p.id)) continue;
        usedIds.add(p.id);
        picks.push(p);
      }
      return picks;
    };

    const dayPlans = [];
    for (let d = 0; d < days; d++) {
      const date = start.add(d, 'day');
      const w = weatherByDate[date.format('YYYY-MM-DD')] ?? null;
      const rainy = (w?.rainProb ?? 0) >= 60;
      const items = [];
      let h = meta.startHour;
      const first = d === 0;
      const last = d === days - 1 && days > 1;
      const tips = [];
      if (rainy) tips.push(`Rain likely (${w.rainProb}%) — indoor stops first, keep the outdoor ones for gaps.`);
      if (w && w.tmax >= 34) tips.push(`Hot day (${w.tmax}°) — outdoor stops before 11 and after 4.`);

      if (first && driving) {
        const dep = Math.max(5.5, meta.startHour - 2);
        items.push({ time: hhmm(dep), kind: 'travel', title: `Depart ${ctx.from}`, note: `${ctx.route.km} km · about ${Math.round(driveMin / 60)}h ${driveMin % 60}m by ${ctx.transport}` });
        const stops = fuel.filter((f) => f.km >= 100).filter((f, i, arr) => arr.findIndex((x) => x.km === f.km) === i).filter((_, i) => i % 2 === 0).slice(0, 3);
        stops.forEach((f) => items.push({ time: hhmm(dep + (f.km / ctx.route.km) * (driveMin / 60)), kind: 'fuel', title: `Fuel & stretch — ${f.name ?? 'fuel station'}`, note: `around km ${f.km}`, poi: f.id }));
        const arrive = dep + driveMin / 60 + stops.length * 0.3;
        if (arrive > 12.5 && arrive - dep > 4) items.push({ time: hhmm(Math.min(13.5, dep + (driveMin / 60) / 2)), kind: 'food', title: 'Lunch on the way', note: 'pick a highway dhaba near the halfway mark' });
        items.push({ time: hhmm(arrive), kind: 'travel', title: `Arrive ${ctx.to}`, note: stay ? `check in at ${stay.name}` : 'check in', poi: stay?.id });
        h = Math.max(arrive + 1, 16);
        if (h < 19 && days > 1) { const [p] = take(1, rainy); if (p) items.push({ time: hhmm(h), kind: 'sight', title: p.name, note: `${p.sub} · ${p.km} km from centre`, poi: p.id }); }
        const din = nextFood();
        items.push({ time: '19:30', kind: 'food', title: din ? `Dinner at ${din.name}` : 'Dinner near the stay', note: din?.tags?.cuisine ? din.tags.cuisine.replace(/;/g, ', ') : null, poi: din?.id });
      } else if (first && !driving) {
        items.push({ time: hhmm(meta.startHour), kind: 'travel', title: `Travel to ${ctx.to}`, note: `by ${ctx.transport}${ctx.from ? ` from ${ctx.from}` : ''}` });
        items.push({ time: '14:00', kind: 'travel', title: `Check in`, note: stay ? stay.name : 'at your stay', poi: stay?.id });
        const [p] = take(1, rainy);
        if (p && days > 1) items.push({ time: '16:30', kind: 'sight', title: p.name, note: `${p.sub} · ${p.km} km from centre`, poi: p.id });
        const din = nextFood();
        items.push({ time: '19:30', kind: 'food', title: din ? `Dinner at ${din.name}` : 'Dinner near the stay', poi: din?.id });
      } else if (last) {
        const [p] = take(1, rainy);
        if (p) items.push({ time: hhmm(meta.startHour), kind: 'sight', title: p.name, note: `${p.sub} · one last stop`, poi: p.id });
        items.push({ time: hhmm(meta.startHour + 2), kind: 'travel', title: 'Check out', note: 'settle the bill, pack the car' });
        if (driving) {
          const dep = meta.startHour + 2.5;
          items.push({ time: hhmm(dep), kind: 'travel', title: `Drive back to ${ctx.from}`, note: `${ctx.route.km} km · about ${Math.round(driveMin / 60)}h` });
          const mid = fuel.find((f) => f.km >= ctx.route.km / 2) ?? fuel[Math.floor(fuel.length / 2)];
          if (mid) items.push({ time: hhmm(dep + (driveMin / 60) / 2), kind: 'fuel', title: `Fuel & lunch — ${mid.name ?? 'fuel station'}`, note: `around km ${ctx.route.km - mid.km} from home`, poi: mid.id });
          items.push({ time: hhmm(dep + driveMin / 60 + 0.5), kind: 'travel', title: `Home — ${ctx.from}`, note: 'unpack, back up the photos' });
        } else {
          items.push({ time: hhmm(meta.startHour + 3), kind: 'travel', title: `Travel back${ctx.from ? ` to ${ctx.from}` : ''}`, note: `by ${ctx.transport}` });
        }
      } else {
        const picks = take(meta.perDay, rainy);
        picks.forEach((p, i) => {
          const slot = h + i * (style === 'relaxed' || style === 'luxury' ? 3 : 2.25) + (i >= 2 ? 1.25 : 0);
          items.push({ time: hhmm(slot), kind: 'sight', title: p.name, note: `${p.sub} · ${p.km} km from centre`, poi: p.id });
          if (i === 1 || (picks.length === 1 && i === 0)) { const lunch = nextFood(); items.push({ time: hhmm(Math.max(slot + 1.5, 12.5)), kind: 'food', title: lunch ? `Lunch at ${lunch.name}` : 'Lunch nearby', note: lunch?.tags?.cuisine?.replace(/;/g, ', ') ?? null, poi: lunch?.id }); }
        });
        if (!picks.length) items.push({ time: hhmm(h), kind: 'free', title: 'Free morning', note: 'walk the neighbourhood, find a café' });
        const din = nextFood();
        items.push({ time: style === 'family' ? '19:00' : '20:00', kind: 'food', title: din ? `Dinner at ${din.name}` : 'Dinner', note: din?.tags?.cuisine?.replace(/;/g, ', ') ?? null, poi: din?.id });
        if (days === 1 && driving) items.push({ time: '17:30', kind: 'travel', title: `Drive back to ${ctx.from}`, note: `${ctx.route.km} km` });
      }
      items.sort((a, b) => a.time.localeCompare(b.time));
      dayPlans.push({ day: d + 1, date: date.format('YYYY-MM-DD'), title: first ? (days === 1 ? 'Day trip' : `Travel & arrive`) : last ? 'Wind down & return' : `Explore ${ctx.to}`, weather: w, items, tips });
    }

    const budget = estimateBudget({ days, nights, travellers: ctx.travellers ?? 2, style, transport: ctx.transport, route: ctx.route });
    return { id: style, style, name: meta.name, tagline: meta.tagline, stay, days: dayPlans, budget, source: 'rules' };
  });

  const packing = packingList({ weather: ctx.weather ?? [], style: ctx.style, transport: ctx.transport, attractions, days });
  return { days, nights, variants, packing };
}

// ---------- confirm → project + calendar ----------
// Returns a plan object createProjectFromPlan understands, plus calendar events.
export function tripToProject(session, variant) {
  const inp = session.input;
  const start = dayjs(inp.start);
  const end = dayjs(inp.end ?? inp.start);
  const name = `Trip: ${inp.to}`;
  const before = start.subtract(2, 'day').format('YYYY-MM-DD');
  const pre = [
    inp.transport === 'car' || inp.transport === 'bike' ? `Service check: tyres, oil, brakes (${inp.transport})` : `Book ${inp.transport} tickets${inp.from ? ` ${inp.from} → ${inp.to}` : ''}`,
    variant.stay ? `Book the stay — ${variant.stay.name}` : `Book a stay in ${inp.to}`,
    `Pack (${session.result?.packing?.length ?? 10} items on the list)`,
    'Download offline maps and save the itinerary',
    'Tell someone the plan and share your live location',
  ];
  const milestones = [
    { id: 'm-pre', title: 'Before you go', due: before, tasks: pre.map((t, i) => ({ id: `t-pre-${i}`, title: t, due: before, priority: 4 })) },
    ...variant.days.map((d) => ({
      id: `m-day-${d.day}`, title: `Day ${d.day} — ${d.title}`, due: d.date,
      tasks: [{ id: `t-day-${d.day}`, title: `Day ${d.day}: ${d.items.filter((i) => i.kind !== 'fuel').slice(0, 4).map((i) => i.title).join(' → ')}`, due: d.date, priority: 3 }],
    })),
    { id: 'm-after', title: 'After the trip', due: end.add(1, 'day').format('YYYY-MM-DD'), tasks: [
      { id: 't-after-0', title: 'Settle shared expenses', due: end.add(1, 'day').format('YYYY-MM-DD'), priority: 3 },
      { id: 't-after-1', title: 'Back up photos and write a short journal', due: end.add(2, 'day').format('YYYY-MM-DD'), priority: 2 },
    ] },
  ];
  const plan = {
    name, desc: `${inp.from ? `${inp.from} → ` : ''}${inp.to} · ${start.format('MMM D')}${end.isSame(start, 'day') ? '' : `–${end.format('MMM D')}`} · ${variant.name}`,
    deadline: end.format('YYYY-MM-DD'), milestones, taskCount: milestones.reduce((a, m) => a + m.tasks.length, 0),
  };
  const events = variant.days.map((d) => {
    const firstTimed = d.items[0];
    return { title: `${name} — Day ${d.day}: ${d.title}`, date: d.date, time: firstTimed?.time ?? null, end: null, kind: 'event' };
  });
  return { plan, events };
}

// ---------- live mode ----------
export function tripDayIndex(session, now = dayjs()) {
  const start = dayjs(session.input.start);
  const end = dayjs(session.input.end ?? session.input.start);
  if (now.isBefore(start, 'day')) return { index: 0, phase: 'before', daysToGo: start.diff(now.startOf('day'), 'day') };
  if (now.isAfter(end, 'day')) return { index: end.diff(start, 'day') + 1, phase: 'after' };
  return { index: now.startOf('day').diff(start, 'day') + 1, phase: 'during' };
}

// Rule-based advice for the road. facts: { now, pos, place, weather, nearby, progress, day, session, variant }
export function liveAdvice(f) {
  const tips = [];
  const hour = f.now.hour() + f.now.minute() / 60;
  const nearby = f.nearby ?? [];
  const kind = (k) => nearby.filter((p) => p.kind === k).sort((a, b) => a.km - b.km);
  const dir = (p) => (f.pos ? `${p.km} km ${compass(bearingDeg(f.pos, p))}` : `${p.km} km`);

  if (f.weather) {
    const soon = f.weather.hourly.slice(0, 4).find((h) => h.rainProb >= 60 || (h.code >= 61 && h.code <= 82) || h.code >= 95);
    if (soon) tips.push({ kind: 'weather', text: `Rain around ${soon.hour} (${soon.rainProb}%) — do the outdoor stop first, or take the indoor one now.` });
    if (f.weather.temp >= 35) tips.push({ kind: 'weather', text: `It's ${f.weather.temp}° out — keep water in the car and take the shaded stops before 4 pm.` });
    if (f.weather.code >= 95) tips.push({ kind: 'weather', text: 'Thunderstorm in the area — hold the drive for 30 minutes if it gets heavy.' });
  }
  if (f.progress && f.progress.remainingKm > 5) {
    const fuel = kind('fuel')[0];
    const fuelAhead = (f.fuelAlong ?? []).filter((x) => x.km > (f.progress.coveredKm ?? 0));
    const nextFuel = fuelAhead[0];
    const mins = Math.round((f.progress.remainingKm / 55) * 60);
    const eta = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
    tips.push({ kind: 'route', text: `${f.progress.remainingKm} km to ${f.session.input.to} — about ${eta} at highway pace.${nextFuel ? ` Next fuel on the route in ~${nextFuel.km - f.progress.coveredKm} km${nextFuel.name ? ` (${nextFuel.name})` : ''}.` : fuel ? ` Nearest fuel: ${fuel.name ?? 'station'}, ${dir(fuel)}.` : ''}` });
    if (f.progress.offRouteKm > 3) tips.push({ kind: 'route', text: `You're ${f.progress.offRouteKm} km off the planned route — fine if it's on purpose.` });
  }
  if ((hour >= 12 && hour <= 14.5) || (hour >= 19 && hour <= 21.5)) {
    const food = kind('food').slice(0, 2);
    if (food.length) tips.push({ kind: 'food', text: `${hour < 15 ? 'Lunch' : 'Dinner'} time — ${food.map((p) => `${p.name} (${dir(p)}${p.tags?.cuisine ? `, ${p.tags.cuisine.split(';')[0]}` : ''})`).join(' or ')}.` });
  }
  if (hour >= 18.5 && f.day?.phase === 'during') {
    const stay = kind('stay').slice(0, 2);
    const planned = f.variant?.stay;
    if (planned && f.pos && haversineKm(f.pos, planned) > 15 && stay.length) tips.push({ kind: 'stay', text: `Your booked stay (${planned.name}) is ${Math.round(haversineKm(f.pos, planned))} km away. If it's late, ${stay[0].name} is ${dir(stay[0])}.` });
    else if (!planned && stay.length) tips.push({ kind: 'stay', text: `Evening — nearest stays: ${stay.map((p) => `${p.name} (${dir(p)})`).join(', ')}.` });
  }
  const health = kind('health')[0];
  if (health) tips.push({ kind: 'safety', text: `Nearest ${health.sub}: ${health.name}, ${dir(health)}.` });
  if (f.day?.phase === 'during' && f.variant) {
    const today = f.variant.days[f.day.index - 1];
    const next = today?.items.find((i) => i.time >= f.now.format('HH:mm'));
    if (next) tips.push({ kind: 'plan', text: `Next on the plan: ${next.time} ${next.title}${next.note ? ` — ${next.note}` : ''}.` });
    else if (today) tips.push({ kind: 'plan', text: `Day ${today.day} is done on paper — anything left, roll it to tomorrow.` });
  }
  if (f.day?.phase === 'before') tips.push({ kind: 'plan', text: `${f.day.daysToGo} day${f.day.daysToGo === 1 ? '' : 's'} to go — the pre-trip checklist is in the project.` });
  return tips.slice(0, 6);
}

// Short lines the Planner chat uses.
export function modeReply(mode) {
  const m = MODES[mode];
  if (!m) return "Tell me what you're planning — a trip, an event, an exam, a launch, a move — and I'll switch to that mode.";
  return `${m.label} mode. ${m.hint}`;
}
