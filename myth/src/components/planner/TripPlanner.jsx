// Trip mode: the form (with place autocomplete), the planning run, then the
// whole picture — every way to get there, the road options, areas and stays
// across budgets, must-sees and hidden gems, food, several itineraries
// (styles + themes), weather, fuel, packing — and the confirm step that turns
// the chosen plan into a project + calendar days.
import { useMemo, useState } from 'react';
import {
  Stack, Group, Text, NumberInput, Select, Button, Badge, Box, Loader, Checkbox, SimpleGrid, Modal, Progress, Anchor, Alert, ScrollArea, Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconRoute, IconGasStation, IconBed, IconToolsKitchen2, IconMapPin, IconCar, IconPlaneDeparture, IconCloudRain, IconSun, IconRadar, IconFolderPlus, IconRefresh, IconSparkles, IconInfoCircle,
  IconMotorbike, IconTrain, IconBus, IconPlane, IconDiamond, IconBulb, IconCalendarEvent, IconHome, IconExternalLink, IconFlag, IconMapPinFilled,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import { planTrip } from '../../ai/tripEngine';
import { tripToProject, STYLE_META } from '../../ai/planner';
import { createProjectFromPlan } from '../../ai/projectPlanner';
import { mapsLink, mapsSearchLink } from '../../ai/geo';
import { weatherMeta } from '../../weather';
import { APP_NAME } from '../../config/env';
import PlaceInput from '../PlaceInput';
import PlanMap from './PlanMap';

const KIND_ICON = { travel: IconCar, fuel: IconGasStation, food: IconToolsKitchen2, sight: IconMapPin, free: IconSun, stay: IconBed };
const MODE_ICON = { car: IconCar, bike: IconMotorbike, train: IconTrain, bus: IconBus, flight: IconPlane };
const TIER = { budget: { label: 'Budget', color: '#1b5a38' }, mid: { label: 'Mid-range', color: '#1971c2' }, luxury: { label: 'Luxury', color: '#7048e8' } };

export function WeatherChip({ w }) {
  if (!w) return null;
  const meta = weatherMeta(w.code);
  const Icon = meta.icon;
  return (
    <Group gap={4} wrap="nowrap">
      <Icon size={14} color={meta.color} />
      <Text fz={12}>{w.tmin}–{w.tmax}°{w.rainProb != null ? ` · ${w.rainProb}% rain` : ''}</Text>
    </Group>
  );
}

function DayCard({ d, pois, to }) {
  const poi = (id) => pois?.find((p) => p.id === id);
  return (
    <Box className="pl-day" p="sm">
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Text fw={700} fz={14}>Day {d.day} · {dayjs(d.date).format('ddd, MMM D')} — {d.title}</Text>
        <WeatherChip w={d.weather} />
      </Group>
      {d.items.map((it, i) => {
        const Icon = KIND_ICON[it.kind] ?? IconMapPin;
        const p = it.poi ? poi(it.poi) : null;
        const link = p ? mapsLink(p.lat, p.lon) : it.kind === 'sight' || it.kind === 'food' || it.kind === 'stay' ? mapsSearchLink(it.title.replace(/^(?:lunch|dinner|breakfast) at\s+/i, ''), to) : null;
        return (
          <div key={i} className="pl-item">
            <span className="pl-time">{it.time}</span>
            <Icon size={15} color={it.kind === 'fuel' ? '#e8590c' : it.kind === 'food' ? '#1b5a38' : it.kind === 'travel' ? '#1971c2' : it.kind === 'stay' ? '#7048e8' : '#0D2D1C'} style={{ marginTop: 2 }} />
            <div>
              <Text fz={13.5} fw={600}>{it.title}{link && <Anchor href={link} target="_blank" rel="noopener" fz={11.5} ml={6}>map ↗</Anchor>}</Text>
              {it.note && <Text fz={12} c="dimmed">{it.note}</Text>}
            </div>
          </div>
        );
      })}
      {d.tips?.map((t, i) => <Text key={i} fz={12} c="orange" mt={4}>• {t}</Text>)}
    </Box>
  );
}

function Section({ title, icon: Icon, count, children, color = '#1b5a38' }) {
  return (
    <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
      <Group gap={6} mb={6}><Icon size={15} color={color} /><Text fw={700} fz={13}>{title}</Text>{count != null && <Badge size="xs" variant="light" color="gray">{count}</Badge>}</Group>
      {children}
    </Box>
  );
}

// a list of places the guide suggested — with a map link each
function GuideList({ items, max = 8, meta }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, max);
  return (
    <Stack gap={5}>
      {shown.map((p, i) => (
        <div key={`${p.name}-${i}`} className="pl-poi">
          <Group justify="space-between" wrap="nowrap" gap={6}>
            <Text fz={12.5} fw={600} lineClamp={1}>{p.name}</Text>
            {p.mapUrl && <Anchor href={p.mapUrl} target="_blank" rel="noopener" fz={11.5} style={{ flexShrink: 0 }}>{p.poi ? 'navigate' : 'find on map'}</Anchor>}
          </Group>
          {(p.why || p.what) && <Text fz={11.5} c="dimmed" lineClamp={2}>{p.why || p.what}</Text>}
          {meta && <Text fz={11} c="#6f7f76" mt={2}>{meta(p)}</Text>}
        </div>
      ))}
      {items.length > max && <Button size="compact-xs" variant="subtle" color="forest" onClick={() => setAll((v) => !v)} style={{ alignSelf: 'flex-start' }}>{all ? 'Show fewer' : `Show all ${items.length}`}</Button>}
    </Stack>
  );
}

