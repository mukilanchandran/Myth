// Myth Planner — one place to plan a trip, an event, an exam, a launch…
// Type what you're planning; the chat picks the mode, fills the form, and
// every mode goes draft → planned → confirmed → live.
import { useMemo, useState } from 'react';
import { Stack, Group, Text, TextInput, ActionIcon, Badge, Box, Chip, Tooltip, ScrollArea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSend, IconPlus, IconTrash, IconCompass } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { MODES, detectMode, parseTripInput, describeTripInput, modeReply, MODE_TEMPLATE } from '../../ai/planner';
import { detectProjectIntent, extractDeadline, titleCase, TEMPLATES } from '../../ai/projectPlanner';
import { APP_NAME } from '../../config/env';
import TripPlanner from './TripPlanner';
import LiveTrip from './LiveTrip';
import GenericPlanner from './GenericPlanner';
import './planner.css';

const STATUS_COLOR = { draft: 'gray', planned: 'blue', confirmed: 'forest', live: 'red', done: 'gray' };
const EXAMPLES = [
  'Trip from Chennai to Goa 20–24 Dec for 2, budget 30k, relaxed',
  "Plan my sister's wedding in December",
  'Prepare for the GATE exam in February',
  'Run a half marathon in March',
  'Launch my portfolio website next month',
];

