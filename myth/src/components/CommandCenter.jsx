// Life Command Center — the home screen answers "what matters right now?"
// Three decisions instead of five information widgets: what needs attention
// (with a way to handle each item), what today looks like on the clock, and
// what Myth would do with the hours that are left — one tap to follow it.
import { useEffect, useMemo, useState } from 'react';
import { Box, Group, Text, Stack, Badge, Button, Modal, Progress, SimpleGrid, Checkbox } from '@mantine/core';
import {
  IconRobotFace, IconCheck, IconPlayerPlay, IconCalendarPlus,
  IconArrowRight, IconCircleCheck, IconTargetArrow, IconTrash,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { commandCenter, fmtDuration } from '../ai/commandCenter';
import { aiPlanMessage } from '../ai/assistant';
import { eventIcon } from '../icons';
import Spot from './illustrations/Spot';
import { APP_NAME } from '../config/env';
import './commandCenter.css';

// Live view of the store, re-evaluated every minute so "starts in 25 min"
// and the now-marker keep moving even when nothing is edited.
export function useCommandCenter() {
  const state = useStore();
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 60 * 1000);
    const onVisible = () => { if (!document.hidden) setNow(dayjs()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return useMemo(() => commandCenter(state, now), [state, now]);
}

const cardAnim = (i) => ({
  initial: { opacity: 0, y: 22 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.15 + i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
});

const KIND_COLORS = {
  overdue: '#e03131', today: '#f08c00', blocked: '#e03131', now: '#e03131',
  soon: '#7048e8', bill: '#e8590c', deadline: '#e03131', habits: '#0ca678',
  prep: '#7048e8', followup: '#1971c2',
};

// ---------- hero: greeting + day progress ----------
export function CommandHero({ mobile, children }) {
  const { greeting, progress, plan, active } = useCommandCenter();
  const focusLeft = active && active.remaining > 0
    ? `${active.remaining} focus block${active.remaining === 1 ? '' : 's'} ahead`
    : `${fmtDuration(plan.focusMinutes)} of focus time left`;
  const sub = progress.total
    ? `${progress.done} of ${progress.total} commitments done · ${focusLeft}`
    : `Nothing committed yet — capture something below · ${focusLeft}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      style={{ textAlign: 'center', padding: '0 16px', marginBlock: mobile ? 0 : 'auto' }}
    >
      <Text className="hero-sub" tt="uppercase" lts={2.5} fz={{ base: 11.5, sm: 12.5 }} fw={700}>
        {greeting}, Boss
      </Text>
      <Text className="hero-title" fz={{ base: 26, sm: 36 }} fw={800} lh={1.12} mt={2}>
        Your day is {progress.pct}% complete
      </Text>
      <Progress
        value={progress.pct} size={6} radius="xl" color="forest" maw={260} mx="auto" mt={10}
        transitionDuration={600}
        styles={{ root: { background: 'rgba(255,255,255,0.28)' } }}
      />
      <Text className="hero-sub" fz={{ base: 12.5, sm: 14 }} fw={600} mt={8}>{sub}</Text>
      {children}
    </motion.div>
  );
}

// ---------- shared card frame ----------
// Tinted glass with a soft colour wash in the corner, an icon tile and a
// label + subtitle — no borders or strokes; the accent lives in the tile,
// the wash and the action pill.
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };

function Card({ i, label, sub, icon, color, pulse, children, footer }) {
  return (
    <motion.div {...cardAnim(i)} style={{ height: '100%' }}>
      <Box className="cc-card" p="md" h="100%" style={{ '--cc-accent': color, '--cc-wash': rgba(color, 0.24), '--cc-tile': rgba(color, 0.14) }}>
        <Group gap={10} mb={12} wrap="nowrap">
          <div className={`cc-tile${pulse ? ' pulse-red' : ''}`}>{icon}</div>
          <div style={{ minWidth: 0 }}>
            <Text className="cc-label">{label}</Text>
            {sub && <Text className="cc-sub" lineClamp={1}>{sub}</Text>}
          </div>
        </Group>
        <Box style={{ flex: 1, minHeight: 0 }}>{children}</Box>
        {footer && <Box mt={12}>{footer}</Box>}
      </Box>
    </motion.div>
  );
}

// ---------- soft cards (the left column) ----------
// A gradient wash, a title, one sentence that tells the story, a small
// illustration in the corner — then the details and one action.
function SoftCard({ i, title, desc, tone, art, children, footer }) {
  return (
    <motion.div {...cardAnim(i)}>
      <div className="cc-soft" style={{ '--soft-a': tone[0], '--soft-b': tone[1] }}>
        {art && <div className="cc-soft-art">{art}</div>}
        <div className="cc-soft-title">{title}</div>
        {desc && <div className="cc-soft-desc">{desc}</div>}
        {children && <div className="cc-soft-body">{children}</div>}
        {footer && <div className="cc-soft-foot">{footer}</div>}
      </div>
    </motion.div>
  );
}

// ---------- NEEDS ATTENTION ----------
export function AttentionCard({ items, onHandle, i }) {
  const top = items.slice(0, 3);
  const more = items.length - top.length;
  const urgent = items.some((x) => x.severity === 3);
  const tone = items.length ? ['#fdece6', '#f6d4cc'] : ['#e6f5ec', '#d0ebdb'];
  const desc = items.length === 0
    ? 'Nothing is on fire. Clear runway — a good moment to pull something from the backlog.'
    : `${items.length} thing${items.length === 1 ? '' : 's'} to decide${urgent ? ', one of them urgent' : ''}. Handle each now — done, start, or move it.`;
  return (
    <SoftCard
      i={i} title="Needs attention" desc={desc} tone={tone}
      art={<Spot kind={items.length ? 'generic' : 'tasks'} color={items.length ? '#e03131' : '#0D2D1C'} size={70} />}
      footer={items.length > 0 && (
        <Button fullWidth radius="xl" color="dark" variant="filled" rightSection={<IconArrowRight size={15} />} onClick={onHandle}>
          Handle these{items.length > 1 ? ` (${items.length})` : ''}
        </Button>
      )}
    >
      {items.length > 0 && (
        <Stack gap={6}>
          {top.map((it) => (
            <Group key={it.id} className="cc-item" gap={8} wrap="nowrap" align="flex-start">
              <Box w={8} h={8} mt={6} style={{ borderRadius: 4, background: KIND_COLORS[it.kind] ?? '#868e96', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <Text fz={13} fw={600} lineClamp={1}>{it.title}</Text>
                <Text fz={11.5} c={it.severity === 3 ? 'red' : 'dimmed'} lineClamp={1}>{it.sub}</Text>
              </div>
            </Group>
          ))}
          {more > 0 && <Text fz={12} c="dimmed" pl={4}>+{more} more</Text>}
        </Stack>
      )}
    </SoftCard>
  );
}

// ---------- TODAY ----------
function TimelineRow({ item }) {
  const meta = eventIcon(item.kind);
  const Icon = meta.icon;
  const past = item.status === 'past' || item.taskDone;
  return (
    <Group gap={6} wrap="nowrap" py={5} className="cc-row" style={{ opacity: past ? 0.5 : 1 }}>
      <Text fz={12.5} fw={700} w={44} ta="right" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {item.time ?? ''}
      </Text>
      <Icon size={14} color={meta.color} style={{ flexShrink: 0 }} />
      <Text
        fz={13.5} fw={item.status === 'now' ? 700 : 500} lineClamp={1}
        td={item.taskDone ? 'line-through' : undefined} style={{ flex: 1, minWidth: 0 }}
      >
        {item.kind === 'focus' ? `Focus — ${item.title}` : item.title}
      </Text>
      {item.status === 'now' && <Badge size="xs" color="forest" variant="filled">now</Badge>}
      {item.status === 'next' && <Badge size="xs" color="blue" variant="light">next</Badge>}
      {item.status === 'allday' && <Badge size="xs" color="gray" variant="light">all day</Badge>}
    </Group>
  );
}

export function TodayCard({ items, now, onOpen, i }) {
  const n = now.hour() * 60 + now.minute();
  // the now-rule sits before the first item that hasn't started yet
  const rows = [];
  let marked = false;
  items.forEach((it) => {
    if (!marked && it.start != null && it.start > n) { rows.push({ marker: true }); marked = true; }
    rows.push(it);
  });
  if (!marked && items.some((it) => it.start != null)) rows.push({ marker: true });

  const live = items.find((it) => it.status === 'now') ?? items.find((it) => it.status === 'next');
  const desc = items.length
    ? `${items.length} on the clock${live ? ` · ${live.status === 'now' ? 'now' : 'next'}: ${live.title}${live.time ? ` at ${live.time}` : ''}` : ''}.`
    : 'Nothing on the clock yet. Add a meeting or an event and it shows up here.';

  return (
    <SoftCard
      i={i} title={now.format('dddd, MMM D')} desc={desc} tone={['#e9e6fb', '#d5dbf5']}
      art={<Spot kind="calendar" color="#5f3dc4" size={70} />}
      footer={(
        <Button fullWidth radius="xl" variant="white" color="dark" leftSection={<IconCalendarPlus size={15} />} onClick={() => onOpen('calendar')}>
          Open calendar
        </Button>
      )}
    >
      {items.length > 0 && (
        <Stack gap={0} className="cc-timeline">
          {rows.map((r, idx) => (r.marker ? (
            <Group key={`now-${idx}`} gap={6} wrap="nowrap" className="cc-now">
              <Text fz={10.5} fw={800} w={44} ta="right" c="#0D2D1C" style={{ fontVariantNumeric: 'tabular-nums' }}>{now.format('HH:mm')}</Text>
              <div className="cc-now-rule" />
            </Group>
          ) : (
            <TimelineRow key={r.id} item={r} />
          )))}
        </Stack>
      )}
    </SoftCard>
  );
}

// ---------- MYTH SAYS ----------
// The model may rephrase the line in its own voice; the facts stay rule-based.
// Cached per plan shape (kind + task ids) so it isn't re-asked every minute.
const aiLines = new Map();

// The line Myth says for a plan: the rule-based message, upgraded by the
// model's phrasing when one answers. Shared by the card and the hero.
export function useMythSays(plan, showActive) {
  const planKey = `${plan.kind}:${plan.blocks.map((b) => b.taskId).join(',')}`;
  const [, bump] = useState(0);
  useEffect(() => {
    if (showActive || !plan.blocks.length || aiLines.has(planKey)) return undefined;
    let alive = true;
    aiLines.set(planKey, null); // in flight — don't ask twice
    aiPlanMessage(plan, useStore.getState()).then((line) => {
      if (!alive) return;
      if (line) { aiLines.set(planKey, line); bump((x) => x + 1); } else aiLines.delete(planKey);
    });
    return () => { alive = false; };
  }, [planKey, plan, showActive]);
  return (!showActive && aiLines.get(planKey)) || plan.message;
}

function MythCard({ plan, active, onOpen, i }) {
  const applyPlan = useStore((s) => s.applyPlan);
  const clearFocusBlocks = useStore((s) => s.clearFocusBlocks);
  const completeTask = useStore((s) => s.completeTask);
  const showActive = !!active && active.remaining > 0;
  const message = useMythSays(plan, showActive);

  const follow = () => {
    applyPlan(plan.blocks);
    notifications.show({
      title: 'Plan set',
      message: `${plan.blocks.length} focus block${plan.blocks.length === 1 ? '' : 's'} added to today — first one starts ${plan.blocks[0].start}.`,
      color: 'forest',
    });
  };

  let footer = null;
  if (showActive) {
    footer = (
      <Group gap={8} grow>
        {active.current && !active.current.taskDone && (
          <Button radius="xl" color="forest" leftSection={<IconCheck size={15} />} onClick={() => completeTask(active.current.taskId)}>
            Done with this block
          </Button>
        )}
        <Button radius="xl" variant="subtle" color="gray" leftSection={<IconTrash size={14} />} onClick={() => clearFocusBlocks()}>
          Clear plan
        </Button>
      </Group>
    );
  } else if (plan.blocks.length) {
    footer = (
      <Button fullWidth radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} leftSection={<IconTargetArrow size={16} />} onClick={follow}>
        Follow {APP_NAME}&apos;s plan
      </Button>
    );
  } else if (plan.kind === 'winddown') {
    footer = <Button fullWidth radius="xl" variant="filled" color="forest" onClick={() => onOpen('habits')}>Close the day</Button>;
  } else {
    footer = <Button fullWidth radius="xl" variant="filled" color="forest" onClick={() => onOpen('tasks')}>Browse the backlog</Button>;
  }

  return (
    <Card
      i={i} label={`${APP_NAME} says`} color="#0D2D1C" icon={<IconRobotFace size={18} />} footer={footer}
      sub={showActive ? `plan in motion · ${active.done}/${active.total} done` : plan.blocks.length ? `a plan for the next ${fmtDuration(plan.focusMinutes)}` : plan.kind === 'winddown' ? 'the day is winding down' : `${fmtDuration(plan.focusMinutes)} of open time`}
    >
      {showActive ? (
        <Stack gap={8}>
          <Text className="cc-quote">
            {active.current
              ? `Now: ${active.current.title} until ${active.current.end}.${active.next ? ` Then ${active.next.title} at ${active.next.time}.` : ' Last block of the day.'}`
              : active.next
                ? `Next up: ${active.next.title} at ${active.next.time}. Until then, clear the small stuff.`
                : 'Every block is behind you. Tick off what got finished.'}
          </Text>
          <Stack gap={3}>
            {active.blocks.map((b) => {
              const done = b.task?.status === 'done';
              const missed = !done && b.endMin <= (dayjs().hour() * 60 + dayjs().minute());
              return (
                <Group key={b.id} gap={8} wrap="nowrap">
                  <Text fz={12} fw={700} c="dimmed" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{b.time}–{b.end}</Text>
                  <Text fz={12.5} lineClamp={1} td={done ? 'line-through' : undefined} c={done || missed ? 'dimmed' : undefined} style={{ flex: 1 }}>
                    {b.title}
                  </Text>
                  {done && <IconCheck size={13} color="#0D2D1C" />}
                  {missed && <Badge size="xs" color="gray" variant="light">missed</Badge>}
                </Group>
              );
            })}
          </Stack>
        </Stack>
      ) : (
        <Stack gap={10}>
          <Text className="cc-quote">{message}</Text>
          {plan.blocks.length > 0 && (
            <Stack gap={3}>
              {plan.blocks.map((b) => (
                <Group key={b.taskId} gap={8} wrap="nowrap">
                  <Text fz={12} fw={700} c="dimmed" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{b.start}–{b.end}</Text>
                  <Text fz={12.5} lineClamp={1} style={{ flex: 1 }}>{b.title}</Text>
                  <Badge size="xs" variant="light" color={b.why === 'overdue' ? 'red' : b.why === 'due today' ? 'orange' : 'gray'}>{b.why}</Badge>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Card>
  );
}

// ---------- "Handle these" ----------
export function TriageModal({ opened, onClose, items, onOpen }) {
  const { completeTask, updateTask, toggleHabit, deleteEvent, habits } = useStore();
  const todayKey = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const nextWeek = dayjs().add(7, 'day').format('YYYY-MM-DD');
  const go = (panel) => { onClose(); onOpen(panel); };
  const move = (it, due) => {
    const patch = { due };
    if (it.kind === 'blocked') patch.status = 'todo';
    updateTask(it.ref.id, patch);
  };

  return (
    <Modal
      opened={opened} onClose={onClose} radius="xl" size="md" centered
      title={(
        <div>
          <Text fw={800} fz={18}>Handle what needs attention</Text>
          <Text fz={12.5} c="dimmed" mt={2}>Decide each one now — done, start, or move it.</Text>
        </div>
      )}
    >
      {items.length === 0 ? (
        <Stack align="center" py="lg" gap={6}>
          <IconCircleCheck size={34} color="#0D2D1C" />
          <Text fw={700}>All handled</Text>
          <Text fz={13} c="dimmed">Nothing needs your attention right now.</Text>
          <Button mt="sm" radius="xl" color="forest" onClick={onClose}>Back to the day</Button>
        </Stack>
      ) : (
        <Stack gap="sm">
          {items.map((it) => (
            <Box key={it.id} className="glass" p="sm" style={{ borderRadius: 14 }}>
              <div style={{ minWidth: 0 }}>
                <Text fz={14} fw={600}>{it.title}</Text>
                <Text fz={12} c={it.severity === 3 ? 'red' : 'dimmed'}>{it.sub}</Text>
              </div>
              <Group gap={6} mt={8} wrap="wrap">
                {it.ref.type === 'task' && (
                  <>
                    <Button size="xs" radius="xl" color="forest" leftSection={<IconCheck size={13} />} onClick={() => completeTask(it.ref.id)}>Done</Button>
                    {it.status !== 'doing' && (
                      <Button size="xs" radius="xl" variant="light" color="blue" leftSection={<IconPlayerPlay size={13} />} onClick={() => updateTask(it.ref.id, { status: 'doing' })}>Start now</Button>
                    )}
                    <Button size="xs" radius="xl" variant="light" color="gray" onClick={() => move(it, tomorrow)}>Tomorrow</Button>
                    <Button size="xs" radius="xl" variant="light" color="gray" onClick={() => move(it, nextWeek)}>Next week</Button>
                  </>
                )}
                {it.ref.type === 'habits' && it.ref.ids.map((id) => {
                  const h = habits.find((x) => x.id === id);
                  return h && (
                    <Checkbox key={id} size="sm" radius="xl" color="forest" label={h.name} checked={!!h.log[todayKey]} onChange={() => toggleHabit(id)} />
                  );
                })}
                {it.ref.type === 'bill' && (
                  <>
                    <Button size="xs" radius="xl" color="forest" leftSection={<IconCheck size={13} />} onClick={() => deleteEvent(it.ref.id)}>Paid</Button>
                    <Button size="xs" radius="xl" variant="light" color="gray" onClick={() => go('finance')}>Log the expense</Button>
                  </>
                )}
                {it.ref.type === 'event' && (
                  <Button size="xs" radius="xl" variant="light" color="violet" onClick={() => go(it.ref.source === 'note' ? 'notes' : 'calendar')}>Open</Button>
                )}
                {it.ref.type === 'project' && (
                  <Button size="xs" radius="xl" variant="light" color="orange" onClick={() => go('projects')}>Open project</Button>
                )}
              </Group>
            </Box>
          ))}
        </Stack>
      )}
    </Modal>
  );
}

// ---------- the three cards ----------
export default function CommandCenter({ onOpen }) {
  const cc = useCommandCenter();
  const [triage, setTriage] = useState(false);
  return (
    <>
      <SimpleGrid
        type="container"
        cols={{ base: 1, '720px': 3 }}
        spacing="md" w="100%" maw={1400} mx="auto" px={{ base: 12, sm: 24 }}
      >
        <AttentionCard i={0} items={cc.attention} onHandle={() => setTriage(true)} />
        <TodayCard i={1} items={cc.timeline} now={cc.now} onOpen={onOpen} />
        <MythCard i={2} plan={cc.plan} active={cc.active} onOpen={onOpen} />
      </SimpleGrid>
      <TriageModal opened={triage} onClose={() => setTriage(false)} items={cc.attention} onOpen={onOpen} />
    </>
  );
}