function PoiList({ items, empty, showKm = true, max = 8 }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return <Text fz={12} c="dimmed">{empty}</Text>;
  const shown = all ? items : items.slice(0, max);
  return (
    <Stack gap={5}>
      {shown.map((p) => (
        <div key={p.id} className="pl-poi">
          <Group justify="space-between" wrap="nowrap" gap={6}>
            <Text fz={12.5} fw={600} lineClamp={1}>{p.name ?? 'Fuel station'}</Text>
            <Anchor href={mapsLink(p.lat, p.lon)} target="_blank" rel="noopener" fz={11.5} style={{ flexShrink: 0 }}>navigate</Anchor>
          </Group>
          <Text fz={11.5} c="dimmed">{p.sub}{showKm && p.km != null ? ` · ${p.km} km` : ''}{p.tags?.cuisine ? ` · ${p.tags.cuisine.split(';')[0]}` : ''}{p.tags?.stars ? ` · ${p.tags.stars}★` : ''}</Text>
        </div>
      ))}
      {items.length > max && <Button size="compact-xs" variant="subtle" color="forest" onClick={() => setAll((v) => !v)} style={{ alignSelf: 'flex-start' }}>{all ? 'Show fewer' : `Show all ${items.length}`}</Button>}
    </Stack>
  );
}

