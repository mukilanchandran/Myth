// Live mode: where you are, what the sky is doing, what's nearby (fuel, food,
// stays, help) and what's next on the plan — refreshed as you move.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, Group, Text, Button, Badge, Box, Tabs, TextInput, Checkbox, Anchor, Loader, ActionIcon, Tooltip } from '@mantine/core';
import { IconGasStation, IconBed, IconToolsKitchen2, IconFirstAidKit, IconCash, IconMapPin, IconRefresh, IconFlag, IconCheck, IconNavigation } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { watchPosition, reverseGeocode, weatherNow, nearby, geocode, progressAlong, mapsLink, haversineKm, bearingDeg, compass } from '../../ai/geo';
import { liveAdvice, tripDayIndex } from '../../ai/planner';
import { aiLiveLine } from '../../ai/plannerAi';
import { weatherMeta } from '../../weather';
import { APP_NAME } from '../../config/env';
import PlanMap from './PlanMap';

const TABS = [
  { key: 'fuel', label: 'Fuel', icon: IconGasStation },
  { key: 'food', label: 'Food', icon: IconToolsKitchen2 },
  { key: 'stay', label: 'Stay', icon: IconBed },
  { key: 'health', label: 'Help', icon: IconFirstAidKit },
  { key: 'atm', label: 'ATM', icon: IconCash },
];

