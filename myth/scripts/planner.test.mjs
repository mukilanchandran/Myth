// Unit tests for the Myth Planner brain (src/ai/planner.js) and the pure
// geometry in src/ai/geo.js. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  detectMode, parseTripInput, describeTripInput, buildTripVariants, estimateBudget, packingList, tripToProject, tripDayIndex, liveAdvice,
} from '../src/ai/planner.js';
import { haversineKm, samplePath, progressAlong, compass } from '../src/ai/geo.js';

const NOW = dayjs('2026-09-07T14:00:00');
const CHENNAI = { lat: 13.0827, lon: 80.2707 };
const GOA = { lat: 15.4909, lon: 73.8278 };

test('detectMode picks the right planner mode', () => {
  assert.equal(detectMode('Trip from Chennai to Goa 20-24 Dec for 2').mode, 'trip');
  assert.equal(detectMode("Plan my sister's wedding in December").mode, 'event');
  assert.equal(detectMode('Prepare for the GATE exam in February').mode, 'study');
  assert.equal(detectMode('Run a half marathon in March').mode, 'fitness');
  assert.equal(detectMode('Launch my portfolio website next month').mode, 'website');
  assert.equal(detectMode('Write a book about design systems').mode, 'writing');
  assert.equal(detectMode('Open a bakery').mode, 'business');
  assert.equal(detectMode('Renovate the kitchen').mode, 'home');
  assert.equal(detectMode('Get a new job by December').mode, 'career');
  assert.equal(detectMode('hello there').mode, null);
});

test('parseTripInput reads places, dates, people, budget, style and transport', () => {
  const p = parseTripInput('Trip from Chennai to Goa 20-24 Dec for 2, budget 30k, relaxed, by car', NOW);
  assert.equal(p.from, 'Chennai');
  assert.equal(p.to, 'Goa');
  assert.equal(p.start, '2026-12-20');
  assert.equal(p.end, '2026-12-24');
  assert.equal(p.travellers, 2);
  assert.equal(p.budget, 30000);
  assert.equal(p.style, 'relaxed');
  assert.equal(p.transport, 'car');

  const q = parseTripInput('going to Pondicherry from Chennai next weekend, couple, budget ₹8,000, bike', NOW);
  assert.equal(q.to, 'Pondicherry');
  assert.equal(q.from, 'Chennai');
  assert.equal(q.travellers, 2);
  assert.equal(q.budget, 8000);
  assert.equal(q.transport, 'bike');
  assert.ok(q.start && q.end && dayjs(q.start).day() === 6, 'weekend starts on Saturday');

  const r = parseTripInput('Bangalore to Coorg 3 days from Oct 10, family of 4, 1.5 lakh, luxury', NOW);
  assert.equal(r.from, 'Bangalore');
  assert.equal(r.to, 'Coorg');
  assert.equal(r.start, '2026-10-10');
  assert.equal(r.end, '2026-10-12');
  assert.equal(r.travellers, 4);
  assert.equal(r.budget, 150000);
  assert.equal(r.style, 'luxury');
  const d = describeTripInput(parseTripInput('trip to Ooty', NOW));
  assert.deepEqual(d.missing, ['starting point', 'dates']);
});

test('geometry helpers', () => {
  const km = haversineKm(CHENNAI, GOA);
  assert.ok(km > 700 && km < 760, `Chennai–Goa straight line ${km}`);
  const path = [CHENNAI, { lat: 13.5, lon: 79.5 }, { lat: 14.2, lon: 77.5 }, { lat: 15, lon: 75 }, GOA];
  const samples = samplePath(path, 200);
  assert.ok(samples.length >= 3 && samples[1].km >= 200);
  const prog = progressAlong(path, { lat: 14.2, lon: 77.5 });
  assert.equal(prog.index, 2);
  assert.ok(prog.coveredKm > 200 && prog.remainingKm > 200);
  assert.equal(compass(45), 'NE');
});

