import { Stack, Group, Text, Box, Checkbox, Badge, Progress, Divider, Button } from '@mantine/core';
import { IconCalendarEvent, IconAlertCircle, IconClockHour4, IconProgress, IconTargetArrow, IconBrain } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { localAnswer } from '../../ai/assistant';
import { contextFor } from '../../ai/context';
import { useUI } from '../../store/useUI';

export default function TodayPanel() {
  const state = useStore();
  const todayKey = dayjs().format('YYYY-MM-DD');
  const openContext = useUI((s) => s.openContext);

  const open = state.tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && dayjs(t.due).isBefore(dayjs(), 'day'));
  const dueToday = open.filter((t) => t.due === todayKey);
  const doing = open.filter((t) => t.status === 'doing' && !dueToday.includes(t) && !overdue.includes(t));
  const meetingsToday = state.notes.filter((n) => n.type === 'meeting' && n.meeting?.date === todayKey);
  const eventsToday = state.events
    .filter((e) => e.date === todayKey || (e.yearly && dayjs(e.date).format('MM-DD') === dayjs().format('MM-DD')))
    // a meeting captured from the bar exists as both a note and an event — show it once
    .filter((e) => !(e.kind === 'meeting' && meetingsToday.some((m) => m.title.trim().toLowerCase() === e.title.trim().toLowerCase())));

  const doneToday = state.tasks.filter((t) => t.completedAt && dayjs(t.completedAt).isSame(dayjs(), 'day'));
  const habitsDone = state.habits.filter((h) => h.log[todayKey]).length;
  const dayPlan = (state.plans ?? {})[todayKey] ?? [];
  const planDone = dayPlan.filter((p) => p.done).length;
  const score = Math.min(100, doneToday.length * 20 + habitsDone * 10 + planDone * 10 + (meetingsToday.length ? 10 : 0));

  const plan = localAnswer('what are my priorities today', state);

  const section = (title, Icon, color, items, render) =>
    items.length > 0 && (
      <>
        <Group gap={6}>
          <Icon size={15} color={color} />
          <Text fw={700} fz={13.5} tt="uppercase" lts={0.5} c="dimmed">{title}</Text>
        </Group>
        <Stack gap={6}>{items.map(render)}</Stack>
      </>
    );

  return (
    <Stack gap="md">
      <Box className="glass" p="lg" style={{ borderRadius: 18 }}>
        <Group justify="space-between" mb={6}>
          <Text fw={800} fz={16}>Productivity score</Text>
          <Badge size="lg" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }}>{score}/100</Badge>
        </Group>
        <Progress value={score} size={10} radius="xl" color="forest" mb={8} />
        <Text fz={12.5} c="dimmed">
          {doneToday.length} task{doneToday.length !== 1 ? 's' : ''} completed · {habitsDone} habit{habitsDone !== 1 ? 's' : ''} kept{dayPlan.length > 0 ? ` · plan ${planDone}/${dayPlan.length}` : ''}
        </Text>
      </Box>

      {plan && (
        <Box className="glass" p="md" style={{ borderRadius: 16 }}>
          <Group gap={6} mb={4}>
            <IconTargetArrow size={15} color="#0D2D1C" />
            <Text fw={700} fz={13.5}>Myth suggests</Text>
          </Group>
          <Text fz={13} style={{ whiteSpace: 'pre-line' }}>{plan}</Text>
        </Box>
      )}

      {section('Meetings & events today', IconCalendarEvent, '#7048e8', [
        ...meetingsToday.map((m) => ({ ...m, _t: m.meeting?.time, _cid: `note:${m.id}` })),
        ...eventsToday.map((e) => ({ ...e, _t: e.time, _cid: e.kind === 'meeting' ? `event:${e.id}` : null })),
      ], (m) => {
        // the Context Engine explains each meeting through everything linked to it
        const ctx = m._cid ? contextFor(state, m._cid) : null;
        const c = ctx?.counts;
        const bits = c ? [
          c.openTasks && `${c.openTasks} open task${c.openTasks === 1 ? '' : 's'}`,
          c.documents && `${c.documents} doc${c.documents === 1 ? '' : 's'}`,
          c.unresolvedActions && `${c.unresolvedActions} unresolved`,
        ].filter(Boolean) : [];
        return (
          <Group key={m.id} className="glass" p={10} style={{ borderRadius: 12 }} gap={8} wrap="nowrap">
            <Badge variant="light" color="violet" size="sm">{m._t || 'all day'}</Badge>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fz={13.5} fw={600} lineClamp={1}>{m.title}</Text>
              {bits.length > 0 && <Text fz={11.5} c="dimmed">{bits.join(' · ')}</Text>}
            </Box>
            {ctx && (
              <Button size="compact-xs" radius="xl" variant="light" color="violet" leftSection={<IconBrain size={12} />} onClick={() => openContext(m._cid)}>
                Prep
              </Button>
            )}
          </Group>
        );
      })}

      {section('Overdue', IconAlertCircle, '#e03131', overdue, (t) => (
        <Group key={t.id} className="glass" p={10} style={{ borderRadius: 12 }} gap={8}>
          <Checkbox size="sm" radius="xl" color="forest" checked={false} onChange={() => state.completeTask(t.id)} />
          <Text fz={13.5} style={{ flex: 1 }}>{t.title}</Text>
          <Badge size="xs" color="red" variant="light">{dayjs(t.due).format('MMM D')}</Badge>
        </Group>
      ))}

      {section('Due today', IconClockHour4, '#f08c00', dueToday, (t) => (
        <Group key={t.id} className="glass" p={10} style={{ borderRadius: 12 }} gap={8}>
          <Checkbox size="sm" radius="xl" color="forest" checked={false} onChange={() => state.completeTask(t.id)} />
          <Text fz={13.5} style={{ flex: 1 }}>{t.title}</Text>
        </Group>
      ))}

      {section('In progress', IconProgress, '#1971c2', doing, (t) => (
        <Group key={t.id} className="glass" p={10} style={{ borderRadius: 12 }} gap={8}>
          <Checkbox size="sm" radius="xl" color="forest" checked={false} onChange={() => state.completeTask(t.id)} />
          <Text fz={13.5} style={{ flex: 1 }}>{t.title}</Text>
        </Group>
      ))}

      {doneToday.length > 0 && (
        <>
          <Divider label={`Completed today (${doneToday.length})`} labelPosition="center" />
          <Stack gap={4}>
            {doneToday.map((t) => (
              <Text key={t.id} fz={13} c="dimmed" td="line-through">{t.title}</Text>
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}