export default function LiveTrip({ session }) {
  const update = useStore((s) => s.updatePlannerSession);
  const [pos, setPos] = useState(session.live?.lastPos ?? null);
  const [place, setPlace] = useState(session.live?.lastPlace ?? null);
  const [weather, setWeather] = useState(null);
  const [near, setNear] = useState([]);
  const [busy, setBusy] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [manual, setManual] = useState('');
  const [aiLine, setAiLine] = useState(null);
  const [tab, setTab] = useState('fuel');
  const lastFetched = useRef(null);

  const result = session.result;
  const variant = useMemo(() => result?.variants.find((v) => v.id === session.chosen) ?? result?.variants[0], [result, session.chosen]);
  const day = useMemo(() => tripDayIndex(session, dayjs()), [session]);
  const today = day.phase === 'during' ? variant?.days[day.index - 1] : null;
  const done = new Set(session.live?.done ?? []);
  const progress = useMemo(() => (pos && result?.route?.geometry ? progressAlong(result.route.geometry, pos) : null), [pos, result]);

  // each lookup lands on its own — a slow places query must not hold back the
  // place name or the weather
  const refresh = useCallback(async (p) => {
    if (!p) return;
    setBusy(true);
    lastFetched.current = p;
    update(session.id, (s) => ({ live: { ...(s.live ?? {}), lastPos: p, lastAt: new Date().toISOString() } }));
    const namesP = reverseGeocode(p.lat, p.lon).then((name) => { setPlace(name); update(session.id, (s) => ({ live: { ...(s.live ?? {}), lastPlace: name } })); return name; });
    const weatherP = weatherNow(p.lat, p.lon).then((w) => { setWeather(w); return w; });
    const nearP = nearby(p, ['fuel', 'food', 'stay', 'health', 'atm'], 8000, 8).then((nb) => { setNear(nb); setBusy(false); return nb; });
    const [name, w, nb] = await Promise.all([namesP, weatherP, nearP]);
    const facts = { place: name, time: dayjs().format('HH:mm'), weather: w ? { temp: w.temp, code: w.code, rainSoon: w.hourly.slice(0, 3).some((h) => h.rainProb >= 60) } : null, remainingKm: result?.route?.geometry ? progressAlong(result.route.geometry, p)?.remainingKm : null, destination: session.input.to, nextOnPlan: today?.items.find((i) => i.time >= dayjs().format('HH:mm'))?.title ?? null, nearestFuelKm: nb.find((x) => x.kind === 'fuel')?.km ?? null };
    aiLiveLine(facts, useStore.getState()).then((line) => { if (line) setAiLine(line); });
  }, [update, session.id, session.input.to, result, today]);

  // follow the device; re-query when we've moved a couple of kilometres
  useEffect(() => {
    const stop = watchPosition(
      (p) => {
        setPos(p);
        setGeoError(null);
        if (!lastFetched.current || haversineKm(lastFetched.current, p) > 2) refresh(p);
      },
      (msg) => setGeoError(msg),
    );
    return stop;
  }, [refresh]);

  // no fix yet but a remembered position → show something immediately
  useEffect(() => { if (pos && !lastFetched.current) refresh(pos); }, [pos, refresh]);

  const setManualPlace = async () => {
    if (!manual.trim()) return;
    setBusy(true);
    const g = await geocode(manual.trim());
    setBusy(false);
    if (!g) { setGeoError(`Couldn't find "${manual}".`); return; }
    const p = { lat: g.lat, lon: g.lon, manual: true, at: Date.now() };
    setPos(p); setManual(''); refresh(p);
  };

  const tips = useMemo(() => liveAdvice({ now: dayjs(), pos, place, weather, nearby: near, progress, fuelAlong: result?.pois?.fuel ?? [], day, session, variant }), [pos, place, weather, near, progress, result, day, session, variant]);

  const checkIn = () => update(session.id, (s) => ({ live: { ...(s.live ?? {}), log: [{ at: new Date().toISOString(), place: place ?? (pos ? `${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}` : 'unknown'), note: today ? `Day ${today.day}` : '' }, ...(s.live?.log ?? [])].slice(0, 50) } }));
  const toggleDone = (key) => update(session.id, (s) => { const set = new Set(s.live?.done ?? []); if (set.has(key)) set.delete(key); else set.add(key); return { live: { ...(s.live ?? {}), done: [...set] } }; });
  const endTrip = () => update(session.id, { status: 'done', live: { ...(session.live ?? {}), endedAt: new Date().toISOString() } });

  const wm = weather ? weatherMeta(weather.code) : null;
  const WIcon = wm?.icon;
  const list = near.filter((p) => p.kind === tab).sort((a, b) => a.km - b.km);
  const markers = list.slice(0, 8).map((p) => ({ lat: p.lat, lon: p.lon, label: p.name ?? p.sub, color: tab === 'fuel' ? '#e8590c' : tab === 'food' ? '#0f766e' : tab === 'stay' ? '#7048e8' : '#1971c2' }));
  if (result?.toGeo) markers.push({ ...result.toGeo, label: result.toGeo.name, color: '#e03131', radius: 8 });

  return (
    <Stack gap="md">
      {/* ----- where you are ----- */}
      <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap">
            <div className="pl-live-dot" />
            <div>
              <Text fw={700} fz={14}>{place ?? (pos ? 'Locating…' : geoError ?? 'Waiting for your location…')}</Text>
              <Text fz={12} c="dimmed">
                {day.phase === 'during' ? `Day ${day.index} of ${result?.days ?? '?'}` : day.phase === 'before' ? `${day.daysToGo} day${day.daysToGo === 1 ? '' : 's'} to go` : 'Trip dates are over'}
                {progress ? ` · ${progress.remainingKm} km to ${session.input.to}` : ''}
                {pos?.manual ? ' · manual location' : ''}
              </Text>
            </div>
          </Group>
          <Group gap={6} wrap="nowrap">
            {weather && WIcon && <Group gap={4} wrap="nowrap"><WIcon size={18} color={wm.color} /><Text fz={13} fw={600}>{weather.temp}°</Text></Group>}
            <Tooltip label="Refresh nearby"><ActionIcon variant="light" color="forest" radius="xl" onClick={() => pos && refresh(pos)} loading={busy}><IconRefresh size={15} /></ActionIcon></Tooltip>
          </Group>
        </Group>
        <Group gap={6} mt="xs" wrap="nowrap">
          <TextInput size="xs" radius="xl" style={{ flex: 1 }} placeholder={geoError ? "No GPS — type where you are (e.g. 'Tindivanam')" : "Or type where you are…"} value={manual} onChange={(e) => setManual(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && setManualPlace()} />
          <Button size="xs" radius="xl" variant="light" color="forest" onClick={setManualPlace}>Set</Button>
          <Button size="xs" radius="xl" variant="light" color="blue" leftSection={<IconFlag size={13} />} onClick={checkIn} disabled={!pos}>Check in</Button>
        </Group>
      </Box>

      {/* ----- what Myth says ----- */}
      {(aiLine || tips.length > 0) && (
        <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
          <Text fw={800} fz={12} tt="uppercase" lts={1} c="#12a150" mb={4}>{APP_NAME} says</Text>
          {aiLine && <Text fz={14} fw={500} mb={6}>“{aiLine}”</Text>}
          <Stack gap={3}>{tips.map((t, i) => <Text key={i} fz={12.5}>• {t.text}</Text>)}</Stack>
        </Box>
      )}

      {/* ----- next hours of weather ----- */}
      {weather && (
        <Group gap={6} wrap="nowrap" style={{ overflowX: 'auto' }}>
          {weather.hourly.slice(0, 8).map((h) => { const m = weatherMeta(h.code); const I = m.icon; return (
            <Box key={h.time} px={8} py={5} style={{ borderRadius: 10, background: h.rainProb >= 60 ? 'rgba(47,111,184,0.12)' : '#f3f6f4', flexShrink: 0, textAlign: 'center' }}>
              <Text fz={10.5} c="dimmed">{h.hour}</Text><I size={14} color={m.color} /><Text fz={11.5} fw={600}>{h.temp}°</Text>{h.rainProb >= 30 && <Text fz={10} c="blue">{h.rainProb}%</Text>}
            </Box>
          ); })}
        </Group>
      )}

      <PlanMap route={result?.route} markers={markers} pos={pos} height={240} />

      {/* ----- nearby ----- */}
      <Tabs value={tab} onChange={setTab} radius="md" color="forest">
        <Tabs.List>{TABS.map((t) => <Tabs.Tab key={t.key} value={t.key} leftSection={<t.icon size={14} />}>{t.label}</Tabs.Tab>)}</Tabs.List>
      </Tabs>
      {busy && !list.length ? <Group gap={6}><Loader size={12} color="forest" /><Text fz={12.5} c="dimmed">Looking around…</Text></Group> : list.length === 0 ? (
        <Text fz={12.5} c="dimmed">{pos ? `Nothing of this kind within 8 km on the map.` : 'Share your location or type where you are to see what is nearby.'}</Text>
      ) : (
        <Stack gap={5}>
          {list.slice(0, 8).map((p) => (
            <div key={p.id} className="pl-poi">
              <Group justify="space-between" wrap="nowrap" gap={6}>
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <IconMapPin size={14} color="#0f766e" style={{ flexShrink: 0 }} />
                  <Text fz={13} fw={600} lineClamp={1}>{p.name ?? 'Fuel station'}</Text>
                </Group>
                <Anchor href={mapsLink(p.lat, p.lon)} target="_blank" rel="noopener" fz={12} style={{ flexShrink: 0 }}><Group gap={3} wrap="nowrap"><IconNavigation size={12} />{p.km} km {pos ? compass(bearingDeg(pos, p)) : ''}</Group></Anchor>
              </Group>
              <Text fz={11.5} c="dimmed">{p.sub}{p.tags?.cuisine ? ` · ${p.tags.cuisine.split(';')[0]}` : ''}{p.tags?.opening ? ` · ${p.tags.opening}` : ''}{p.tags?.phone ? ` · ${p.tags.phone}` : ''}</Text>
            </div>
          ))}
        </Stack>
      )}

      {/* ----- today's plan ----- */}
      {today && (
        <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
          <Text fw={700} fz={13.5} mb={6}>Today — Day {today.day}: {today.title}</Text>
          <Stack gap={4}>
            {today.items.map((it, i) => { const key = `${today.day}:${i}`; return (
              <Checkbox key={key} size="xs" radius="xl" color="forest" checked={done.has(key)} onChange={() => toggleDone(key)}
                label={<Text fz={13} td={done.has(key) ? 'line-through' : undefined} c={done.has(key) ? 'dimmed' : undefined}><b>{it.time}</b> {it.title}{it.note ? <Text span fz={11.5} c="dimmed"> — {it.note}</Text> : null}</Text>} />
            ); })}
          </Stack>
        </Box>
      )}

      {/* ----- log ----- */}
      {(session.live?.log?.length ?? 0) > 0 && (
        <Box>
          <Text fw={700} fz={13} mb={4}>Trip log</Text>
          {session.live.log.slice(0, 8).map((l, i) => <Text key={i} fz={12.5} c="dimmed">{dayjs(l.at).format('ddd HH:mm')} · {l.place}{l.note ? ` · ${l.note}` : ''}</Text>)}
        </Box>
      )}

      <Group justify="flex-end">
        <Button radius="xl" variant="light" color="gray" leftSection={<IconCheck size={15} />} onClick={endTrip}>End trip</Button>
      </Group>
      <Badge variant="light" color="gray" size="sm">Places from OpenStreetMap · weather from Open-Meteo · routes from OSRM</Badge>
    </Stack>
  );
}
