// Every non-trip mode: a dated milestone plan (from the project templates,
// tailored by the model when reachable), mode extras that work offline
// (training week, meal week, savings schedule, study budget, routine day…),
// the model's playbook for the mode (schedules, tables, checklists),
// confirm → project, then a Live view that shows what the plan asks today.
import { useMemo, useState } from 'react';
import { Stack, Group, Text, TextInput, NumberInput, Button, Badge, Box, Loader, SimpleGrid, Table, Checkbox, Tooltip } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconFolderPlus, IconRefresh, IconSparkles, IconRadar, IconCheck, IconPlayerPlay, IconBulb, IconListCheck, IconTable, IconCalendarTime, IconListDetails } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import { buildPlan, createProjectFromPlan, TEMPLATES } from '../../ai/projectPlanner';
import { aiProjectPlan } from '../../ai/assistant';
import { aiPlanGuide } from '../../ai/planGuide';
import { mithNow, nowText } from '../../ai/mithNow';
import { MODES, MODE_TEMPLATE } from '../../ai/planner';
import { APP_NAME } from '../../config/env';

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const Card = ({ title, children, right }) => (
  <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
    <Group justify="space-between" mb={6} wrap="nowrap"><Text fw={700} fz={13}>{title}</Text>{right}</Group>
    {children}
  </Box>
);

