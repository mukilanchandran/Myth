// MITH NOW — "What should I do now?"
//
// One big button on the home screen. It opens a sheet that answers with the
// minutes left before the next thing on the clock, the single best task for
// that window and the quick wins that fill what remains. "Start now" turns the
// pick into a timed sprint (a focus block on today's calendar + a countdown);
// Done / Skip feed the learning layer so the next answer is more Boss-shaped.
// The rule-based engine (ai/mithNow.js) answers instantly; the model then gets
// a second look and may swap the pick or add a one-line rationale.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Group, Modal, Stack, Text, Badge, Progress, Loader, Tooltip, ActionIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { motion, AnimatePresence } from 'framer-motion';
import dayjs from 'dayjs';
import {
  IconBolt, IconPlayerPlay, IconCheck, IconPlayerStop, IconArrowForward, IconSparkles,
  IconClockHour4, IconArrowsShuffle, IconCircleCheck, IconMoonStars, IconRefresh, IconCalendarEvent,
} from '@tabler/icons-react';
import { useStore } from '../store/useStore';
import { mithNow, currentWindow } from '../ai/mithNow';
import { aiMithNow } from '../ai/assistant';
import { fmtDuration } from '../ai/commandCenter';
import { APP_NAME } from '../config/env';
import './mithNow.css';

const BRAND = 'MITH NOW';
const tickEvery = (ms, setter) => {
  const id = setInterval(() => setter(dayjs()), ms);
  return () => clearInterval(id);
};

// -------------------------------------------------------------------------
// the button
// -------------------------------------------------------------------------
export function MithNowButton({ onClick, mobile }) {
  const state = useStore();
  const session = useStore((s) => s.nowSession);
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => tickEvery(session ? 1000 : 30 * 1000, setNow), [session]);

  const hint = useMemo(() => {
    if (session) {
      const left = Math.max(0, dayjs(session.startedAt).add(session.minutes, 'minute').diff(now, 'second'));
      return `Sprint running · ${clock(left)} left on "${session.title}"`;
    }
    const w = currentWindow(state, now);
    if (w.kind === 'night') return 'The day is done — see you tomorrow';
    if (w.inside) return `In "${w.inside.title}" until ${w.inside.endsAt}`;
    if (w.next) return `${fmtDuration(w.minutes)} before ${w.next.title}`;
    return `${fmtDuration(w.minutes)} of open time today`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, now, state.events]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.25, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: mobile ? '6px 12px 0' : '14px 16px 0' }}
    >
      <button type="button" className={`mith-now-btn${session ? ' is-live' : ''}`} onClick={onClick} aria-label="What should I do now?">
        <span className="mith-now-icon">{session ? <IconClockHour4 size={22} stroke={2.2} /> : <IconBolt size={22} stroke={2.2} />}</span>
        <span className="mith-now-label">{session ? 'Sprint in progress' : 'What should I do now?'}</span>
        <span className="mith-now-arrow"><IconArrowForward size={18} stroke={2.2} /></span>
      </button>
      <Text className="hero-sub" fz={{ base: 12, sm: 13 }} fw={600} ta="center" style={{ opacity: 0.92 }}>{hint}</Text>
    </motion.div>
  );
}

const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

// -------------------------------------------------------------------------
// the sheet
// -------------------------------------------------------------------------
const aiCache = new Map(); // signature -> { pick, note, model } | null (in flight)