const pois = () => ({
  attractions: [
    { id: 'a1', name: 'Fort Aguada', kind: 'attraction', sub: 'fort', lat: 15.49, lon: 73.77, importance: 6, km: 8 },
    { id: 'a2', name: 'Baga Beach', kind: 'attraction', sub: 'beach', lat: 15.55, lon: 73.75, importance: 5, km: 12 },
    { id: 'a3', name: 'Goa State Museum', kind: 'attraction', sub: 'museum', lat: 15.49, lon: 73.83, importance: 4, km: 1 },
    { id: 'a4', name: 'Dudhsagar Falls', kind: 'attraction', sub: 'waterfall', lat: 15.31, lon: 74.31, importance: 6, km: 50 },
    { id: 'a5', name: 'Basilica of Bom Jesus', kind: 'attraction', sub: 'attraction', lat: 15.5, lon: 73.91, importance: 7, km: 9 },
    { id: 'a6', name: 'Chapora Fort', kind: 'attraction', sub: 'fort', lat: 15.6, lon: 73.74, importance: 3, km: 16 },
    { id: 'a7', name: 'Miramar Beach', kind: 'attraction', sub: 'beach', lat: 15.48, lon: 73.8, importance: 2, km: 3 },
  ],
  food: [{ id: 'f1', name: 'Ritz Classic', kind: 'food', sub: 'restaurant', lat: 15.49, lon: 73.82, km: 1, tags: { cuisine: 'goan;seafood' } }, { id: 'f2', name: 'Cafe Bodega', kind: 'food', sub: 'cafe', lat: 15.5, lon: 73.82, km: 2, tags: {} }],
  stays: [{ id: 's1', name: 'Taj Fort Aguada', kind: 'stay', sub: 'resort', lat: 15.49, lon: 73.77, km: 8, tags: {} }, { id: 's2', name: 'Old Quarter Hostel', kind: 'stay', sub: 'hostel', lat: 15.5, lon: 73.83, km: 1, tags: {} }],
  fuel: [{ id: 'g1', name: 'HP Petrol Pump', kind: 'fuel', sub: 'fuel', lat: 13.4, lon: 79.6, km: 120 }, { id: 'g2', name: 'IOCL', kind: 'fuel', sub: 'fuel', lat: 14.2, lon: 77.5, km: 360 }, { id: 'g3', name: null, kind: 'fuel', sub: 'fuel', lat: 15, lon: 75, km: 600 }],
});

const ctx = () => ({
  from: 'Chennai', to: 'Goa', start: '2026-12-20', end: '2026-12-23', travellers: 2, budget: 30000, style: 'relaxed', transport: 'car',
  route: { km: 900, minutes: 900, geometry: [CHENNAI, GOA] },
  weather: [{ date: '2026-12-21', code: 61, tmax: 31, tmin: 23, rainProb: 70 }, { date: '2026-12-22', code: 1, tmax: 35, tmin: 24, rainProb: 5 }],
  pois: pois(),
});

test('buildTripVariants makes several day-by-day itineraries from real places', () => {
  const r = buildTripVariants(ctx());
  assert.equal(r.days, 4);
  assert.equal(r.nights, 3);
  assert.equal(r.variants[0].id, 'relaxed'); // the asked-for style comes first
  assert.ok(r.variants.length >= 3);
  for (const v of r.variants) {
    assert.equal(v.days.length, 4);
    const d1 = v.days[0].items.map((i) => i.title);
    assert.match(d1[0], /Depart Chennai/);
    assert.ok(d1.some((t) => /Arrive Goa/.test(t)));
    assert.ok(v.days[0].items.some((i) => i.kind === 'fuel'), 'fuel stop on the drive');
    assert.ok(v.days.at(-1).items.some((i) => /Drive back to Chennai/.test(i.title)));
    const sights = v.days.flatMap((d) => d.items.filter((i) => i.kind === 'sight').map((i) => i.poi));
    assert.equal(new Set(sights).size, sights.length, 'no sight is visited twice');
    assert.ok(v.budget.total > 0);
  }
  const rainy = r.variants[0].days[1];
  assert.match(rainy.tips[0], /Rain likely/);
  assert.equal(rainy.items.find((i) => i.kind === 'sight').title, 'Goa State Museum', 'indoor first on a rainy day');
  assert.ok(r.packing.includes('Umbrella / rain jacket'));
  assert.ok(r.packing.includes('Swimwear + towel'));
  assert.ok(r.packing.includes('Driving licence, RC, insurance'));
});

