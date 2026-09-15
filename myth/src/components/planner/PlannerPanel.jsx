// Myth Planner — one place to plan a trip, an event, an exam, a launch…
// Lives under the capture bar (Planner mode on the dial) and as a module.
// Type what you're planning; Myth picks the mode, fills the form, and every
// plan goes draft → planned → confirmed → live.
import { useMemo, useState } from 'react';
import { Stack, Group, Text, TextInput, ActionIcon, Badge, Box, Chip, Tooltip, ScrollArea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSend, IconPlus, IconTrash, IconCompass } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import { MODES } from '../../ai/planner';
import { startPlannerSession, conversePlanner } from '../../ai/plannerSession';
import { APP_NAME } from '../../config/env';
import TripPlanner from './TripPlanner';
import LiveTrip from './LiveTrip';
import GenericPlanner from './GenericPlanner';
import './planner.css';

const STATUS_COLOR = { draft: 'gray', planned: 'blue', confirmed: 'forest', live: 'red', done: 'gray' };
export const PLANNER_EXAMPLES = [
  'Trip from Chennai to Goa 20–24 Dec for 2, budget 30k, relaxed',
  "Plan my sister's wedding in December",
  'Prepare for the GATE exam in February',
  'Run a half marathon in March',
  'Vegetarian meal plan to lose weight, 1800 calories',
  'Save 1 lakh for an emergency fund by March',
  'Launch my portfolio website next month',
  'Plan my weekday morning routine',
];