export default function TripPlanner({ session }) {
  const update = useStore((s) => s.updatePlannerSession);
  const addEvent = useStore((s) => s.addEvent);
  const setPanel = useUI((s) => s.setPanel);
  const mobile = useMediaQuery('(max-width: 768px)');
  const [form, setForm] = useState(() => ({ from: '', to: '', start: null, end: null, travellers: 2, budget: null, style: 'balanced', transport: 'car', ...session.input }));
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const result = session.result;
  const guide = result?.guide ?? null;
  const variant = useMemo(() => result?.variants.find((v) => v.id === session.chosen) ?? result?.variants[0], [result, session.chosen]);
  const allPois = useMemo(() => (result ? [...result.pois.attractions, ...result.pois.food, ...result.pois.stays, ...result.pois.fuel] : []), [result]);
  const routes = result?.routes?.length ? result.routes : result?.route ? [result.route] : [];
  const route = routes[Math.min(session.routeIndex ?? 0, routes.length - 1)] ?? null;

  const run = async () => {
    const input = { ...form, end: form.end ?? form.start };
    update(session.id, { input, title: input.to ? `${input.from ? `${input.from} → ` : ''}${input.to}` : session.title });
    setError(null); setSteps([]); setRunning(true);
    try {
      const res = await planTrip(input, { onProgress: (label) => setSteps((s) => [...s, label]), state: useStore.getState() });
      update(session.id, { result: res, status: 'planned', chosen: res.variants[0].id, routeIndex: 0, input });
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const confirm = () => {
    const { plan, events } = tripToProject(session, variant);
    const res = createProjectFromPlan(plan, useStore.getState());
    events.forEach((e) => addEvent(e));
    update(session.id, { status: 'confirmed', projectId: res.project.id });
    setConfirming(false);
    notifications.show({ title: `"${res.project.name}" is on the books`, message: `${res.milestoneCount} milestones · ${res.taskCount} tasks · ${events.length} calendar days. Start the trip from here when you leave.`, color: 'forest' });
  };

  const markers = useMemo(() => {
    if (!result) return [];
    const m = [];
    if (result.fromGeo) m.push({ ...result.fromGeo, label: `Start: ${result.fromGeo.name}`, color: '#1971c2', radius: 8 });
    m.push({ ...result.toGeo, label: result.toGeo.name, color: '#e03131', radius: 8 });
    (variant?.days ?? []).flatMap((d) => d.items).forEach((it) => { const p = it.poi && allPois.find((x) => x.id === it.poi); if (p) m.push({ lat: p.lat, lon: p.lon, label: p.name ?? p.sub, color: p.kind === 'fuel' ? '#e8590c' : p.kind === 'food' ? '#1b5a38' : p.kind === 'stay' ? '#7048e8' : '#0D2D1C' }); });
    (guide?.mustSee ?? []).forEach((g) => { if (g.lat != null && !m.some((x) => x.lat === g.lat && x.lon === g.lon)) m.push({ lat: g.lat, lon: g.lon, label: g.name, color: '#f0a316', radius: 5 }); });
    return m;
  }, [result, variant, allPois, guide]);

  const packingDone = new Set(session.packingDone ?? []);
  const togglePack = (item) => update(session.id, (s) => { const set = new Set(s.packingDone ?? []); if (set.has(item)) set.delete(item); else set.add(item); return { packingDone: [...set] }; });

  const staysByTier = useMemo(() => {
    const out = { budget: [], mid: [], luxury: [] };
    (guide?.stays ?? []).forEach((s) => out[s.tier ?? 'mid'].push(s));
    return out;
  }, [guide]);

  return (
    <Stack gap="md">
      {/* ----- the form ----- */}
      <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
          <PlaceInput label="From" placeholder="Chennai" radius="md" size="sm" value={form.from} onChange={(v) => setForm({ ...form, from: v })} leftSection={<IconMapPinFilled size={14} color="#1971c2" />} />
          <PlaceInput label="To" placeholder="type a few letters — Kodaikanal, Goa…" radius="md" size="sm" value={form.to} onChange={(v) => setForm({ ...form, to: v })} leftSection={<IconFlag size={14} color="#e03131" />} />
          <DateInput label="Start" radius="md" size="sm" value={form.start ? dayjs(form.start).toDate() : null} onChange={(v) => setForm({ ...form, start: v ? dayjs(v).format('YYYY-MM-DD') : null })} />
          <DateInput label="End" radius="md" size="sm" value={form.end ? dayjs(form.end).toDate() : null} minDate={form.start ? dayjs(form.start).toDate() : undefined} onChange={(v) => setForm({ ...form, end: v ? dayjs(v).format('YYYY-MM-DD') : null })} />
          <NumberInput label="Travellers" radius="md" size="sm" min={1} max={20} value={form.travellers ?? 2} onChange={(v) => setForm({ ...form, travellers: Number(v) || 1 })} />
          <NumberInput label="Budget (₹)" radius="md" size="sm" min={0} step={1000} thousandSeparator="," value={form.budget ?? ''} onChange={(v) => setForm({ ...form, budget: v === '' ? null : Number(v) })} />
          <Select label="Style" radius="md" size="sm" allowDeselect={false} value={form.style} onChange={(v) => setForm({ ...form, style: v })} data={Object.entries(STYLE_META).map(([k, v]) => ({ value: k, label: v.name }))} />
          <Select label="Getting there" radius="md" size="sm" allowDeselect={false} value={form.transport} onChange={(v) => setForm({ ...form, transport: v })} data={[{ value: 'car', label: 'Car' }, { value: 'bike', label: 'Bike' }, { value: 'train', label: 'Train' }, { value: 'bus', label: 'Bus' }, { value: 'flight', label: 'Flight' }]} />
        </SimpleGrid>
        <Group justify="space-between" mt="sm">
          <Text fz={12} c="dimmed">{APP_NAME} builds every route, the weather, stays across budgets, must-sees, food, ways to get there and several itineraries.</Text>
          <Button radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} leftSection={result ? <IconRefresh size={15} /> : <IconRoute size={16} />} loading={running} onClick={run} disabled={!form.to || !form.start}>
            {result ? 'Re-plan' : 'Plan'}
          </Button>
        </Group>
        {running && (
          <Stack gap={3} mt="xs">
            {steps.map((s, i) => <Group key={i} gap={6}>{i === steps.length - 1 ? <Loader size={10} color="forest" /> : <Text fz={11} c="forest">✓</Text>}<Text fz={12} c="dimmed">{s}</Text></Group>)}
          </Stack>
        )}
        {error && <Alert color="red" radius="md" mt="xs" icon={<IconInfoCircle size={15} />}>{error}</Alert>}
      </Box>

      {/* ----- the plan ----- */}
      {result && variant && (
        <>
          <Group gap={8}>
            {route && <Badge variant="light" color="blue" leftSection={<IconRoute size={11} />}>{route.km} km{route.minutes ? ` · ${Math.round(route.minutes / 60)}h ${route.minutes % 60}m` : ''}{route.estimated ? ' (est.)' : ''}</Badge>}
            <Badge variant="light" color="gray">{result.days} day{result.days === 1 ? '' : 's'} · {result.nights} night{result.nights === 1 ? '' : 's'}</Badge>
            <Badge variant="light" color={session.input.budget && variant.budget.total > session.input.budget ? 'red' : 'forest'}>est. ₹{variant.budget.total.toLocaleString('en-IN')}{session.input.budget ? ` / ₹${session.input.budget.toLocaleString('en-IN')}` : ''}</Badge>
            <Badge variant="light" color="gray">{result.variants.length} plans</Badge>
            {guide && <Tooltip label={`Destination research by ${guide.model}${guide.dedicated ? ' (your ChatGPT key)' : ''}`}><Badge variant="light" color="grape" leftSection={<IconSparkles size={10} />}>researched by {guide.dedicated ? 'ChatGPT' : APP_NAME}</Badge></Tooltip>}
            {!guide && result.source === 'ai' && <Badge variant="light" color="forest" leftSection={<IconSparkles size={10} />}>polished by {APP_NAME}</Badge>}
            {result.weatherUnavailable && <Badge variant="light" color="gray" leftSection={<IconCloudRain size={10} />}>forecast opens 16 days ahead</Badge>}
          </Group>

          {guide?.overview && (
            <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
              <Text fz={13.5} lh={1.5}>{guide.overview}</Text>
              {guide.bestTime && <Text fz={12} c="dimmed" mt={4}><b>Best time:</b> {guide.bestTime}</Text>}
              {guide.budgetNotes && <Text fz={12} c="dimmed" mt={2}><b>Money:</b> {guide.budgetNotes}</Text>}
            </Box>
          )}

          {/* every way to get there */}
          {result.transport?.length > 0 && (
            <Box>
              <Text fw={700} fz={13} mb={6}>Ways to get there — {result.fromGeo?.name ?? session.input.from} → {result.toGeo.name}</Text>
              <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing={8}>
                {result.transport.map((t) => {
                  const Icon = MODE_ICON[t.mode] ?? IconCar;
                  const chosen = t.mode === session.input.transport;
                  return (
                    <Box key={t.mode} p="sm" style={{ borderRadius: 14, border: `1px solid ${chosen ? '#0D2D1C' : '#e9eeeb'}`, background: chosen ? 'rgba(13,45,28,0.05)' : '#fff' }}>
                      <Group gap={6} mb={2}><Icon size={16} color="#0D2D1C" /><Text fz={13} fw={700}>{t.label}</Text>{chosen && <Badge size="xs" variant="filled" color="forest">chosen</Badge>}</Group>
                      <Text fz={12.5} fw={600}>{t.time}</Text>
                      <Text fz={12} c="dimmed">{t.costLabel} <span style={{ opacity: 0.7 }}>· {t.note}</span></Text>
                      {t.how && <Text fz={11.5} c="dimmed" mt={3} lineClamp={3}>{t.how}</Text>}
                    </Box>
                  );
                })}
              </SimpleGrid>
            </Box>
          )}

          {/* road options */}
          {(routes.length > 1 || guide?.routes?.length > 0) && (
            <Box>
              <Text fw={700} fz={13} mb={6}>Road options</Text>
              {routes.length > 1 && (
                <Group gap={6} mb={8}>
                  {routes.map((r, i) => (
                    <Button key={r.id ?? i} size="xs" radius="xl" variant={i === (session.routeIndex ?? 0) ? 'filled' : 'light'} color="forest" leftSection={<IconRoute size={12} />} onClick={() => update(session.id, { routeIndex: i })}>
                      {r.name} · {r.km} km · {Math.round(r.minutes / 60)}h {r.minutes % 60}m
                    </Button>
                  ))}
                </Group>
              )}
              {guide?.routes?.length > 0 && (
                <SimpleGrid cols={{ base: 1, md: guide.routes.length > 1 ? 2 : 1 }} spacing={8}>
                  {guide.routes.map((r, i) => (
                    <Box key={i} className="pl-poi">
                      <Group justify="space-between" wrap="nowrap"><Text fz={13} fw={700}>{r.name}</Text>{(r.km || r.hours) && <Text fz={11.5} c="dimmed" style={{ flexShrink: 0 }}>{r.km ? `${r.km} km` : ''}{r.km && r.hours ? ' · ' : ''}{r.hours ? `${r.hours} h` : ''}</Text>}</Group>
                      {r.summary && <Text fz={12} c="dimmed" mt={2}>{r.summary}</Text>}
                      {r.stops.length > 0 && <Text fz={12} mt={3}><b>Worth a stop:</b> {r.stops.join(' · ')}</Text>}
                      {r.notes && <Text fz={11.5} c="orange" mt={2}>{r.notes}</Text>}
                    </Box>
                  ))}
                </SimpleGrid>
              )}
            </Box>
          )}

          {/* the itineraries */}
          <Box>
            <Text fw={700} fz={13} mb={6}>Itineraries — pick the one that feels right</Text>
            <ScrollArea type="never">
              <Group gap={6} wrap="nowrap">
                {result.variants.map((v) => (
                  <Button
                    key={v.id} size="xs" radius="xl" variant={v.id === variant.id ? 'filled' : 'light'} color={v.source === 'guide' ? 'orange' : 'forest'}
                    leftSection={v.source === 'guide' ? <IconSparkles size={12} /> : null} onClick={() => update(session.id, { chosen: v.id })} style={{ flexShrink: 0 }}
                  >
                    {v.name}
                  </Button>
                ))}
              </Group>
            </ScrollArea>
            <Text fz={13} c="dimmed" mt={6}>{variant.tagline}{variant.stay ? ` Stay: ${variant.stay.name}.` : ''}</Text>
          </Box>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Stack gap="sm">
              {variant.days.map((d) => <DayCard key={d.day} d={d} pois={allPois} to={result.toGeo.name} />)}
              {result.tips.length > 0 && (
                <Section title="Tips for this trip" icon={IconBulb} color="#f0a316">
                  {result.tips.map((t, i) => <Text key={i} fz={12.5}>• {t}</Text>)}
                </Section>
              )}
              {guide?.events?.length > 0 && (
                <Section title="Around your dates" icon={IconCalendarEvent} color="#e64980">
                  {guide.events.map((e, i) => <Text key={i} fz={12.5}>• <b>{e.name}</b>{e.when ? ` — ${e.when}` : ''}{e.note ? `. ${e.note}` : ''}</Text>)}
                </Section>
              )}
            </Stack>
            <Stack gap="md">
              <PlanMap route={route} markers={markers} height={mobile ? 220 : 280} />
              <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
                <Text fw={700} fz={13} mb={6}>Budget estimate — {variant.budget.rooms} room{variant.budget.rooms === 1 ? '' : 's'}, {variant.budget.tier} stays</Text>
                {[['Transport', variant.budget.transport], ['Stay', variant.budget.stay], ['Food', variant.budget.food], ['Activities', variant.budget.activities]].map(([k, v]) => (
                  <Group key={k} justify="space-between"><Text fz={12.5}>{k}</Text><Text fz={12.5} fw={600}>₹{v.toLocaleString('en-IN')}</Text></Group>
                ))}
                <Group justify="space-between" mt={4} pt={4} style={{ borderTop: '1px solid #e9eeeb' }}><Text fz={13} fw={700}>Total</Text><Text fz={13} fw={800}>₹{variant.budget.total.toLocaleString('en-IN')}</Text></Group>
                {session.input.budget && <Progress mt={6} value={Math.min(100, (variant.budget.total / session.input.budget) * 100)} color={variant.budget.total > session.input.budget ? 'red' : 'forest'} size={6} radius="xl" />}
              </Box>

              {guide?.areas?.length > 0 && (
                <Section title="Where to stay — areas" icon={IconHome} count={guide.areas.length} color="#7048e8">
                  <GuideList items={guide.areas} max={6} meta={(a) => a.budget} />
                </Section>
              )}
              {guide?.stays?.length > 0 && (
                <Section title="Stays across budgets" icon={IconBed} count={guide.stays.length} color="#7048e8">
                  <Stack gap={8}>
                    {['budget', 'mid', 'luxury'].filter((t) => staysByTier[t].length).map((t) => (
                      <div key={t}>
                        <Text fz={11} fw={800} tt="uppercase" lts={0.5} c={TIER[t].color} mb={4}>{TIER[t].label}</Text>
                        <GuideList items={staysByTier[t]} max={4} meta={(s) => [s.area, s.price].filter(Boolean).join(' · ')} />
                      </div>
                    ))}
                  </Stack>
                </Section>
              )}
              <Section title={guide?.stays?.length ? 'More stays on the map' : 'Stays near the centre'} icon={IconBed} count={result.pois.stays.length} color="#7048e8">
                <PoiList items={result.pois.stays} empty="No named stays found on the map — search booking sites for the town." max={6} />
              </Section>

              {guide?.mustSee?.length > 0 && (
                <Section title="Must-see" icon={IconMapPin} count={guide.mustSee.length} color="#0D2D1C">
                  <GuideList items={guide.mustSee} max={8} meta={(p) => [p.kind, p.time, p.bestAt ? `best ${p.bestAt}` : null, p.cost].filter(Boolean).join(' · ')} />
                </Section>
              )}
              {guide?.hiddenGems?.length > 0 && (
                <Section title="Hidden gems" icon={IconDiamond} count={guide.hiddenGems.length} color="#f0a316">
                  <GuideList items={guide.hiddenGems} max={6} />
                </Section>
              )}
              <Section title={guide?.mustSee?.length ? 'More places on the map' : 'Places to see'} icon={IconMapPin} count={result.pois.attractions.length}>
                <PoiList items={result.pois.attractions} empty="No named sights on the map here." max={6} />
              </Section>

              {guide?.food?.length > 0 && (
                <Section title="What to eat" icon={IconToolsKitchen2} count={guide.food.length}>
                  <GuideList items={guide.food} max={6} meta={(f) => f.area} />
                </Section>
              )}
              <Section title={guide?.food?.length ? 'Restaurants on the map' : 'Where to eat'} icon={IconToolsKitchen2} count={result.pois.food.length}>
                <PoiList items={result.pois.food} empty="No named restaurants on the map here — ask locals when you arrive." max={6} />
              </Section>

              {result.pois.fuel.length > 0 && (
                <Section title="Fuel along the route" icon={IconGasStation} count={result.pois.fuel.length} color="#e8590c">
                  <PoiList items={result.pois.fuel.map((f) => ({ ...f, sub: `km ${f.km} from ${session.input.from}` }))} empty="" showKm={false} max={6} />
                </Section>
              )}
              <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
                <Text fw={700} fz={13} mb={6}>Packing list · {packingDone.size}/{result.packing.length}</Text>
                <Stack gap={4}>
                  {result.packing.map((item) => <Checkbox key={item} size="xs" radius="xl" color="forest" label={item} checked={packingDone.has(item)} onChange={() => togglePack(item)} />)}
                </Stack>
              </Box>
            </Stack>
          </SimpleGrid>

          <Group justify="flex-end" gap="sm">
            {session.status === 'planned' && (
              <Button radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} leftSection={<IconFolderPlus size={16} />} onClick={() => setConfirming(true)}>Confirm this plan</Button>
            )}
            {session.status === 'confirmed' && (
              <>
                <Button radius="xl" variant="light" color="forest" rightSection={<IconExternalLink size={13} />} onClick={() => setPanel('projects')}>Open the project</Button>
                <Button radius="xl" variant="gradient" gradient={{ from: '#e03131', to: '#e8590c' }} leftSection={<IconRadar size={16} />} onClick={() => update(session.id, { status: 'live', live: { startedAt: new Date().toISOString(), log: [], done: [] } })}>Start trip — go live</Button>
              </>
            )}
          </Group>
        </>
      )}

      <Modal opened={confirming} onClose={() => setConfirming(false)} radius="xl" centered title={<Text fw={800} fz={18}>Confirm "{variant?.name}"?</Text>}>
        {variant && (
          <Stack gap="sm">
            <Text fz={13.5}>This creates a project <b>Trip: {session.input.to}</b> with a pre-trip checklist, one milestone per day and {variant.days.length} calendar day{variant.days.length === 1 ? '' : 's'}. Nothing is booked for you — the plan just becomes real tasks and dates.</Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="subtle" color="gray" radius="xl" onClick={() => setConfirming(false)}>Not yet</Button>
              <Button radius="xl" color="forest" leftSection={<IconPlaneDeparture size={15} />} onClick={confirm}>Create project & dates</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
