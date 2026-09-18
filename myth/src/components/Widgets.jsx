import { Box, Group, Text, Stack, Progress, Badge, Checkbox, RingProgress, SimpleGrid } from '@mantine/core';
import { IconArrowUpRight, IconCalendarEvent, IconTargetArrow, IconWallet, IconFolders, IconRepeat } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { monthStats } from '../ai/insights';
import { habitIcon, eventIcon } from '../icons';

const cardAnim = (i) => ({
  initial: { opacity: 0, y: 22 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.15 + i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
});

function WidgetCard({ children, i, onClick, title, icon }) {
  return (
    <motion.div {...cardAnim(i)} style={{ height: '100%' }}>
      <Box
        className="glass hover-lift"
        p="md"
        h="100%"
        style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', flexDirection: 'column' }}
        onClick={onClick}
      >
        <Group justify="space-between" mb={8}>
          <Group gap={8}>
            {icon}
            <Text fw={700} fz={14.5}>{title}</Text>
          </Group>
          {onClick && <IconArrowUpRight size={16} opacity={0.5} />}
        </Group>
        <Box style={{ flex: 1 }}>{children}</Box>
      </Box>
    </motion.div>
  );
}

// One flow: tasks, projects, habits and money all sit on the landing page together.
export default function Widgets({ onOpen }) {
  const state = useStore();
  const todayKey = dayjs().format('YYYY-MM-DD');

  const tasks = state.tasks.filter((t) => t.status !== 'done');
  const dueToday = tasks.filter((t) => t.due && dayjs(t.due).isSame(dayjs(), 'day'));
  const overdue = tasks.filter((t) => t.due && dayjs(t.due).isBefore(dayjs(), 'day'));
  // urgency order: overdue → today → everything else by (due date, priority)
  const rest = tasks
    .filter((t) => !overdue.includes(t) && !dueToday.includes(t))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.priority - a.priority);
  const focus = [...overdue, ...dueToday, ...rest].slice(0, 3);

  const stats = monthStats(state, todayKey);
  const projects = state.projects.filter((p) => p.status === 'active');
  const habitsDone = state.habits.filter((h) => h.log[todayKey]).length;

  const upcoming = state.events
    .map((e) => {
      let d = dayjs(e.date);
      if (e.yearly && d.year(dayjs().year()).isBefore(dayjs(), 'day')) d = d.year(dayjs().year() + 1);
      else if (e.yearly) d = d.year(dayjs().year());
      return { ...e, next: d };
    })
    .filter((e) => e.next.diff(dayjs().startOf('day'), 'day') >= 0)
    .sort((a, b) => a.next - b.next)
    .slice(0, 3);

  const hasMoney = stats.earned > 0 || stats.spent > 0;

  return (
    // container queries: the column count follows the space actually available,
    // so the grid stays tidy when the side drawer narrows the page
    <SimpleGrid
      type="container"
      className="widget-grid"
      cols={{ base: 1, '520px': 2, '780px': 3, '1040px': 5 }}
      spacing="md" w="100%" maw={1400} mx="auto" px={{ base: 12, sm: 24 }}
    >
      {/* Focus today */}
      <WidgetCard i={0} title="Focus today" icon={<IconTargetArrow size={17} color="#0D2D1C" />} onClick={() => onOpen('tasks')}>
        {focus.length === 0 ? (
          <Text fz={13} c="dimmed">All clear — capture your next move above.</Text>
        ) : (
          <Stack gap={8}>
            {focus.map((t) => (
              <Group key={t.id} gap={8} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                <Checkbox size="xs" radius="xl" color="forest" checked={false} onChange={() => state.completeTask(t.id)} />
                <Text fz={13.5} lineClamp={1} style={{ flex: 1 }}>{t.title}</Text>
                {t.due && (dayjs(t.due).isBefore(dayjs(), 'day')
                  ? <Badge size="xs" color="red" variant="light">late</Badge>
                  : dayjs(t.due).isSame(dayjs(), 'day')
                    ? <Badge size="xs" color="yellow" variant="light">today</Badge>
                    : <Badge size="xs" color="gray" variant="light">{dayjs(t.due).format('MMM D')}</Badge>)}
              </Group>
            ))}
          </Stack>
        )}
      </WidgetCard>

      {/* Month progress + money */}
      <WidgetCard i={1} title={`${dayjs().format('MMMM')} progress`} icon={<IconTargetArrow size={17} color="#1971c2" />} onClick={() => onOpen('reports')}>
        <Group gap="lg" align="center">
          <RingProgress
            size={78} thickness={8} roundCaps
            sections={[{ value: stats.completionRate, color: '#0D2D1C' }]}
            label={<Text ta="center" fw={800} fz={15}>{stats.completionRate}%</Text>}
          />
          <Stack gap={4}>
            <Text fz={13}><b>{stats.completed}</b> done</Text>
            <Text fz={13}><b>{stats.open}</b> open</Text>
            <Text fz={13} c={stats.overdue ? 'red' : 'dimmed'}><b>{stats.overdue}</b> overdue</Text>
          </Stack>
        </Group>
        {hasMoney && (
          <Group
            gap={8} mt={10} pt={8} wrap="nowrap"
            style={{ borderTop: '1px solid rgba(20,60,40,0.12)' }}
            onClick={(e) => { e.stopPropagation(); onOpen('finance'); }}
          >
            <IconWallet size={15} color="#1b5a38" style={{ flexShrink: 0 }} />
            <Text fz={12.5} fw={600}>₹{stats.spent.toLocaleString('en-IN')} spent</Text>
            <Text fz={12.5} c={stats.savings >= 0 ? 'green' : 'red'}>
              net {stats.savings >= 0 ? '+' : '−'}₹{Math.abs(stats.savings).toLocaleString('en-IN')}
            </Text>
          </Group>
        )}
      </WidgetCard>

      {/* Active projects */}
      <WidgetCard i={2} title="Active projects" icon={<IconFolders size={17} color="#e8590c" />} onClick={() => onOpen('projects')}>
        {projects.length === 0 ? (
          <Text fz={13} c="dimmed">No projects yet — create one to organise tasks, milestones & docs.</Text>
        ) : (
          <Stack gap={10}>
            {projects.slice(0, 3).map((p) => {
              const pt = state.tasks.filter((t) => t.projectId === p.id);
              const pct = pt.length ? Math.round((pt.filter((t) => t.status === 'done').length / pt.length) * 100) : 0;
              return (
                <div key={p.id}>
                  <Group justify="space-between" mb={3}>
                    <Text fz={13} fw={600} lineClamp={1}>{p.name}</Text>
                    <Text fz={12} c="dimmed">{pct}%</Text>
                  </Group>
                  <Progress value={pct} size={6} radius="xl" color={p.color} />
                </div>
              );
            })}
          </Stack>
        )}
      </WidgetCard>

      {/* Today's habits */}
      <WidgetCard i={3} title="Today's habits" icon={<IconRepeat size={17} color="#0ca678" />} onClick={() => onOpen('habits')}>
        {state.habits.length === 0 ? (
          <Text fz={13} c="dimmed">Type "habit: read 20 min" above to start one.</Text>
        ) : (
          <Stack gap={7}>
            {state.habits.slice(0, 3).map((h) => {
              const HIcon = habitIcon(h.icon);
              return (
                <Group key={h.id} gap={8} onClick={(e) => e.stopPropagation()} wrap="nowrap">
                  <Checkbox size="xs" radius="xl" color="forest" checked={!!h.log[todayKey]} onChange={() => state.toggleHabit(h.id)} />
                  <HIcon size={15} color="#1b5a38" style={{ flexShrink: 0 }} />
                  <Text fz={13.5} lineClamp={1} td={h.log[todayKey] ? 'line-through' : undefined} opacity={h.log[todayKey] ? 0.6 : 1}>
                    {h.name}
                  </Text>
                </Group>
              );
            })}
            {state.habits.length > 3 && (
              <Text fz={12} c="dimmed">{habitsDone}/{state.habits.length} kept today · {state.habits.length - 3} more inside</Text>
            )}
          </Stack>
        )}
      </WidgetCard>

      {/* Coming up */}
      <WidgetCard i={4} title="Coming up" icon={<IconCalendarEvent size={17} color="#7048e8" />} onClick={() => onOpen('calendar')}>
        <Stack gap={7}>
          {upcoming.length === 0 && <Text fz={13} c="dimmed">Calendar is clear.</Text>}
          {upcoming.map((e) => {
            const diff = e.next.diff(dayjs().startOf('day'), 'day');
            const meta = eventIcon(e.kind);
            const EIcon = meta.icon;
            return (
              <Group key={e.id} gap={8} wrap="nowrap" justify="space-between">
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <EIcon size={15} color={meta.color} style={{ flexShrink: 0 }} />
                  <Text fz={13} lineClamp={1}>{e.title}</Text>
                </Group>
                <Badge size="xs" variant="light" color={diff === 0 ? 'red' : 'gray'}>
                  {diff === 0 ? 'today' : diff === 1 ? 'tmrw' : e.next.format('MMM D')}
                </Badge>
              </Group>
            );
          })}
        </Stack>
      </WidgetCard>
    </SimpleGrid>
  );
}
