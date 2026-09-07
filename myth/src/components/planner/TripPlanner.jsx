// Trip mode: the form, the planning run, the itinerary variants, and the
// confirm step that turns the chosen plan into a project + calendar days.
import { useMemo, useState } from 'react';
import {
  Stack, Group, Text, TextInput, NumberInput, Select, Button, Badge, Tabs, Box, Loader, Checkbox, SimpleGrid, Modal, Progress, Anchor, Alert,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconRoute, IconGasStation, IconBed, IconToolsKitchen2, IconMapPin, IconCar, IconPlaneDeparture, IconCloudRain, IconSun, IconRadar, IconFolderPlus, IconRefresh, IconSparkles, IconInfoCircle,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import { planTrip } from '../../ai/tripEngine';
import { tripToProject, STYLE_META } from '../../ai/planner';
import { createProjectFromPlan } from '../../ai/projectPlanner';
import { mapsLink } from '../../ai/geo';
import { weatherMeta } from '../../weather';
import { APP_NAME } from '../../config/env';
import PlanMap from './PlanMap';

const KIND_ICON = { travel: IconCar, fuel: IconGasStation, food: IconToolsKitchen2, sight: IconMapPin, free: IconSun };

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

function DayCard({ d, pois }) {
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
        return (
          <div key={i} className="pl-item">
            <span className="pl-time">{it.time}</span>
            <Icon size={15} color={it.kind === 'fuel' ? '#e8590c' : it.kind === 'food' ? '#0f766e' : it.kind === 'travel' ? '#1971c2' : '#12a150'} style={{ marginTop: 2 }} />
            <div>
              <Text fz={13.5} fw={600}>{it.title}{p && <Anchor href={mapsLink(p.lat, p.lon)} target="_blank" rel="noopener" fz={11.5} ml={6}>map ↗</Anchor>}</Text>
              {it.note && <Text fz={12} c="dimmed">{it.note}</Text>}
            </div>
          </div>
        );
      })}
      {d.tips?.map((t, i) => <Text key={i} fz={12} c="orange" mt={4}>• {t}</Text>)}
    </Box>
  );
}

