// Orchestrates a trip plan: geocode → route → weather → places → itineraries
// → (optional) model polish. Reports progress so the screen can narrate it.
import dayjs from 'dayjs';
import { geocode, route, forecastRange, nearby, fuelAlong, haversineKm } from './geo';
import { buildTripVariants } from './planner';
import { aiTripItineraries } from './plannerAi';
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

  let rt = null;
  const driving = input.transport === 'car' || input.transport === 'bike';
  if (from && driving) {
    step(`Routing ${from.name} → ${to.name}…`);
    rt = await route(from, to, 'driving');
  }
  if (from && !rt) {
    const km = Math.round(haversineKm(from, to) * 1.25);
    rt = { km, minutes: Math.round((km / (driving ? 50 : 60)) * 60), geometry: null, estimated: true };
  }

  step('Checking the weather…');
  const start = input.start;
  const end = input.end ?? input.start;
  const wStart = dayjs(start).isBefore(dayjs(), 'day') ? dayjs().format('YYYY-MM-DD') : start;
  const daysAhead = dayjs(start).diff(dayjs().startOf('day'), 'day');
  const weather = daysAhead <= 15 && !dayjs(end).isBefore(dayjs(), 'day') ? await forecastRange(to.lat, to.lon, wStart, end) : null;

  step(`Finding sights, food and stays around ${to.name}…`);
  const places = await nearby(to, ['attraction', 'food', 'stay'], 15000, 30);
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
  const ctx = { ...input, from: from?.name ?? input.from, to: to.name, fromGeo: from, toGeo: to, route: rt, weather: weather ?? [], pois };
  const built = buildTripVariants(ctx);
  const result = {
    ...built, fromGeo: from, toGeo: to, route: rt, weather: weather ?? [], weatherUnavailable: !weather,
    pois, plannedAt: new Date().toISOString(), source: 'rules', tips: [],
  };

  if (state) {
    step(`${APP_NAME} is polishing the days with AI…`);
    const ai = await aiTripItineraries(ctx, built, state);
    if (ai) {
      result.variants = result.variants.map((v) => (ai[v.id] ? { ...v, days: ai[v.id].days, source: 'ai' } : v));
      result.tips = Object.values(ai).find((x) => x.tips?.length)?.tips ?? [];
      result.source = 'ai';
    }
  }
  return result;
}