test('estimateBudget scales with people, nights and style', () => {
  const a = estimateBudget({ days: 4, nights: 3, travellers: 2, style: 'budget', transport: 'car', route: { km: 900 } });
  const b = estimateBudget({ days: 4, nights: 3, travellers: 4, style: 'luxury', transport: 'flight', route: { km: 900 } });
  assert.ok(a.total < b.total);
  assert.equal(a.rooms, 1);
  assert.equal(b.rooms, 2);
  assert.ok(a.transport > 10000, 'fuel + tolls for 1800 km');
  assert.equal(packingList({ weather: [], style: 'balanced', transport: 'flight', attractions: [], days: 1 }).includes('Laundry bag'), false);
});

test('tripToProject turns the chosen variant into milestones, tasks and calendar days', () => {
  const r = buildTripVariants(ctx());
  const session = { input: ctx(), result: r };
  const { plan, events } = tripToProject(session, r.variants[0]);
  assert.equal(plan.name, 'Trip: Goa');
  assert.equal(plan.deadline, '2026-12-23');
  assert.equal(plan.milestones[0].title, 'Before you go');
  assert.equal(plan.milestones[0].due, '2026-12-18');
  assert.equal(plan.milestones.length, 1 + 4 + 1);
  assert.equal(events.length, 4);
  assert.equal(events[0].date, '2026-12-20');
  assert.ok(plan.taskCount >= 10);
});

test('tripDayIndex and liveAdvice follow the calendar and the road', () => {
  const session = { input: ctx(), result: buildTripVariants(ctx()) };
  assert.deepEqual(tripDayIndex(session, dayjs('2026-12-18T10:00')), { index: 0, phase: 'before', daysToGo: 2 });
  assert.equal(tripDayIndex(session, dayjs('2026-12-21T10:00')).index, 2);
  assert.equal(tripDayIndex(session, dayjs('2026-12-30T10:00')).phase, 'after');

  const tips = liveAdvice({
    now: dayjs('2026-12-20T12:30'), pos: { lat: 14.2, lon: 77.5 }, place: 'Anantapur',
    weather: { temp: 36, code: 1, hourly: [{ hour: '13:00', rainProb: 10, code: 1 }, { hour: '14:00', rainProb: 70, code: 61 }] },
    nearby: [{ id: 'x', kind: 'food', name: 'Highway Dhaba', sub: 'restaurant', lat: 14.21, lon: 77.51, km: 1.2, tags: { cuisine: 'indian' } }, { id: 'h', kind: 'health', name: 'Govt Hospital', sub: 'hospital', lat: 14.2, lon: 77.52, km: 2, tags: {} }],
    progress: { coveredKm: 360, remainingKm: 540, offRouteKm: 0.4 }, fuelAlong: pois().fuel,
    day: tripDayIndex(session, dayjs('2026-12-20T12:30')), session, variant: session.result.variants[0],
  });
  const kinds = tips.map((t) => t.kind);
  assert.ok(kinds.includes('weather') && kinds.includes('route') && kinds.includes('food') && kinds.includes('safety') && kinds.includes('plan'));
  assert.match(tips.find((t) => t.kind === 'route').text, /540 km to Goa.*Next fuel on the route in ~240 km/);
  assert.match(tips.find((t) => t.kind === 'food').text, /Lunch time — Highway Dhaba \(1\.2 km/);
});