function PoiList({ title, icon: Icon, items, empty, showKm = true }) {
  return (
    <Box>
      <Group gap={6} mb={6}><Icon size={15} color="#0f766e" /><Text fw={700} fz={13}>{title}</Text></Group>
      {items.length === 0 ? <Text fz={12} c="dimmed">{empty}</Text> : (
        <Stack gap={5}>
          {items.slice(0, 8).map((p) => (
            <div key={p.id} className="pl-poi">
              <Group justify="space-between" wrap="nowrap" gap={6}>
                <Text fz={12.5} fw={600} lineClamp={1}>{p.name ?? 'Fuel station'}</Text>
                <Anchor href={mapsLink(p.lat, p.lon)} target="_blank" rel="noopener" fz={11.5} style={{ flexShrink: 0 }}>navigate</Anchor>
              </Group>
              <Text fz={11.5} c="dimmed">{p.sub}{showKm && p.km != null ? ` · ${p.km} km` : ''}{p.tags?.cuisine ? ` · ${p.tags.cuisine.split(';')[0]}` : ''}{p.tags?.stars ? ` · ${p.tags.stars}★` : ''}</Text>
            </div>
          ))}
        </Stack>
      )}
    </Box>
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
  const variant = useMemo(() => result?.variants.find((v) => v.id === session.chosen) ?? result?.variants[0], [result, session.chosen]);
  const allPois = useMemo(() => (result ? [...result.pois.attractions, ...result.pois.food, ...result.pois.stays, ...result.pois.fuel] : []), [result]);

  const run = async () => {
    const input = { ...form, end: form.end ?? form.start };
    update(session.id, { input, title: input.to ? `${input.from ? `${input.from} → ` : ''}${input.to}` : session.title });
    setError(null); setSteps([]); setRunning(true);
    try {
      const res = await planTrip(input, { onProgress: (label) => setSteps((s) => [...s, label]), state: useStore.getState() });
      update(session.id, { result: res, status: 'planned', chosen: res.variants[0].id, input });
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
    (variant?.days ?? []).flatMap((d) => d.items).forEach((it) => { const p = it.poi && allPois.find((x) => x.id === it.poi); if (p) m.push({ lat: p.lat, lon: p.lon, label: p.name ?? p.sub, color: p.kind === 'fuel' ? '#e8590c' : p.kind === 'food' ? '#0f766e' : p.kind === 'stay' ? '#7048e8' : '#12a150' }); });
    return m;
  }, [result, variant, allPois]);

  const packingDone = new Set(session.packingDone ?? []);
  const togglePack = (item) => update(session.id, (s) => { const set = new Set(s.packingDone ?? []); if (set.has(item)) set.delete(item); else set.add(item); return { packingDone: [...set] }; });

  return (
    <Stack gap="md">
      {/* ----- the form ----- */}
      <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput label="From" placeholder="Chennai" radius="md" value={form.from} onChange={(e) => setForm({ ...form, from: e.currentTarget.value })} />
          <TextInput label="To" placeholder="Goa" radius="md" value={form.to} onChange={(e) => setForm({ ...form, to: e.currentTarget.value })} />
          <DateInput label="Start" radius="md" value={form.start ? dayjs(form.start).toDate() : null} onChange={(v) => setForm({ ...form, start: v ? dayjs(v).format('YYYY-MM-DD') : null })} />
          <DateInput label="End" radius="md" value={form.end ? dayjs(form.end).toDate() : null} minDate={form.start ? dayjs(form.start).toDate() : undefined} onChange={(v) => setForm({ ...form, end: v ? dayjs(v).format('YYYY-MM-DD') : null })} />
          <NumberInput label="Travellers" radius="md" min={1} max={20} value={form.travellers ?? 2} onChange={(v) => setForm({ ...form, travellers: Number(v) || 1 })} />
          <NumberInput label="Budget (₹)" radius="md" min={0} step={1000} thousandSeparator="," value={form.budget ?? ''} onChange={(v) => setForm({ ...form, budget: v === '' ? null : Number(v) })} />
          <Select label="Style" radius="md" value={form.style} onChange={(v) => setForm({ ...form, style: v })} data={Object.entries(STYLE_META).map(([k, v]) => ({ value: k, label: v.name }))} />
          <Select label="Getting there" radius="md" value={form.transport} onChange={(v) => setForm({ ...form, transport: v })} data={[{ value: 'car', label: 'Car' }, { value: 'bike', label: 'Bike' }, { value: 'train', label: 'Train' }, { value: 'bus', label: 'Bus' }, { value: 'flight', label: 'Flight' }]} />
        </SimpleGrid>
        <Group justify="flex-end" mt="sm">
          <Button radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }} leftSection={result ? <IconRefresh size={15} /> : <IconRoute size={16} />} loading={running} onClick={run} disabled={!form.to || !form.start}>
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
            {result.route && <Badge variant="light" color="blue" leftSection={<IconRoute size={11} />}>{result.route.km} km{result.route.minutes ? ` · ${Math.round(result.route.minutes / 60)}h ${result.route.minutes % 60}m` : ''}{result.route.estimated ? ' (est.)' : ''}</Badge>}
            <Badge variant="light" color="gray">{result.days} day{result.days === 1 ? '' : 's'} · {result.nights} night{result.nights === 1 ? '' : 's'}</Badge>
            <Badge variant="light" color={session.input.budget && variant.budget.total > session.input.budget ? 'red' : 'forest'}>est. ₹{variant.budget.total.toLocaleString('en-IN')}{session.input.budget ? ` / ₹${session.input.budget.toLocaleString('en-IN')}` : ''}</Badge>
            {result.source === 'ai' && <Badge variant="light" color="forest" leftSection={<IconSparkles size={10} />}>polished by {APP_NAME}</Badge>}
            {result.weatherUnavailable && <Badge variant="light" color="gray" leftSection={<IconCloudRain size={10} />}>forecast opens 16 days ahead</Badge>}
          </Group>

          <Tabs value={variant.id} onChange={(v) => update(session.id, { chosen: v })} radius="md" color="forest">
            <Tabs.List>
              {result.variants.map((v) => <Tabs.Tab key={v.id} value={v.id}>{v.name}</Tabs.Tab>)}
            </Tabs.List>
          </Tabs>
          <Text fz={13} c="dimmed">{variant.tagline}{variant.stay ? ` Stay: ${variant.stay.name}.` : ''}</Text>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Stack gap="sm">
              {variant.days.map((d) => <DayCard key={d.day} d={d} pois={allPois} />)}
              {result.tips.length > 0 && (
                <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
                  <Text fw={700} fz={13} mb={4}>Tips for this trip</Text>
                  {result.tips.map((t, i) => <Text key={i} fz={12.5}>• {t}</Text>)}
                </Box>
              )}
            </Stack>
            <Stack gap="md">
              <PlanMap route={result.route} markers={markers} height={mobile ? 220 : 280} />
              <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
                <Text fw={700} fz={13} mb={6}>Budget estimate — {variant.budget.rooms} room{variant.budget.rooms === 1 ? '' : 's'}, {variant.budget.tier} stays</Text>
                {[['Transport', variant.budget.transport], ['Stay', variant.budget.stay], ['Food', variant.budget.food], ['Activities', variant.budget.activities]].map(([k, v]) => (
                  <Group key={k} justify="space-between"><Text fz={12.5}>{k}</Text><Text fz={12.5} fw={600}>₹{v.toLocaleString('en-IN')}</Text></Group>
                ))}
                <Group justify="space-between" mt={4} pt={4} style={{ borderTop: '1px solid #e9eeeb' }}><Text fz={13} fw={700}>Total</Text><Text fz={13} fw={800}>₹{variant.budget.total.toLocaleString('en-IN')}</Text></Group>
                {session.input.budget && <Progress mt={6} value={Math.min(100, (variant.budget.total / session.input.budget) * 100)} color={variant.budget.total > session.input.budget ? 'red' : 'forest'} size={6} radius="xl" />}
              </Box>
              <PoiList title="Stays near the centre" icon={IconBed} items={result.pois.stays} empty="No named stays found on the map — search booking sites for the town." />
              <PoiList title="Where to eat" icon={IconToolsKitchen2} items={result.pois.food} empty="No named restaurants on the map here — ask locals when you arrive." />
              {result.pois.fuel.length > 0 && <PoiList title="Fuel along the route" icon={IconGasStation} items={result.pois.fuel.map((f) => ({ ...f, sub: `km ${f.km} from ${session.input.from}` }))} empty="" showKm={false} />}
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
              <Button radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }} leftSection={<IconFolderPlus size={16} />} onClick={() => setConfirming(true)}>Confirm this plan</Button>
            )}
            {session.status === 'confirmed' && (
              <>
                <Button radius="xl" variant="light" color="forest" onClick={() => setPanel('projects')}>Open the project</Button>
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