// `embedded`: shown under the capture bar — the bar is the input, so the
// panel keeps its chat log but drops its own text field and the side rail.
export default function PlannerPanel({ embedded = false }) {
  const sessions = useStore((s) => s.plannerSessions ?? []);
  const remove = useStore((s) => s.deletePlannerSession);
  const activeId = useUI((s) => s.plannerFocusId);
  const setActiveId = useUI((s) => s.setPlannerFocus);
  const mobile = useMediaQuery('(max-width: 768px)');
  const [text, setText] = useState('');
  const [lobby, setLobby] = useState([]); // chat before any session exists

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);

  const submit = (raw) => {
    const t = (raw ?? text).trim();
    if (!t) return;
    setText('');
    if (active) {
      const { reset } = conversePlanner(active, t, useStore);
      if (reset) setActiveId(null);
      return;
    }
    const { session, reply } = startPlannerSession(t, useStore);
    if (session) setActiveId(session.id);
    else setLobby((l) => [...l, { id: Math.random().toString(36).slice(2), role: 'user', text: t }, { id: Math.random().toString(36).slice(2), role: 'ai', text: reply }]);
  };

  const chat = active ? active.chat ?? [] : lobby;
  const compact = embedded || mobile;

  const rail = (
    <Stack gap={4} style={{ width: 210, flexShrink: 0 }}>
      <Group justify="space-between" mb={2}>
        <Text fw={700} fz={12.5} tt="uppercase" lts={1} c="dimmed">Plans</Text>
        <Tooltip label="New plan"><ActionIcon size="sm" variant="light" color="forest" radius="xl" aria-label="New plan" onClick={() => setActiveId(null)}><IconPlus size={13} /></ActionIcon></Tooltip>
      </Group>
      {sessions.length === 0 && <Text fz={12} c="dimmed">Nothing planned yet.</Text>}
      {sessions.map((s) => (
        <Group key={s.id} className="pl-rail-item" data-active={s.id === activeId || undefined} px={8} py={6} gap={6} wrap="nowrap" onClick={() => setActiveId(s.id)}>
          <Box w={8} h={8} style={{ borderRadius: 4, background: MODES[s.mode]?.color ?? '#495057', flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text fz={12.5} fw={600} lineClamp={1}>{s.title || MODES[s.mode]?.label}</Text>
            <Text fz={10.5} c="dimmed">{MODES[s.mode]?.label} · {s.status}</Text>
          </div>
          <ActionIcon size="xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); remove(s.id); if (activeId === s.id) setActiveId(null); }}><IconTrash size={11} /></ActionIcon>
        </Group>
      ))}
    </Stack>
  );

  const strip = sessions.length > 0 && (
    <ScrollArea type="never">
      <Group gap={6} wrap="nowrap">
        {sessions.map((s) => (
          <Chip key={s.id} size="xs" checked={s.id === activeId} onClick={() => setActiveId(s.id === activeId ? null : s.id)} color="forest" styles={{ label: { paddingRight: 6 } }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: MODES[s.mode]?.color ?? '#495057' }} />
              {s.title || MODES[s.mode]?.label}
              <span style={{ opacity: 0.6 }}>· {s.status}</span>
              <IconTrash size={10} style={{ opacity: 0.6 }} onClick={(e) => { e.stopPropagation(); remove(s.id); if (activeId === s.id) setActiveId(null); }} />
            </span>
          </Chip>
        ))}
        <Chip size="xs" checked={false} onClick={() => setActiveId(null)}>+ New</Chip>
      </Group>
    </ScrollArea>
  );

  return (
    <Group align="flex-start" wrap="nowrap" gap="lg">
      {!compact && rail}
      <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
        {compact && strip}

        {active ? (
          <>
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={8} wrap="nowrap"><Text fw={800} fz={18} lineClamp={1}>{active.title || MODES[active.mode]?.label}</Text><Badge size="sm" variant="light" color={STATUS_COLOR[active.status]}>{active.status}</Badge></Group>
                <Text fz={12} c="dimmed">{MODES[active.mode]?.label} · started {dayjs(active.created).format('MMM D')}</Text>
              </div>
              <Badge variant="light" size="lg" style={{ background: `${MODES[active.mode]?.color}18`, color: MODES[active.mode]?.color, flexShrink: 0 }}>{MODES[active.mode]?.label}</Badge>
            </Group>
            {active.mode === 'trip' ? (active.status === 'live' ? <LiveTrip session={active} /> : <TripPlanner key={active.id} session={active} />) : <GenericPlanner key={active.id} session={active} />}
          </>
        ) : !embedded ? (
          <Box className="glass" p="lg" style={{ borderRadius: 18, textAlign: 'center' }}>
            <IconCompass size={34} color="#0D2D1C" />
            <Text fw={800} fz={18} mt={6}>What are we planning, Boss?</Text>
            <Text fz={13} c="dimmed" mt={4} maw={560} mx="auto">One sentence is enough. {APP_NAME} works out the mode — trip, event, exam, fitness, food, money, business, launch, writing, home, career, routine — and builds the plan: for trips, every route, the weather, areas and stays, must-sees and hidden gems, food, ways to get there and several itineraries; for everything else, dated milestones plus the playbook for that kind of plan (training weeks, meal plans, budget splits, savings schedules, syllabus timetables). Confirm to make it real, then go live for day-by-day guidance.</Text>
            <Group justify="center" gap={6} mt="md">
              {Object.entries(MODES).filter(([k]) => k !== 'generic').map(([k, m]) => <Badge key={k} variant="light" style={{ background: `${m.color}18`, color: m.color }}>{m.label}</Badge>)}
            </Group>
            <Group justify="center" gap={6} mt="md" px="md">
              {PLANNER_EXAMPLES.map((e) => <Chip key={e} size="xs" variant="light" checked={false} onClick={() => submit(e)}>{e}</Chip>)}
            </Group>
          </Box>
        ) : null}

        {/* ----- the chat ----- */}
        {(chat.length > 0 || !embedded) && (
          <Box className="pl-chat">
            {chat.length > 0 && (
              <Stack gap={6} mb={embedded ? 0 : 8} style={{ maxHeight: 180, overflowY: 'auto' }}>
                {chat.slice(-8).map((m) => <div key={m.id} className="pl-msg" data-role={m.role}>{m.text}</div>)}
              </Stack>
            )}
            {!embedded && (
              <Group gap={6} wrap="nowrap">
                <TextInput radius="xl" style={{ flex: 1 }} placeholder={active ? `Tell ${APP_NAME} what to change… ("budget 40k", "start trip")` : `Tell ${APP_NAME} what you're planning…`} value={text} onChange={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
                <ActionIcon size={38} radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} onClick={() => submit()}><IconSend size={17} /></ActionIcon>
              </Group>
            )}
          </Box>
        )}
      </Stack>
    </Group>
  );
}
