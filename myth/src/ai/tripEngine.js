// Orchestrates a trip plan: geocode → every route → weather → places →
// itineraries for every style → the model's destination research (areas,
// must-sees, hidden gems, food, stays, transport, themed itineraries, tips)
// → itinerary polish. Reports progress so the screen can narrate it.
import dayjs from 'dayjs';
import { geocode, routeAlternatives, forecastRange, nearby, fuelAlong, haversineKm } from './geo';
import { buildTripVariants } from './planner';
import { aiTripItineraries } from './plannerAi';
import { aiDestinationGuide, linkGuideToMap, themesToVariants, transportOptions } from './tripGuide';
import { APP_NAME } from '../config/env';

export async function planTrip(input, { onProgress, state } = {}) {
  const step = (label) => onProgress?.(label);
  if (!input.to) throw new Error('Where to? Add a destination first.');
  if (!input.start) throw new Error('When? Add the trip dates first.');

  step(`Finding ${input.to} on the map…`);
  const to = await geocode(input.to);
  if (!to) throw new Error(`Couldn't find "${input.to}" on the map. Try the nearest bigger town.`);
  let from = null;
  if (input.from) {
    step(`Finding ${input.from}…`);
    from = await geocode(input.from);
  }

  // every road between the two places (the fastest is the default)
  let routes = [];
  const driving = input.transport === 'car' || input.transport === 'bike';
  if (from && driving) {
    step(`Routing ${from.name} → ${to.name} — every road option…`);
    routes = await routeAlternatives(from, to, 'driving');
  }
  if (from && !routes.length) {
    const km = Math.round(haversineKm(from, to) * 1.25);
    routes = [{ id: 'r0', km, minutes: Math.round((km / (driving ? 50 : 60)) * 60), geometry: null, estimated: true, name: 'Estimated', via: [] }];
  }
  const rt = routes[0] ?? null;

  step('Checking the weather…');
  const start = input.start;
  const end = input.end ?? input.start;
  const wStart = dayjs(start).isBefore(dayjs(), 'day') ? dayjs().format('YYYY-MM-DD') : start;
  const daysAhead = dayjs(start).diff(dayjs().startOf('day'), 'day');
  const weather = daysAhead <= 15 && !dayjs(end).isBefore(dayjs(), 'day') ? await forecastRange(to.lat, to.lon, wStart, end) : null;

  step(`Finding sights, food and stays around ${to.name}…`);
  const places = await nearby(to, ['attraction', 'food', 'stay'], 18000, 40);
  const pois = {
    attractions: places.filter((p) => p.kind === 'attraction'),
    food: places.filter((p) => p.kind === 'food'),
    stays: places.filter((p) => p.kind === 'stay'),
    fuel: [],
  };
  if (rt?.geometry) {
    step('Fuel stops along the route…');
    pois.fuel = await fuelAlong(rt.geometry, 120);
  }

  step('Writing the itineraries…');
  const ctx = { ...input, from: from?.name ?? input.from, to: to.name, fromGeo: from, toGeo: to, route: rt, routes, weather: weather ?? [], pois };
  const built = buildTripVariants(ctx);
  const result = {
    ...built, fromGeo: from, toGeo: to, route: rt, routes, weather: weather ?? [], weatherUnavailable: !weather,
    pois, plannedAt: new Date().toISOString(), source: 'rules', tips: [], guide: null,
    transport: transportOptions({ km: rt?.km, minutes: rt?.minutes, travellers: input.travellers ?? 2, from: ctx.from, to: ctx.to }),
  };

  if (state) {
    step(`${APP_NAME} is researching ${to.name} — areas, must-sees, food, stays, ways to get there…`);
    const [guide, ai] = await Promise.all([
      aiDestinationGuide(ctx, state),
      aiTripItineraries(ctx, built, state),
    ]);
    if (guide) {
      result.guide = linkGuideToMap(guide, pois, to.name);
      result.variants = [...result.variants, ...themesToVariants(result.guide, ctx, built.days)];
      result.transport = transportOptions({ km: rt?.km, minutes: rt?.minutes, travellers: input.travellers ?? 2, from: ctx.from, to: ctx.to, guide: result.guide });
      if (result.guide.packingExtras?.length) result.packing = [...new Set([...result.packing, ...result.guide.packingExtras])];
      result.tips = result.guide.tips ?? [];
      result.source = 'ai';
    }
    if (ai) {
      result.variants = result.variants.map((v) => (ai[v.id] ? { ...v, days: ai[v.id].days, source: 'ai' } : v));
      if (!result.tips.length) result.tips = Object.values(ai).find((x) => x.tips?.length)?.tips ?? [];
      result.source = 'ai';
    }
  }
  return result;
}
