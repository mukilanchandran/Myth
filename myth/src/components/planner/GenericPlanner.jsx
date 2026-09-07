// Every non-trip mode: a dated milestone plan (from the project templates,
// tailored by the model when reachable), mode extras, confirm → project,
// then a Live view that shows what the plan asks of you today.
import { useMemo, useState } from 'react';
import { Stack, Group, Text, TextInput, NumberInput, Button, Badge, Box, Loader, SimpleGrid, Table } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconFolderPlus, IconRefresh, IconSparkles, IconRadar, IconCheck, IconPlayerPlay } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import { buildPlan, createProjectFromPlan, TEMPLATES } from '../../ai/projectPlanner';
import { aiProjectPlan } from '../../ai/assistant';
import { mithNow, nowText } from '../../ai/mithNow';
import { MODES, MODE_TEMPLATE } from '../../ai/planner';
import { APP_NAME } from '../../config/env';

// Mode extras that are cheap to compute and genuinely useful.
function StudySchedule({ session, plan }) {
  const [hours, setHours] = useState(session.input.hoursPerDay ?? 2);
  const days = Math.max(1, dayjs(plan.deadline).diff(dayjs(), 'day'));
  const total = hours * days;
  const topics = plan.milestones.slice(0, -1);
  const perTopic = Math.round(total / Math.max(1, topics.length));
  return (
    <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
      <Group justify="space-between" mb={6}><Text fw={700} fz={13}>Study budget</Text><NumberInput size="xs" w={120} min={0.5} max={12} step={0.5} value={hours} onChange={(v) => setHours(Number(v) || 1)} suffix=" h/day" /></Group>
      <Text fz={12.5} c="dimmed" mb={6}>{days} days × {hours} h = <b>{total} hours</b> until {dayjs(plan.deadline).format('MMM D')} — about {perTopic} h per phase.</Text>
      <Table fz={12} verticalSpacing={3}>
        <Table.Tbody>{topics.map((m) => <Table.Tr key={m.id}><Table.Td>{m.title}</Table.Td><Table.Td ta="right">{perTopic} h</Table.Td><Table.Td ta="right" c="dimmed">by {dayjs(m.due).format('MMM D')}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
    </Box>
  );
}

function EventBudget({ session }) {
  const [budget, setBudget] = useState(session.input.budget ?? 200000);
  const split = [['Venue', 0.35], ['Food & drinks', 0.3], ['Decor', 0.1], ['Photo / video', 0.1], ['Outfits & gifts', 0.08], ['Buffer', 0.07]];
  return (
    <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
      <Group justify="space-between" mb={6}><Text fw={700} fz={13}>Budget split</Text><NumberInput size="xs" w={150} min={0} step={10000} thousandSeparator="," prefix="₹" value={budget} onChange={(v) => setBudget(Number(v) || 0)} /></Group>
      {split.map(([k, f]) => <Group key={k} justify="space-between"><Text fz={12.5}>{k}</Text><Text fz={12.5} fw={600}>₹{Math.round(budget * f).toLocaleString('en-IN')}</Text></Group>)}
    </Box>
  );
}

function FitnessWeek() {
  const week = [['Mon', 'Easy session'], ['Tue', 'Intervals / strength'], ['Wed', 'Rest or mobility'], ['Thu', 'Tempo'], ['Fri', 'Easy + technique'], ['Sat', 'Long session'], ['Sun', 'Rest']];
  return (
    <Box className="glass" p="sm" style={{ borderRadius: 14 }}>
      <Text fw={700} fz={13} mb={6}>A training week</Text>
      {week.map(([d, w]) => <Group key={d} justify="space-between"><Text fz={12.5} fw={600}>{d}</Text><Text fz={12.5} c="dimmed">{w}</Text></Group>)}
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
  const plan = session.result;

  const run = async () => {
    const intent = { text: session.input.text ?? name, name, template: tplKey, deadline, deadlineGuessed: !session.input.deadline };
    setRunning(true);
    update(session.id, { input: { ...session.input, name, deadline }, title: name });
    let built = buildPlan(intent, dayjs(), { name, deadline });
    update(session.id, { result: built, status: 'planned' });
    const tailored = await aiProjectPlan(intent, useStore.getState());
    if (tailored) { built = buildPlan(intent, dayjs(), { name, deadline, milestones: tailored, source: 'ai' }); update(session.id, { result: built }); }
    setRunning(false);
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

  return (
    <Stack gap="md">
      <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput label={`${mode.label} name`} radius="md" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <DateInput label="Target date" radius="md" minDate={new Date()} value={dayjs(deadline).toDate()} onChange={(v) => v && setDeadline(dayjs(v).format('YYYY-MM-DD'))} />
        </SimpleGrid>
        <Group justify="space-between" mt="sm">
          <Text fz={12} c="dimmed">{mode.hint}</Text>
          <Button radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }} leftSection={plan ? <IconRefresh size={15} /> : <IconSparkles size={15} />} loading={running} disabled={!name.trim()} onClick={run}>{plan ? 'Re-plan' : 'Plan'}</Button>
        </Group>
      </Box>

      {plan && (
        <>
          <Group gap={8}>
            <Badge variant="light" color="gray">{plan.templateLabel}</Badge>
            <Badge variant="light" color="blue">{plan.milestones.length} milestones · {plan.taskCount} tasks</Badge>
            {plan.source === 'ai' ? <Badge variant="light" color="forest" leftSection={<IconSparkles size={10} />}>tailored by {APP_NAME}</Badge> : running ? <Group gap={4}><Loader size={10} color="forest" /><Text fz={11.5} c="dimmed">tailoring…</Text></Group> : null}
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Stack gap="sm">
              {plan.milestones.map((m, i) => (
                <Box key={m.id} className="pl-day" p="sm">
                  <Group justify="space-between" mb={4}><Text fw={700} fz={13.5}>{i + 1}. {m.title}</Text><Badge size="xs" variant="light" color="gray">by {dayjs(m.due).format('MMM D')}</Badge></Group>
                  {m.tasks.map((t) => <Group key={t.id} justify="space-between" wrap="nowrap"><Text fz={12.5}>• {t.title}</Text><Text fz={11} c="dimmed" style={{ flexShrink: 0 }}>{dayjs(t.due).format('MMM D')}</Text></Group>)}
                </Box>
              ))}
            </Stack>
            <Stack gap="md">
              {session.mode === 'study' && <StudySchedule session={session} plan={plan} />}
              {session.mode === 'event' && <EventBudget session={session} />}
              {session.mode === 'fitness' && <FitnessWeek />}
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
            {session.status === 'planned' && <Button radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }} leftSection={<IconFolderPlus size={16} />} onClick={confirm}>Confirm — create project</Button>}
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