export default function PlannerPanel() {
  const sessions = useStore((s) => s.plannerSessions ?? []);
  const addSession = useStore((s) => s.addPlannerSession);
  const update = useStore((s) => s.updatePlannerSession);
  const remove = useStore((s) => s.deletePlannerSession);
  const mobile = useMediaQuery('(max-width: 768px)');
  const [activeId, setActiveId] = useState(() => sessions[0]?.id ?? null);
  const [text, setText] = useState('');
  const [lobby, setLobby] = useState([]); // chat before any session exists

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);

  const say = (sessionId, role, msg) => {
    const entry = { id: Math.random().toString(36).slice(2), role, text: msg, ts: Date.now() };
    if (sessionId) update(sessionId, (s) => ({ chat: [...(s.chat ?? []), entry].slice(-40) }));
    else setLobby((l) => [...l, entry]);
  };

  // A new sentence → a new session in the detected mode, with the form pre-filled.
  const startFrom = (raw) => {
    const { mode } = detectMode(raw);
    if (!mode) { say(null, 'user', raw); say(null, 'ai', modeReply(null)); return; }
    let sess;
    if (mode === 'trip') {
      const input = parseTripInput(raw);
      const { summary, missing } = describeTripInput(input);
      sess = addSession({ mode, title: input.to ? `${input.from ? `${input.from} → ` : ''}${input.to}` : 'New trip', input, chat: [] });
      say(sess.id, 'user', raw);
      say(sess.id, 'ai', `Trip mode — ${summary}.${missing.length ? ` I still need the ${missing.join(' and ')}: fill it in above, then press Plan.` : ' Looks complete — press Plan and I\'ll build itineraries, weather, stays and fuel stops.'}`);
    } else {
      const intent = detectProjectIntent(raw) ?? null;
      const { deadline } = extractDeadline(raw);
      const tplKey = MODE_TEMPLATE[mode] ?? 'generic';
      const name = intent?.name ?? titleCase(raw.replace(/^(?:plan|help me plan|i want to|i need to|let'?s)\s+/i, '').replace(/[.!?]+$/, '').slice(0, 60));
      sess = addSession({ mode, title: name, input: { text: raw, name, deadline: intent?.deadline && !intent.deadlineGuessed ? intent.deadline : deadline ?? null }, chat: [] });
      say(sess.id, 'user', raw);
      say(sess.id, 'ai', `${modeReply(mode)} I've set it up as "${name}"${deadline ? ` for ${dayjs(deadline).format('MMM D')}` : ` with a ${TEMPLATES[tplKey].horizonWeeks}-week horizon`} — adjust the name or date, then press Plan.`);
    }
    setActiveId(sess.id);
  };

  // Inside a session the chat edits the plan.
  const converse = (raw) => {
    const s = active;
    say(s.id, 'user', raw);
    const t = raw.trim();
    if (/^(?:new|another|fresh)\s+(?:plan|trip|session)\b/i.test(t)) { setActiveId(null); say(null, 'ai', 'Fresh sheet. What are we planning?'); return; }
    if (s.mode === 'trip') {
      if (/\b(?:start|begin)\s+(?:the\s+)?trip\b|\bgo\s+live\b|\bi'?m\s+(?:leaving|off|starting)\b/i.test(t)) {
        if (s.status === 'confirmed' || s.status === 'planned') { update(s.id, { status: 'live', live: { startedAt: new Date().toISOString(), log: [], done: [] } }); say(s.id, 'ai', 'Live mode on. Share your location or type where you are and I\'ll keep an eye on weather, fuel, food and the plan.'); }
        else say(s.id, 'ai', 'Plan and confirm the trip first, then say "start trip".');
        return;
      }
      if (/\b(?:end|finish|stop)\s+(?:the\s+)?trip\b|\bi'?m\s+(?:home|back)\b/i.test(t)) { update(s.id, { status: 'done' }); say(s.id, 'ai', 'Trip closed. Settle the shared expenses and back up the photos — both are tasks in the project.'); return; }
      const pick = /\b(?:cheaper|budget)\b/i.test(t) ? 'budget' : /\brelax/i.test(t) ? 'relaxed' : /\b(?:adventure|explore|pack)/i.test(t) ? 'adventure' : /\b(?:classic|balanced|highlights)/i.test(t) ? 'balanced' : null;
      if (pick && s.result?.variants.some((v) => v.id === pick)) { update(s.id, { chosen: pick }); say(s.id, 'ai', `Switched to "${s.result.variants.find((v) => v.id === pick).name}".`); return; }
      const merged = parseTripInput(t);
      const patch = {};
      ['from', 'to', 'start', 'end', 'travellers', 'budget'].forEach((k) => { if (merged[k]) patch[k] = merged[k]; });
      if (/\b(?:relax|adventure|budget|luxury|foodie|family)/i.test(t)) patch.style = merged.style;
      if (/\b(?:car|bike|train|flight|fly|bus)\b/i.test(t)) patch.transport = merged.transport;
      if (Object.keys(patch).length) {
        const input = { ...s.input, ...patch };
        update(s.id, { input, title: input.to ? `${input.from ? `${input.from} → ` : ''}${input.to}` : s.title });
        say(s.id, 'ai', `Updated — ${describeTripInput(input).summary}. Press ${s.result ? 'Re-plan' : 'Plan'} to rebuild the days.`);
        return;
      }
      say(s.id, 'ai', s.status === 'live' ? 'While live: "I\'m at Tindivanam" sets your position; the tabs show fuel, food, stays and help nearby.' : 'I can change dates, people, budget or style from here ("make it 3 people", "budget 40k", "relaxed"), or say "start trip" once it\'s confirmed.');
      return;
    }
    if (/\b(?:go\s+live|start)\b/i.test(t) && s.status === 'confirmed') { update(s.id, { status: 'live', live: { startedAt: new Date().toISOString() } }); say(s.id, 'ai', 'Live — I\'ll show what the plan asks of you each day.'); return; }
    const { deadline } = extractDeadline(t);
    if (deadline) { update(s.id, { input: { ...s.input, deadline } }); say(s.id, 'ai', `Target date moved to ${dayjs(deadline).format('MMM D')}. Press Re-plan to reschedule.`); return; }
    say(s.id, 'ai', 'Change the name or date above and press Plan; confirm turns it into a project with dated tasks, and "go live" shows what\'s due each day.');
  };

  const submit = (raw) => {
    const t = (raw ?? text).trim();
    if (!t) return;
    setText('');
    if (active) converse(t); else startFrom(t);
  };

  const chat = active ? active.chat ?? [] : lobby;

  const rail = (
    <Stack gap={4} style={{ width: mobile ? '100%' : 210, flexShrink: 0 }}>
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

  return (
    <Group align="flex-start" wrap={mobile ? 'wrap' : 'nowrap'} gap="lg">
      {!mobile && rail}
      <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
        {mobile && sessions.length > 0 && (
          <ScrollArea type="never"><Group gap={6} wrap="nowrap">{sessions.map((s) => <Chip key={s.id} size="xs" checked={s.id === activeId} onClick={() => setActiveId(s.id)} color="forest">{s.title || MODES[s.mode]?.label}</Chip>)}<Chip size="xs" checked={false} onClick={() => setActiveId(null)}>+ New</Chip></Group></ScrollArea>
        )}

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
        ) : (
          <Box className="glass" p="lg" style={{ borderRadius: 18, textAlign: 'center' }}>
            <IconCompass size={34} color="#12a150" />
            <Text fw={800} fz={18} mt={6}>What are we planning, Boss?</Text>
            <Text fz={13} c="dimmed" mt={4} maw={520} mx="auto">One sentence is enough. {APP_NAME} works out the mode — trip, event, exam, fitness, launch, move — and builds the plan: itineraries with weather, stays and fuel for trips; dated milestones and tasks for everything else. Confirm to make it real, then go live for day-by-day guidance.</Text>
            <Group justify="center" gap={6} mt="md">
              {Object.entries(MODES).filter(([k]) => k !== 'generic').map(([k, m]) => <Badge key={k} variant="light" style={{ background: `${m.color}18`, color: m.color }}>{m.label}</Badge>)}
            </Group>
            <Group justify="center" gap={6} mt="md" px="md">
              {EXAMPLES.map((e) => <Chip key={e} size="xs" variant="light" checked={false} onClick={() => submit(e)}>{e}</Chip>)}
            </Group>
          </Box>
        )}

        {/* ----- the chat ----- */}
        <Box className="pl-chat">
          {chat.length > 0 && (
            <Stack gap={6} mb={8} style={{ maxHeight: 180, overflowY: 'auto' }}>
              {chat.slice(-8).map((m) => <div key={m.id} className="pl-msg" data-role={m.role}>{m.text}</div>)}
            </Stack>
          )}
          <Group gap={6} wrap="nowrap">
            <TextInput radius="xl" style={{ flex: 1 }} placeholder={active ? `Tell ${APP_NAME} what to change… ("budget 40k", "start trip")` : `Tell ${APP_NAME} what you're planning…`} value={text} onChange={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <ActionIcon size={38} radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }} onClick={() => submit()}><IconSend size={17} /></ActionIcon>
          </Group>
        </Box>
      </Stack>
    </Group>
  );
}