// ---------- offline extras, one per mode ----------
function StudySchedule({ session, plan }) {
  const [hours, setHours] = useState(session.input.hoursPerDay ?? 2);
  const days = Math.max(1, dayjs(plan.deadline).diff(dayjs(), 'day'));
  const total = Math.round(hours * days);
  const topics = plan.milestones.slice(0, -1);
  const perTopic = Math.round(total / Math.max(1, topics.length));
  return (
    <Card title="Study budget" right={<NumberInput size="xs" w={120} min={0.5} max={14} step={0.5} value={hours} onChange={(v) => setHours(Number(v) || 1)} suffix=" h/day" />}>
      <Text fz={12.5} c="dimmed" mb={6}>{days} days × {hours} h = <b>{total} hours</b> until {dayjs(plan.deadline).format('MMM D')} — about {perTopic} h per phase{session.input.level ? ` · starting as ${String(session.input.level).toLowerCase()}` : ''}.</Text>
      <Table fz={12} verticalSpacing={3}>
        <Table.Tbody>{topics.map((m) => <Table.Tr key={m.id}><Table.Td>{m.title}</Table.Td><Table.Td ta="right">{perTopic} h</Table.Td><Table.Td ta="right" c="dimmed">by {dayjs(m.due).format('MMM D')}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
    </Card>
  );
}

function EventBudget({ session }) {
  const [budget, setBudget] = useState(session.input.budget ?? 200000);
  const guests = session.input.guests ?? null;
  const split = [['Venue', 0.35], ['Food & drinks', 0.3], ['Decor', 0.1], ['Photo / video', 0.1], ['Outfits & gifts', 0.08], ['Buffer', 0.07]];
  return (
    <Card title="Budget split" right={<NumberInput size="xs" w={150} min={0} step={10000} thousandSeparator="," prefix="₹" value={budget} onChange={(v) => setBudget(Number(v) || 0)} />}>
      {split.map(([k, f]) => <Group key={k} justify="space-between"><Text fz={12.5}>{k}</Text><Text fz={12.5} fw={600}>{inr(budget * f)}</Text></Group>)}
      {guests && <Text fz={12} c="dimmed" mt={6}>{guests} guests → about {inr(budget / guests)} per head · food alone {inr((budget * 0.3) / guests)} per plate.</Text>}
    </Card>
  );
}

const SESSIONS = {
  3: [['Mon', 'Easy session'], ['Wed', 'Intervals / strength'], ['Sat', 'Long session']],
  4: [['Mon', 'Easy session'], ['Tue', 'Intervals / strength'], ['Thu', 'Tempo'], ['Sat', 'Long session']],
  5: [['Mon', 'Easy session'], ['Tue', 'Intervals / strength'], ['Thu', 'Tempo'], ['Fri', 'Easy + technique'], ['Sat', 'Long session']],
  6: [['Mon', 'Easy session'], ['Tue', 'Strength'], ['Wed', 'Intervals'], ['Thu', 'Tempo'], ['Fri', 'Easy + technique'], ['Sat', 'Long session']],
};
function FitnessWeek({ session }) {
  const n = Math.min(7, Math.max(2, Number(session.input.sessionsPerWeek) || 4));
  const level = String(session.input.level ?? 'Beginner');
  const dur = level === 'Advanced' ? ['60–75 min', '90–120 min'] : level === 'Intermediate' ? ['45–60 min', '75–90 min'] : ['30–45 min', '60 min'];
  const base = SESSIONS[Math.min(6, Math.max(3, n))] ?? SESSIONS[4];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const week = days.map((d) => { const s = base.find(([x]) => x === d); return [d, s ? s[1] : n >= 7 && d === 'Sun' ? 'Mobility + walk' : 'Rest or mobility', s ? (/long/i.test(s[1]) ? dur[1] : dur[0]) : '']; });
  return (
    <Card title={`A training week — ${n} sessions, ${level.toLowerCase()}`}>
      {week.map(([d, w, t]) => <Group key={d} justify="space-between" wrap="nowrap"><Text fz={12.5} fw={600} w={34}>{d}</Text><Text fz={12.5} c={/rest/i.test(w) ? 'dimmed' : undefined} style={{ flex: 1 }}>{w}</Text><Text fz={11.5} c="dimmed">{t}</Text></Group>)}
      <Text fz={11.5} c="dimmed" mt={6}>Add ~10% volume a week, every 4th week easier. The playbook below has the full progression.</Text>
    </Card>
  );
}

const MEALS = {
  veg: { b: ['Poha with peanuts', 'Oats upma', 'Idli + sambar', 'Vegetable dalia', 'Moong chilla', 'Curd + fruit + nuts', 'Besan cheela'], l: ['Dal, brown rice, sabzi, salad', 'Rajma + roti + salad', 'Chole + jeera rice', 'Paneer bhurji + 2 roti', 'Sambar rice + veg poriyal', 'Curd rice + salad', 'Vegetable pulao + raita'], d: ['Palak paneer + roti', 'Mixed dal + 2 roti + salad', 'Vegetable khichdi + curd', 'Tofu stir-fry + roti', 'Soya chunk curry + rice', 'Lauki dal + roti', 'Vegetable soup + paneer tikka'], s: ['Roasted chana', 'Fruit', 'Buttermilk', 'Handful of nuts', 'Sprouts chaat'] },
  nonveg: { b: ['Egg bhurji + toast', 'Oats + boiled eggs', 'Idli + sambar', 'Omelette + fruit', 'Poha + egg', 'Curd + fruit + nuts', 'Moong chilla'], l: ['Chicken curry + brown rice + salad', 'Dal + roti + egg curry', 'Fish curry + rice', 'Grilled chicken + quinoa', 'Chicken pulao + raita', 'Rajma + roti', 'Sambar rice + fish fry'], d: ['Grilled fish + veg', 'Chicken stir-fry + roti', 'Egg curry + 2 roti', 'Chicken soup + salad', 'Keema + roti', 'Dal + roti + salad', 'Tandoori chicken + salad'], s: ['Boiled eggs', 'Fruit', 'Roasted chana', 'Greek yogurt', 'Nuts'] },
  egg: { b: ['Egg bhurji + toast', 'Oats + boiled eggs', 'Idli + sambar', 'Omelette + fruit', 'Poha', 'Curd + fruit + nuts', 'Besan cheela'], l: ['Dal + rice + sabzi', 'Egg curry + roti', 'Rajma + rice', 'Paneer bhurji + roti', 'Sambar rice + poriyal', 'Curd rice + salad', 'Veg pulao + raita'], d: ['Egg curry + roti', 'Palak paneer + roti', 'Khichdi + curd', 'Veg omelette + salad', 'Soya curry + rice', 'Dal + roti', 'Paneer tikka + soup'], s: ['Boiled eggs', 'Fruit', 'Roasted chana', 'Buttermilk', 'Nuts'] },
  vegan: { b: ['Poha with peanuts', 'Oats with soy milk', 'Idli + sambar', 'Dalia', 'Moong chilla', 'Fruit + nuts', 'Besan cheela'], l: ['Dal + brown rice + sabzi', 'Rajma + roti', 'Chole + rice', 'Tofu bhurji + roti', 'Sambar rice + poriyal', 'Veg pulao', 'Millet khichdi'], d: ['Tofu stir-fry + roti', 'Mixed dal + roti', 'Khichdi', 'Soya chunk curry + rice', 'Lauki dal + roti', 'Veg soup + chana', 'Peanut curry + rice'], s: ['Roasted chana', 'Fruit', 'Nuts', 'Sprouts', 'Peanut chikki (small)'] },
  keto: { b: ['3-egg omelette with cheese', 'Paneer bhurji', 'Eggs + avocado', 'Bulletproof coffee + nuts', 'Egg muffins', 'Greek yogurt + seeds', 'Cheese + cucumber'], l: ['Grilled chicken + sautéed veg', 'Paneer tikka + salad', 'Fish + spinach', 'Chicken salad with olive oil', 'Egg curry (no rice)', 'Cauliflower rice + keema', 'Mushroom + paneer stir-fry'], d: ['Butter chicken (no rice)', 'Palak paneer (no roti)', 'Grilled fish + broccoli', 'Chicken soup + cheese', 'Egg bhurji + salad', 'Paneer + bell peppers', 'Mutton curry + veg'], s: ['Nuts', 'Cheese cubes', 'Boiled eggs', 'Coconut', 'Olives'] },
  jain: { b: ['Poha (no onion)', 'Oats upma', 'Idli + jain sambar', 'Dalia', 'Moong chilla', 'Curd + fruit + nuts', 'Besan cheela'], l: ['Dal + rice + jain sabzi', 'Rajma + roti', 'Chole + rice', 'Paneer bhurji + roti', 'Sambar rice', 'Curd rice + salad', 'Veg pulao (no root veg)'], d: ['Palak paneer + roti', 'Dal + roti + salad', 'Khichdi + curd', 'Kadhi + rice', 'Soya curry + rice', 'Lauki dal + roti', 'Paneer tikka + soup'], s: ['Roasted chana', 'Fruit', 'Buttermilk', 'Nuts', 'Sprouts'] },
};
const dietKey = (d) => (/vegan/i.test(d) ? 'vegan' : /keto/i.test(d) ? 'keto' : /jain/i.test(d) ? 'jain' : /egg/i.test(d) ? 'egg' : /non/i.test(d) ? 'nonveg' : 'veg');
function MealWeek({ session }) {
  const pool = MEALS[dietKey(session.input.diet ?? '')];
  const days = Math.min(14, Math.max(3, Number(session.input.days) || 7));
  const goal = String(session.input.goal ?? '');
  const note = /lose/i.test(goal) ? 'half the rice / one roti less, double the salad' : /muscle/i.test(goal) ? 'add a protein at every meal, eat within an hour after training' : /sugar/i.test(goal) ? 'no sugar in drinks, fruit only with meals, walk 10 min after eating' : /budget/i.test(goal) ? 'seasonal veg, dal twice a day, cook once eat twice' : 'plate = ½ veg, ¼ protein, ¼ grain';
  return (
    <Card title={`${days}-day meal rotation — ${session.input.diet ?? 'balanced'}`} right={session.input.calories ? <Badge size="sm" variant="light" color="green">{session.input.calories} kcal/day</Badge> : null}>
      <Table fz={11.5} verticalSpacing={3}>
        <Table.Thead><Table.Tr><Table.Th>Day</Table.Th><Table.Th>Breakfast</Table.Th><Table.Th>Lunch</Table.Th><Table.Th>Snack</Table.Th><Table.Th>Dinner</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {Array.from({ length: days }, (_, i) => (
            <Table.Tr key={i}><Table.Td fw={600}>{i + 1}</Table.Td><Table.Td>{pool.b[i % pool.b.length]}</Table.Td><Table.Td>{pool.l[i % pool.l.length]}</Table.Td><Table.Td>{pool.s[i % pool.s.length]}</Table.Td><Table.Td>{pool.d[i % pool.d.length]}</Table.Td></Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz={11.5} c="dimmed" mt={6}><b>Rule for {goal || 'the goal'}:</b> {note}.</Text>
    </Card>
  );
}

function SavingsSchedule({ session }) {
  const amount = Number(session.input.amount) || 0;
  const income = Number(session.input.monthlyIncome) || 0;
  const months = Math.max(1, dayjs(session.input.deadline).diff(dayjs().startOf('month'), 'month'));
  const per = amount / months;
  const rows = Array.from({ length: Math.min(months, 24) }, (_, i) => [dayjs().add(i + 1, 'month').format('MMM YY'), per, per * (i + 1)]);
  return (
    <Card title="Savings schedule" right={<Badge size="sm" variant="light" color={income && per / income > 0.4 ? 'red' : 'teal'}>{inr(per)} / month{income ? ` · ${Math.round((per / income) * 100)}% of income` : ''}</Badge>}>
      <Text fz={12.5} c="dimmed" mb={6}>{inr(amount)} by {dayjs(session.input.deadline).format('MMM D, YYYY')} — {months} monthly transfer{months === 1 ? '' : 's'} on salary day{income && per / income > 0.4 ? '. That is a big share of income: push the date or trim the target.' : '.'}</Text>
      <Table fz={12} verticalSpacing={2}>
        <Table.Tbody>{rows.map(([m, s, c]) => <Table.Tr key={m}><Table.Td>{m}</Table.Td><Table.Td ta="right">{inr(s)}</Table.Td><Table.Td ta="right" c="dimmed">{inr(c)}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
      {months > 24 && <Text fz={11.5} c="dimmed">…and {months - 24} more months.</Text>}
    </Card>
  );
}

function RoutineDay({ session }) {
  const parse = (s, d) => { const m = String(s ?? '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i); if (!m) return d; let h = +m[1]; if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; } return h + (+(m[2] ?? 0)) / 60; };
  const wake = parse(session.input.wake, 6.5);
  const sleep = parse(session.input.sleep, 23);
  const hh = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const focus = String(session.input.focus ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const blocks = [
    [wake, 'Wake — water, light, no phone'], [wake + 0.5, focus[0] ? `${focus[0]} (first anchor)` : 'Move: walk / stretch'], [wake + 1.5, 'Breakfast + plan the day (3 things)'],
    [wake + 2.5, 'Deep work block 1'], [wake + 5, 'Admin, messages, small tasks'], [wake + 6.5, 'Lunch + 15 min walk'], [wake + 8, 'Deep work block 2'],
    [wake + 10.5, focus[1] ? focus[1] : 'Movement / errands'], [wake + 12, 'Dinner'], [sleep - 2, focus[2] ? focus[2] : 'Evening ritual: read, prep tomorrow'], [sleep - 0.5, 'Wind down — screens off'], [sleep, 'Sleep'],
  ].filter(([t]) => t <= sleep + 0.01).sort((a, b) => a[0] - b[0]);
  return (
    <Card title="A weekday, hour by hour" right={<Badge size="sm" variant="light" color="grape">{hh(wake)} → {hh(sleep)}</Badge>}>
      {blocks.map(([t, w], i) => <Group key={i} gap={10} wrap="nowrap"><Text fz={12} fw={700} w={44} style={{ fontVariantNumeric: 'tabular-nums' }}>{hh(t)}</Text><Text fz={12.5}>{w}</Text></Group>)}
    </Card>
  );
}

// ---------- the model's playbook ----------
const KIND_ICON = { list: IconListDetails, checklist: IconListCheck, table: IconTable, schedule: IconCalendarTime };
function GuideSection({ s, done, onToggle }) {
  const Icon = KIND_ICON[s.kind] ?? IconListDetails;
  return (
    <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
      <Group gap={6} mb={6}><Icon size={14} color="#1b5a38" /><Text fw={700} fz={13}>{s.title}</Text></Group>
      {s.kind === 'checklist' && <Stack gap={4}>{s.items.map((it) => <Checkbox key={it} size="xs" radius="xl" color="forest" label={it} checked={done.has(`${s.title}|${it}`)} onChange={() => onToggle(`${s.title}|${it}`)} />)}</Stack>}
      {s.kind === 'list' && s.items.map((it, i) => <Text key={i} fz={12.5} lh={1.45}>• {it}</Text>)}
      {(s.kind === 'table' || s.kind === 'schedule') && (
        <Box style={{ overflowX: 'auto' }}>
          <Table fz={11.5} verticalSpacing={3} withRowBorders={false} striped>
            {s.columns?.length > 0 && <Table.Thead><Table.Tr>{s.columns.map((c) => <Table.Th key={c}>{c}</Table.Th>)}</Table.Tr></Table.Thead>}
            <Table.Tbody>{s.rows.map((r, i) => <Table.Tr key={i}>{r.map((c, j) => <Table.Td key={j} fw={j === 0 ? 600 : undefined} style={{ whiteSpace: j === 0 ? 'nowrap' : undefined }}>{c}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
          </Table>
        </Box>
      )}
    </Box>
  );
}

export default function GenericPlanner({ session }) {
  const update = useStore((s) => s.updatePlannerSession);
  const tasks = useStore((s) => s.tasks);
  const completeTask = useStore((s) => s.completeTask);
  const updateTask = useStore((s) => s.updateTask);
  const setPanel = useUI((s) => s.setPanel);
  const mode = MODES[session.mode] ?? MODES.generic;
  const tplKey = MODE_TEMPLATE[session.mode] ?? 'generic';
  const [name, setName] = useState(session.input.name ?? session.title ?? '');
  const [deadline, setDeadline] = useState(session.input.deadline ?? dayjs().add(TEMPLATES[tplKey].horizonWeeks, 'week').format('YYYY-MM-DD'));
  const [running, setRunning] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const plan = session.result;
  const guide = session.guide ?? null;
  const done = useMemo(() => new Set(session.guideDone ?? []), [session.guideDone]);
  const toggleDone = (key) => update(session.id, (s) => { const set = new Set(s.guideDone ?? []); if (set.has(key)) set.delete(key); else set.add(key); return { guideDone: [...set] }; });

  const run = async () => {
    const intent = { text: session.input.text ?? name, name, template: tplKey, deadline, deadlineGuessed: !session.input.deadline };
    setRunning(true); setGuiding(true);
    update(session.id, { input: { ...session.input, name, deadline }, title: name });
    let built = buildPlan(intent, dayjs(), { name, deadline });
    update(session.id, { result: built, status: 'planned' });
    const state = useStore.getState();
    const fresh = { ...session, title: name, input: { ...session.input, name, deadline } };
    const [tailored, playbook] = await Promise.all([
      aiProjectPlan(intent, state).finally(() => setRunning(false)),
      aiPlanGuide(fresh, built, state).finally(() => setGuiding(false)),
    ]);
    if (tailored) { built = buildPlan(intent, dayjs(), { name, deadline, milestones: tailored, source: 'ai' }); update(session.id, { result: built }); }
    if (playbook) update(session.id, { guide: playbook, guideDone: [] });
  };

  const confirm = () => {
    const res = createProjectFromPlan(plan, useStore.getState());
    update(session.id, { status: 'confirmed', projectId: res.project.id });
    notifications.show({ title: `"${res.project.name}" created`, message: `${res.milestoneCount} milestones · ${res.taskCount} tasks. Go live here to see what the plan asks of you each day.`, color: 'forest' });
  };

  // live: what this plan asks of you now
  const mine = useMemo(() => tasks.filter((t) => t.projectId === session.projectId && t.status !== 'done').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')), [tasks, session.projectId]);
  const todayKey = dayjs().format('YYYY-MM-DD');
  const dueNow = mine.filter((t) => t.due && t.due <= todayKey);
  const upcoming = mine.filter((t) => !t.due || t.due > todayKey).slice(0, 4);
  const now = useMemo(() => (session.status === 'live' ? nowText(mithNow({ ...useStore.getState(), tasks: mine.length ? mine : tasks })) : ''), [session.status, mine, tasks]);
  const doneCount = tasks.filter((t) => t.projectId === session.projectId && t.status === 'done').length;

  const extras = {
    study: <StudySchedule session={session} plan={plan} />, event: <EventBudget session={session} />, fitness: <FitnessWeek session={session} />,
    food: <MealWeek session={session} />, finance: <SavingsSchedule session={session} />, routine: <RoutineDay session={session} />,
  };
  const facts = [
    session.input.guests && `${session.input.guests} guests`, session.input.budget && `budget ${inr(session.input.budget)}`, session.input.hoursPerDay && `${session.input.hoursPerDay} h/day`,
    session.input.sessionsPerWeek && `${session.input.sessionsPerWeek} sessions/week`, session.input.level, session.input.goal, session.input.diet, session.input.amount && `target ${inr(session.input.amount)}`,
    session.input.kind, session.input.words && `${Number(session.input.words).toLocaleString('en-IN')} words`, session.input.current && `now: ${session.input.current}`,
  ].filter(Boolean);

  return (
    <Stack gap="md">
      <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput label={`${mode.label} name`} radius="md" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <DateInput label="Target date" radius="md" minDate={new Date()} value={dayjs(deadline).toDate()} onChange={(v) => v && setDeadline(dayjs(v).format('YYYY-MM-DD'))} />
        </SimpleGrid>
        {facts.length > 0 && <Group gap={6} mt={8}>{facts.map((f) => <Badge key={f} size="sm" variant="light" color="gray">{f}</Badge>)}</Group>}
        <Group justify="space-between" mt="sm">
          <Text fz={12} c="dimmed">{mode.hint}</Text>
          <Button radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} leftSection={plan ? <IconRefresh size={15} /> : <IconSparkles size={15} />} loading={running} disabled={!name.trim()} onClick={run}>{plan ? 'Re-plan' : 'Plan'}</Button>
        </Group>
      </Box>

      {plan && (
        <>
          <Group gap={8}>
            <Badge variant="light" color="gray">{plan.templateLabel}</Badge>
            <Badge variant="light" color="blue">{plan.milestones.length} milestones · {plan.taskCount} tasks</Badge>
            {plan.source === 'ai' ? <Badge variant="light" color="forest" leftSection={<IconSparkles size={10} />}>tailored by {APP_NAME}</Badge> : running ? <Group gap={4}><Loader size={10} color="forest" /><Text fz={11.5} c="dimmed">tailoring…</Text></Group> : null}
            {guide ? <Tooltip label={`Playbook by ${guide.model}${guide.dedicated ? ' (your ChatGPT key)' : ''}`}><Badge variant="light" color="grape" leftSection={<IconBulb size={10} />}>playbook by {guide.dedicated ? 'ChatGPT' : APP_NAME}</Badge></Tooltip> : guiding ? <Group gap={4}><Loader size={10} color="grape" /><Text fz={11.5} c="dimmed">writing the playbook…</Text></Group> : null}
          </Group>
          {guide?.summary && <Box className="glass" p="sm" style={{ borderRadius: 14 }}><Text fz={13.5} lh={1.5}>{guide.summary}</Text></Box>}

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Stack gap="sm">
              {plan.milestones.map((m, i) => (
                <Box key={m.id} className="pl-day" p="sm">
                  <Group justify="space-between" mb={4}><Text fw={700} fz={13.5}>{i + 1}. {m.title}</Text><Badge size="xs" variant="light" color="gray">by {dayjs(m.due).format('MMM D')}</Badge></Group>
                  {m.tasks.map((t) => <Group key={t.id} justify="space-between" wrap="nowrap"><Text fz={12.5}>• {t.title}</Text><Text fz={11} c="dimmed" style={{ flexShrink: 0 }}>{dayjs(t.due).format('MMM D')}</Text></Group>)}
                </Box>
              ))}
              {guide?.tips?.length > 0 && (
                <Card title="Tips from the playbook">{guide.tips.map((t, i) => <Text key={i} fz={12.5} lh={1.45}>• {t}</Text>)}</Card>
              )}
            </Stack>
            <Stack gap="md">
              {extras[session.mode] ?? null}
              {guide?.sections?.map((s, i) => <GuideSection key={`${s.title}-${i}`} s={s} done={done} onToggle={toggleDone} />)}
              {session.status === 'live' && (
                <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
                  <Group gap={6} mb={6}><div className="pl-live-dot" /><Text fw={700} fz={13}>Live — {doneCount} done · {mine.length} open</Text></Group>
                  {dueNow.length > 0 && <Text fz={12.5} fw={600} c="red" mb={4}>Due now</Text>}
                  {dueNow.map((t) => <Group key={t.id} justify="space-between" wrap="nowrap" mb={3}><Text fz={12.5}>{t.title}</Text><Group gap={4}><Button size="compact-xs" radius="xl" color="forest" onClick={() => completeTask(t.id)}><IconCheck size={12} /></Button>{t.status !== 'doing' && <Button size="compact-xs" radius="xl" variant="light" onClick={() => updateTask(t.id, { status: 'doing' })}><IconPlayerPlay size={12} /></Button>}</Group></Group>)}
                  {upcoming.length > 0 && <Text fz={12.5} fw={600} mt={6} mb={4}>Coming up</Text>}
                  {upcoming.map((t) => <Group key={t.id} justify="space-between" wrap="nowrap"><Text fz={12.5} c="dimmed">{t.title}</Text><Text fz={11} c="dimmed">{t.due ? dayjs(t.due).format('MMM D') : ''}</Text></Group>)}
                  {mine.length === 0 && <Text fz={12.5} c="dimmed">Everything in this plan is done. 🎉</Text>}
                  {now && <Text fz={12} c="dimmed" mt={8} style={{ whiteSpace: 'pre-line' }}>{now}</Text>}
                </Box>
              )}
            </Stack>
          </SimpleGrid>
          <Group justify="flex-end" gap="sm">
            {session.status === 'planned' && <Button radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} leftSection={<IconFolderPlus size={16} />} onClick={confirm}>Confirm — create project</Button>}
            {session.status === 'confirmed' && (
              <>
                <Button radius="xl" variant="light" color="forest" onClick={() => setPanel('projects')}>Open the project</Button>
                <Button radius="xl" variant="gradient" gradient={{ from: '#e03131', to: '#e8590c' }} leftSection={<IconRadar size={16} />} onClick={() => update(session.id, { status: 'live', live: { startedAt: new Date().toISOString() } })}>Go live</Button>
              </>
            )}
            {session.status === 'live' && <Button radius="xl" variant="light" color="gray" onClick={() => update(session.id, { status: 'done' })}>Finish</Button>}
          </Group>
        </>
      )}
    </Stack>
  );
}
