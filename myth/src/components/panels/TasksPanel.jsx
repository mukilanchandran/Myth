import { useState } from 'react';
import {
  Stack, Group, Text, Badge, ActionIcon, Checkbox, TextInput, Select, Button,
  Menu, SegmentedControl, Rating, Textarea, Box, Collapse,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconPlus, IconTrash, IconDots, IconFlag, IconChevronDown } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import EmptyState from '../EmptyState';

const STATUSES = [
  { value: 'todo', label: 'To do', color: 'gray' },
  { value: 'doing', label: 'Doing', color: 'blue' },
  { value: 'review', label: 'Review', color: 'violet' },
  { value: 'blocked', label: 'Blocked', color: 'red' },
  { value: 'done', label: 'Done', color: 'green' },
];

function TaskRow({ task }) {
  const { updateTask, completeTask, deleteTask, projects } = useStore();
  const [open, setOpen] = useState(false);
  const proj = projects.find((p) => p.id === task.projectId);
  const late = task.due && task.status !== 'done' && dayjs(task.due).isBefore(dayjs(), 'day');

  return (
    <Box className="glass" p="md" style={{ borderRadius: 14 }}>
      <Group gap={12} wrap="nowrap" align="flex-start">
        <Checkbox
          radius="xl" color="forest" size="sm"
          checked={task.status === 'done'}
          onChange={() => (task.status === 'done' ? updateTask(task.id, { status: 'todo', completedAt: null }) : completeTask(task.id))}
        />
        <Box style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
          <Text fz={14.5} fw={600} td={task.status === 'done' ? 'line-through' : undefined} opacity={task.status === 'done' ? 0.55 : 1}>
            {task.title}
          </Text>
          <Group gap={6} mt={6}>
            {proj && <Badge size="xs" variant="light" color="teal">{proj.name}</Badge>}
            {task.due && <Badge size="xs" variant="light" color={late ? 'red' : 'gray'}>{late ? 'overdue · ' : ''}{dayjs(task.due).format('MMM D')}</Badge>}
            {task.priority >= 4 && <Badge size="xs" variant="light" color="orange"><IconFlag size={9} style={{ marginRight: 3 }} />P{task.priority}</Badge>}
            <Badge size="xs" variant="dot" color={STATUSES.find((s) => s.value === task.status)?.color}>{STATUSES.find((s) => s.value === task.status)?.label}</Badge>
          </Group>
        </Box>
        <ActionIcon variant="subtle" color="gray" onClick={() => setOpen((o) => !o)}>
          <IconChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
        </ActionIcon>
        <Menu position="bottom-end" radius="md">
          <Menu.Target><ActionIcon variant="subtle" color="gray"><IconDots size={16} /></ActionIcon></Menu.Target>
          <Menu.Dropdown>
            {STATUSES.map((st) => (
              <Menu.Item key={st.value} onClick={() => updateTask(task.id, { status: st.value, completedAt: st.value === 'done' ? new Date().toISOString() : null })}>
                Move to {st.label}
              </Menu.Item>
            ))}
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => deleteTask(task.id)}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <Collapse expanded={open}>
        <Stack gap="xs" mt="sm" pl={34}>
          <TextInput
            label="Title" size="sm" radius="md"
            defaultValue={task.title}
            onBlur={(e) => e.currentTarget.value.trim() && updateTask(task.id, { title: e.currentTarget.value.trim() })}
          />
          <Textarea
            placeholder="Description / notes…" autosize minRows={1} radius="md" size="sm"
            defaultValue={task.desc}
            onBlur={(e) => updateTask(task.id, { desc: e.currentTarget.value })}
          />
          <Group gap="sm">
            <DateInput
              size="xs" radius="md" placeholder="Deadline" clearable
              value={task.due ?? null}
              onChange={(v) => updateTask(task.id, { due: v ? dayjs(v).format('YYYY-MM-DD') : null })}
            />
            <Select
              size="xs" radius="md" placeholder="Project" clearable
              data={projects.map((p) => ({ value: p.id, label: p.name }))}
              value={task.projectId}
              onChange={(v) => updateTask(task.id, { projectId: v })}
            />
            <Group gap={4}>
              <Text fz={12} c="dimmed">Priority</Text>
              <Rating value={task.priority} onChange={(v) => updateTask(task.id, { priority: v })} count={5} size="xs" />
            </Group>
          </Group>
        </Stack>
      </Collapse>
    </Box>
  );
}

export default function TasksPanel() {
  const { tasks, addTask } = useStore();
  const [filter, setFilter] = useState('open');
  const [quick, setQuick] = useState('');

  const mine = tasks;
  const shown = mine
    .filter((t) => (filter === 'open' ? t.status !== 'done' : filter === 'done' ? t.status === 'done' : true))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.priority - a.priority);

  const quickAdd = () => {
    if (!quick.trim()) return;
    addTask({ title: quick.trim() });
    setQuick('');
  };

  return (
    <Stack gap="md">
      <Group gap="sm">
        <TextInput
          style={{ flex: 1 }} radius="xl" placeholder="Quick add a task…"
          value={quick} onChange={(e) => setQuick(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
        />
        <Button radius="xl" leftSection={<IconPlus size={16} />} onClick={quickAdd}>Add</Button>
      </Group>
      <SegmentedControl
        value={filter} onChange={setFilter} radius="xl" size="sm" fullWidth
        styles={{ root: { background: '#f1f4f2' } }}
        data={[
          { value: 'open', label: `Open (${mine.filter((t) => t.status !== 'done').length})` },
          { value: 'done', label: `Done (${mine.filter((t) => t.status === 'done').length})` },
          { value: 'all', label: 'All' },
        ]}
      />
      <Stack gap={8}>
        {shown.length === 0 && <EmptyState kind="tasks" title={filter === 'done' ? 'Nothing finished yet' : 'No tasks here'} hint={filter === 'done' ? 'Completed tasks land here — tick one off and watch it move.' : 'Type one above, or capture it from the bar on the home screen.'} />}
        {shown.map((t) => <TaskRow key={t.id} task={t} />)}
      </Stack>
    </Stack>
  );
}