export default function MithNowSheet({ opened, onClose, onOpen }) {
  const state = useStore();
  const { nowStart, nowSkip, nowFinish, clearNowSession, completeTask, togglePlanItem, toggleHabit } = state;
  const session = state.nowSession;
  const mobile = useMediaQuery('(max-width: 768px)');

  const [now, setNow] = useState(() => dayjs());
  const [exclude, setExclude] = useState(() => new Set());
  const [prefer, setPrefer] = useState(null);
  const [ai, setAi] = useState(null);         // { pick, note, model }
  const [aiBusy, setAiBusy] = useState(false);
  const askedFor = useRef(null);

  // the clock keeps moving while the sheet is open (every second during a sprint)
  useEffect(() => {
    if (!opened) return undefined;
    setNow(dayjs());
    return tickEvery(session ? 1000 : 15 * 1000, setNow);
  }, [opened, session]);

  // a sprint left over from another day is meaningless — drop it quietly
  useEffect(() => {
    if (session && !dayjs(session.startedAt).isSame(dayjs(), 'day')) clearNowSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // fresh sitting every time the sheet opens
  useEffect(() => {
    if (opened) { setExclude(new Set()); setPrefer(null); }
  }, [opened]);

  const base = useMemo(() => mithNow(state, now, { exclude }), [state, now, exclude]);
  const result = useMemo(
    () => (prefer && prefer !== base.primary?.id ? mithNow(state, now, { exclude, prefer }) : base),
    [state, now, exclude, prefer, base],
  );

  // second opinion from the model, once per shape of the answer
  useEffect(() => {
    if (!opened || session || !base.primary) { return undefined; }
    const sig = base.signature;
    if (askedFor.current === sig) return undefined;
    askedFor.current = sig;
    if (aiCache.has(sig)) { const c = aiCache.get(sig); if (c) { setAi(c); if (c.pick && c.pick !== base.primary.id) setPrefer(c.pick); } return undefined; }
    let alive = true;
    aiCache.set(sig, null);
    setAiBusy(true);
    aiMithNow(base, useStore.getState()).then((res) => {
      if (!alive) return;
      setAiBusy(false);
      if (!res) { aiCache.delete(sig); return; }
      aiCache.set(sig, res);
      setAi(res);
      if (res.pick && res.pick !== base.primary?.id) setPrefer(res.pick);
    });
    return () => { alive = false; };
  }, [opened, session, base]);

  const w = result.window;
  const primary = result.primary;

  // ----- actions -----
  const start = () => {
    if (!primary) return;
    const sess = nowStart(primary);
    if (sess) {
      notifications.show({ color: 'forest', title: 'Sprint started', message: `"${primary.title}" until ${sess.until}. ${APP_NAME} is timing it.` });
    }
  };
  const skip = () => {
    if (!primary) return;
    nowSkip(primary.id);
    setExclude((s) => new Set([...s, primary.id]));
    setPrefer(null);
    setAi(null);
    askedFor.current = null;
  };
  const doneAlready = () => {
    if (!primary) return;
    completeTask(primary.id);
    setPrefer(null);
    notifications.show({ color: 'forest', title: 'Done', message: `"${primary.title}" marked complete.` });
  };
  const tickQuick = (q) => {
    if (q.kind === 'task') completeTask(q.id);
    else if (q.kind === 'plan') togglePlanItem(q.id);
    else if (q.kind === 'habit') toggleHabit(q.id);
    notifications.show({ color: 'forest', title: 'Quick win', message: q.title });
  };
  const finish = () => {
    const spent = session ? Math.max(1, dayjs().diff(dayjs(session.startedAt), 'minute')) : 0;
    const title = session?.title;
    nowFinish();
    notifications.show({ color: 'forest', title: 'Nice work, Boss', message: `"${title}" done in ${fmtDuration(spent)}. ${APP_NAME} noted how long it really took.` });
  };
  const stop = () => { clearNowSession(); };

  // ----- sprint countdown -----
  const sprint = useMemo(() => {
    if (!session) return null;
    const endAt = dayjs(session.startedAt).add(session.minutes, 'minute');
    const total = session.minutes * 60;
    const left = endAt.diff(now, 'second');
    const elapsed = Math.min(total, Math.max(0, total - left));
    return { endAt, left, over: left <= 0, pct: total ? Math.round((elapsed / total) * 100) : 0 };
  }, [session, now]);

  return (
    <Modal
      opened={opened} onClose={onClose}
      radius={mobile ? 0 : 'xl'} size={620} centered={!mobile} fullScreen={mobile}
      overlayProps={{ backgroundOpacity: 0.45, blur: 6 }}
      styles={{ content: { maxHeight: mobile ? '100dvh' : '92vh' }, body: { overflowY: 'auto', paddingTop: 0 } }}
      title={(
        <Group gap={10} wrap="nowrap">
          <Box className="mith-now-badge"><IconBolt size={16} stroke={2.4} /></Box>
          <div>
            <Text fw={900} fz={13} lts={2.4} tt="uppercase" c="#1b5a38">{BRAND}</Text>
            <Text fz={12} c="dimmed" mt={1}>Real-time decision support · {now.format('h:mm A')}</Text>
          </div>
        </Group>
      )}
    >
      <AnimatePresence mode="wait">
        {session && sprint ? (
          <motion.div key="sprint" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <SprintView session={session} sprint={sprint} window={w} onDone={finish} onStop={stop} />
          </motion.div>
        ) : (
          <motion.div key="advice" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <AdviceView
              result={result} ai={ai} aiBusy={aiBusy} prefer={prefer}
              onStart={start} onSkip={skip} onDone={doneAlready} onQuick={tickQuick}
              onPrefer={(id) => setPrefer(id)} onOpen={(p) => { onClose(); onOpen?.(p); }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

// -------------------------------------------------------------------------
// advice: "You have 47 minutes before your next meeting."
// -------------------------------------------------------------------------
function AdviceView({ result, ai, aiBusy, prefer, onStart, onSkip, onDone, onQuick, onPrefer, onOpen }) {
  const { window: w, primary, quick, remaining, alternatives, mood, learn } = result;
  const nextLine = w.next
    ? `${w.next.kind === 'meeting' ? 'Meeting' : 'Next'}: ${w.next.title} at ${w.next.at}`
    : w.kind === 'night' ? null : 'Nothing else on the clock today';

  return (
    <Stack gap="md" pt={4}>
      {/* the window */}
      <Box className="mith-quote-block">
        <Text className="mith-headline">{result.headline}</Text>
        {nextLine && (
          <Group gap={6} mt={6}>
            <IconCalendarEvent size={14} color="#7048e8" />
            <Text fz={12.5} c="dimmed">{nextLine}</Text>
          </Group>
        )}
      </Box>

      {mood === 'night' && (
        <EmptyCard icon={<IconMoonStars size={26} color="#5f3dc4" />} title="Wind down" text="Tick off what got finished and let tomorrow's plan wait until morning."
          action={<Button radius="xl" variant="light" color="grape" onClick={() => onOpen('habits')}>Close the day</Button>} />
      )}
      {mood === 'clear' && (
        <EmptyCard icon={<IconCircleCheck size={26} color="#0D2D1C" />} title="Your plate is clear" text={`${fmtDuration(w.minutes)} of open time and nothing waiting. Pull something from the backlog or capture tomorrow.`}
          action={<Button radius="xl" variant="light" color="forest" onClick={() => onOpen('tasks')}>Browse the backlog</Button>} />
      )}
      {mood === 'tight' && (
        <EmptyCard icon={<IconClockHour4 size={26} color="#f08c00" />} title="Not enough room to start anything" text="Take a breath, refill the water, glance at the prep for what's next." />
      )}

      {(primary || quick.length > 0) && (
        <>
          <Text fz={12} fw={800} tt="uppercase" lts={1.5} c="#1b5a38">{APP_NAME} recommends</Text>

          {primary && (
            <Box className="mith-card mith-card-primary">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fz={11.5} fw={800} tt="uppercase" lts={1.2} c="dimmed">Best use of this time</Text>
                  <Text fz={20} fw={800} lh={1.2} mt={4}>{primary.title}</Text>
                  <Group gap={6} mt={6} wrap="wrap">
                    {primary.partial && <Badge size="sm" variant="filled" color="orange" radius="xl" style={{ textTransform: 'none' }}>make a dent · {primary.minutes} of ~{primary.estimate} min</Badge>}
                    {primary.project && <Badge size="sm" variant="light" color="blue" radius="xl" style={{ textTransform: 'none' }}>{primary.project}</Badge>}
                    <Badge size="sm" variant="light" color={whyColor(primary.why)} radius="xl" style={{ textTransform: 'none' }}>{primary.why}</Badge>
                    {primary.status === 'doing' && <Badge size="sm" variant="light" color="teal" radius="xl" style={{ textTransform: 'none' }}>in progress</Badge>}
                  </Group>
                </div>
                <Box ta="right" style={{ flexShrink: 0 }}>
                  <Text fz={11} c="dimmed" fw={700} tt="uppercase" lts={0.8}>Estimated</Text>
                  <Text fz={26} fw={900} lh={1} c="#1b5a38" style={{ fontVariantNumeric: 'tabular-nums' }}>{primary.minutes}<Text span fz={13} fw={700} ml={3}>min</Text></Text>
                  {primary.partial && <Text fz={11} c="dimmed" mt={2}>of ~{primary.estimate} total</Text>}
                </Box>
              </Group>

              {primary.reasons.length > 1 && (
                <Text fz={12.5} c="dimmed" mt={8}>Why: {primary.reasons.slice(0, 3).join(' · ')}</Text>
              )}

              <Group gap={8} mt={12} wrap="wrap">
                <Button radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} leftSection={<IconPlayerPlay size={15} />} onClick={onStart}>
                  Start now · {primary.minutes} min
                </Button>
                <Button radius="xl" variant="light" color="forest" leftSection={<IconCheck size={15} />} onClick={onDone}>Already done</Button>
                <Button radius="xl" variant="subtle" color="gray" leftSection={<IconArrowsShuffle size={15} />} onClick={onSkip}>Not this one</Button>
              </Group>
            </Box>
          )}

          {/* then: quick wins */}
          {(quick.length > 0 || (primary && remaining >= 5)) && (
            <Box className="mith-card">
              <Text fz={11.5} fw={800} tt="uppercase" lts={1.2} c="dimmed">Then</Text>
              <Text fz={15} fw={700} mt={3}>
                {primary
                  ? `${remaining >= 60 ? fmtDuration(remaining) : `${remaining} minute${remaining === 1 ? '' : 's'}`} remaining${quick.length ? '.' : ' — enough to breathe before the next thing.'}`
                  : `${fmtDuration(w.minutes)} — enough for quick wins.`}
              </Text>
              {quick.length > 0 && (
                <Stack gap={6} mt={8}>
                  {quick.map((q) => (
                    <Group key={`${q.kind}:${q.id}`} gap={10} wrap="nowrap" className="mith-quick">
                      <Tooltip label="Done — tick it off">
                        <ActionIcon size={28} radius="xl" variant="light" color="forest" onClick={() => onQuick(q)}>
                          <IconCheck size={15} />
                        </ActionIcon>
                      </Tooltip>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Text fz={13.5} fw={600} lineClamp={1}>
                          <Text span fz={11} fw={800} c="#1b5a38" tt="uppercase" lts={0.8} mr={6}>Quick win</Text>
                          {q.title}
                        </Text>
                        {q.sub && <Text fz={11.5} c="dimmed" lineClamp={1}>{q.sub}</Text>}
                      </div>
                      <Badge size="sm" variant="light" color="gray" radius="xl" style={{ flexShrink: 0, textTransform: 'none' }}>{q.minutes} min</Badge>
                    </Group>
                  ))}
                </Stack>
              )}
            </Box>
          )}
        </>
      )}

      {/* the model's second opinion */}
      {primary && (
        <Group gap={8} wrap="nowrap" align="flex-start" className="mith-ai">
          <IconSparkles size={16} color="#7048e8" style={{ flexShrink: 0, marginTop: 2 }} />
          {aiBusy && !ai ? (
            <Group gap={6}><Loader size="xs" color="grape" type="dots" /><Text fz={12.5} c="dimmed">{APP_NAME} is double-checking the pick…</Text></Group>
          ) : ai?.note ? (
            <div>
              <Text fz={13} lh={1.5} style={{ fontStyle: 'italic' }}>{ai.note}</Text>
              <Text fz={11} c="dimmed" mt={2}>{ai.pick && ai.pick === prefer ? 'the model swapped the pick · ' : ''}{ai.model}</Text>
            </div>
          ) : (
            <Text fz={12.5} c="dimmed">
              Rule-based pick{learn.signals ? ` · trained on ${learn.signals} of your choices` : ' · learns from what you start, skip and finish'}.
            </Text>
          )}
        </Group>
      )}

      {/* swap in something else */}
      {alternatives.length > 0 && primary && (
        <Box>
          <Text fz={11.5} fw={800} tt="uppercase" lts={1.2} c="dimmed" mb={6}>Or instead</Text>
          <Group gap={6} wrap="wrap">
            {alternatives.map((a) => (
              <Button key={a.id} size="xs" radius="xl" variant="default" onClick={() => onPrefer(a.id)}
                rightSection={<Text span fz={11} c="dimmed">{a.minutes}m</Text>}
                styles={{ root: { opacity: a.fits ? 1 : 0.7 } }}>
                {a.title.length > 34 ? `${a.title.slice(0, 33)}…` : a.title}
              </Button>
            ))}
          </Group>
        </Box>
      )}
    </Stack>
  );
}

function whyColor(why = '') {
  if (/overdue/.test(why)) return 'red';
  if (/due today/.test(why)) return 'orange';
  if (/in progress/.test(why)) return 'teal';
  if (/usually/.test(why)) return 'grape';
  return 'gray';
}

function EmptyCard({ icon, title, text, action }) {
  return (
    <Box className="mith-card" ta="center" py="lg">
      <Stack align="center" gap={6}>
        {icon}
        <Text fw={800} fz={16}>{title}</Text>
        <Text fz={13} c="dimmed" maw={380}>{text}</Text>
        {action}
      </Stack>
    </Box>
  );
}

// -------------------------------------------------------------------------
// sprint: the countdown
// -------------------------------------------------------------------------
function SprintView({ session, sprint, window: w, onDone, onStop }) {
  const left = Math.max(0, sprint.left);
  return (
    <Stack gap="md" pt={4} align="center">
      <Text fz={12} fw={800} tt="uppercase" lts={1.5} c={sprint.over ? '#e03131' : '#1b5a38'}>
        {sprint.over ? "Time's up" : 'Sprint in progress'}
      </Text>
      <Text fz={22} fw={800} ta="center" lh={1.2}>{session.title}</Text>
      <Text className="mith-timer" c={sprint.over ? '#e03131' : undefined}>{clock(left)}</Text>
      <Progress value={sprint.pct} size={8} radius="xl" color={sprint.over ? 'red' : 'forest'} w="100%" maw={360} transitionDuration={800} />
      <Text fz={13} c="dimmed" ta="center">
        {sprint.over
          ? `Planned until ${session.until}.${w.next ? ` ${w.next.title} is at ${w.next.at}.` : ''}`
          : `Until ${session.until}${w.next ? ` · ${w.next.title} at ${w.next.at}` : ''}`}
      </Text>
      <Group gap={8} mt={4} wrap="wrap" justify="center">
        <Button radius="xl" size="md" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} leftSection={<IconCheck size={17} />} onClick={onDone}>
          Done
        </Button>
        <Button radius="xl" size="md" variant="light" color="gray" leftSection={<IconPlayerStop size={16} />} onClick={onStop}>
          Stop, keep it open
        </Button>
      </Group>
      <Text fz={11.5} c="dimmed" ta="center" mt={4}>
        <IconRefresh size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
        Done records the real duration — {APP_NAME} uses it to size the next estimate.
      </Text>
    </Stack>
  );
}
