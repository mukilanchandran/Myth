import { Stack, Group, Text, Box, Checkbox, Badge, Progress, Divider } from '@mantine/core';
import { IconCalendarEvent, IconAlertCircle, IconClockHour4, IconProgress, IconTargetArrow } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { localAnswer } from '../../ai/assistant';

export default function TodayPanel() {
  const state = useStore();
  const mode = state.settings.mode;
  const todayKey = dayjs().format('YYYY-MM-DD');

  const open = state.tasks.filter((t) => t.mode === mode && t.status !== 'done');
  const overdue = open.filter((t) => t.due && dayjs(t.due).isBefore(dayjs(), 'day'));
  const dueToday = open.filter((t) => t.due === todayKey);
  const doing = open.filter((t) => t.status === 'doing' && !dueToday.includes(t) && !overdue.includes(t));
  const meetingsToday = state.notes.filter((n) => n.mode === mode && n.type === 'meeting' && n.meeting?.date === todayKey);
  const eventsToday = state.events.filter((e) => e.date === todayKey || (e.yearly && dayjs(e.date).format('MM-DD') === dayjs().format('MM-DD')));

  const doneToday = state.tasks.filter((t) => t.mode === mode && t.completedAt && dayjs(t.completedAt).isSame(dayjs(), 'day'));
  const habitsDone = state.habits.filter((h) => h.log[todayKey]).length;
  const dayPlan = (state.plans ?? {})[`${todayKey}|${mode}`] ?? [];
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
          <Badge size="lg" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }}>{score}/100</Badge>
        </Group>
        <Progress value={score} size={10} radius="xl" color="forest" mb={8} />
        <Text fz={12.5} c="dimmed">
          {doneToday.length} task{doneToday.length !== 1 ? 's' : ''} completed · {habitsDone} habit{habitsDone !== 1 ? 's' : ''} kept{dayPlan.length > 0 ? ` · plan ${planDone}/${dayPlan.length}` : ''}
        </Text>
      </Box>

      {plan && (
        <Box className="glass" p="md" style={{ borderRadius: 16 }}>
          <Group gap={6} mb={4}>
            <IconTargetArrow size={15} color="#12a150" />
            <Text fw={700} fz={13.5}>Myth suggests</Text>
          </Group>
          <Text fz={13} style={{ whiteSpace: 'pre-line' }}>{plan}</Text>
        </Box>
      )}

      {section('Meetings & events today', IconCalendarEvent, '#7048e8', [...meetingsToday.map((m) => ({ ...m, _t: m.meeting?.time })), ...eventsToday.map((e) => ({ ...e, _t: e.time }))], (m) => (
        <Group key={m.id} className="glass" p={10} style={{ borderRadius: 12 }} gap={8}>
          <Badge variant="light" color="violet" size="sm">{m._t || 'all day'}</Badge>
          <Text fz={13.5} fw={600}>{m.title}</Text>
        </Group>
      ))}

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
