import { useEffect, useState } from 'react';
import {
  Stack, Group, Text, Badge, ActionIcon, TextInput, Button, Box, Progress, Tabs,
  Textarea, ColorInput, FileButton, Table, Checkbox, Menu, Image, Modal, Select,
} from '@mantine/core';
import {
  IconPlus, IconTrash, IconArrowLeft, IconUpload, IconDownload, IconDots,
  IconFile, IconPhoto, IconFileTypePdf, IconChecklist, IconPaperclip,
  IconFlag, IconCalendarEvent, IconTargetArrow, IconPlayerPause, IconCircleCheck,
} from '@tabler/icons-react';
import { DateInput } from '@mantine/dates';
import dayjs from 'dayjs';
import { useStore, uid } from '../../store/useStore';
import EmptyState from '../EmptyState';
import { putBlob, getBlob, deleteBlob, downloadBlob } from '../../store/fileStore';

function fileIcon(type) {
  if (type?.startsWith('image/')) return <IconPhoto size={16} color="#7048e8" />;
  if (type === 'application/pdf') return <IconFileTypePdf size={16} color="#e03131" />;
  return <IconFile size={16} color="#495057" />;
}

const STATUS_META = {
  active: { label: 'Active', color: 'teal', icon: IconTargetArrow },
  'on-hold': { label: 'On hold', color: 'orange', icon: IconPlayerPause },
  done: { label: 'Completed', color: 'grape', icon: IconCircleCheck },
};

// "Deadline: Aug 30 · 19 days left" (red when it slipped past)
function DeadlineBadge({ deadline, size = 'xs' }) {
  if (!deadline) return null;
  const days = dayjs(deadline).startOf('day').diff(dayjs().startOf('day'), 'day');
  const overdue = days < 0;
  return (
    <Badge size={size} variant="light" color={overdue ? 'red' : days <= 3 ? 'orange' : 'teal'} leftSection={<IconCalendarEvent size={11} />}>
      {dayjs(deadline).format('MMM D')}{overdue ? ` · ${-days}d late` : days === 0 ? ' · today' : ` · ${days}d left`}
    </Badge>
  );
}

function ProjectDetail({ project, onBack }) {
  const state = useStore();
  const { updateProject, tasks, files, addTask, addFileMeta, deleteFileMeta, completeTask, updateTask, deleteTask } = state;
  const [quickTask, setQuickTask] = useState('');
  const [quickMilestone, setQuickMilestone] = useState('');
  const [preview, setPreview] = useState(null);

  const pTasks = tasks.filter((t) => t.projectId === project.id);
  const pFiles = files.filter((f) => f.projectId === project.id);
  const pct = pTasks.length ? Math.round((pTasks.filter((t) => t.status === 'done').length / pTasks.length) * 100) : 0;

  const upload = async (list) => {
    for (const file of list ?? []) {
      const id = uid();
      await putBlob(id, file);
      addFileMeta({ id, name: file.name, size: file.size, type: file.type, projectId: project.id });
    }
  };

  const openPreview = async (f) => {
    if (!f.type?.startsWith('image/')) { downloadBlob(f.id, f.name); return; }
    const blob = await getBlob(f.id);
    if (blob) setPreview({ url: URL.createObjectURL(blob), name: f.name });
  };

  return (
    <Stack gap="md">
      <Group>
        <ActionIcon variant="subtle" radius="xl" onClick={onBack}><IconArrowLeft size={18} /></ActionIcon>
        <TextInput
          variant="unstyled" fw={700} size="lg" style={{ flex: 1 }}
          defaultValue={project.name}
          onBlur={(e) => updateProject(project.id, { name: e.currentTarget.value })}
          styles={{ input: { fontWeight: 700, fontSize: 20 } }}
        />
        <ColorInput size="xs" w={110} value={project.color} onChange={(c) => updateProject(project.id, { color: c })} radius="xl" />
      </Group>
      <Textarea
        placeholder="Project overview, goals, scope…" autosize minRows={2} radius="md"
        defaultValue={project.desc}
        onBlur={(e) => updateProject(project.id, { desc: e.currentTarget.value })}
      />
      <Group gap="xs">
        <Select
          size="xs" radius="xl" w={130} value={project.status ?? 'active'}
          data={Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))}
          onChange={(v) => v && updateProject(project.id, { status: v })}
          allowDeselect={false}
        />
        <DateInput
          size="xs" radius="xl" w={150} clearable placeholder="Deadline"
          leftSection={<IconCalendarEvent size={13} />}
          value={project.deadline ?? null}
          onChange={(v) => updateProject(project.id, { deadline: v ? dayjs(v).format('YYYY-MM-DD') : null })}
        />
        <DeadlineBadge deadline={project.deadline} />
        <Text fz={12} c="dimmed" ml="auto">
          {pTasks.filter((t) => t.status === 'done').length}/{pTasks.length} tasks · {(project.milestones ?? []).filter((m) => m.done).length}/{(project.milestones ?? []).length} milestones · {pFiles.length} docs
        </Text>
      </Group>
      <Group gap="xs">
        <Progress value={pct} size={10} radius="xl" color={project.color} style={{ flex: 1 }} />
        <Text fz={13} fw={600}>{pct}%</Text>
      </Group>

      <Tabs defaultValue="tasks" radius="lg" color="forest">
        <Tabs.List>
          <Tabs.Tab value="tasks" leftSection={<IconChecklist size={15} />}>Tasks ({pTasks.length})</Tabs.Tab>
          <Tabs.Tab value="milestones" leftSection={<IconFlag size={15} />}>Milestones ({(project.milestones ?? []).length})</Tabs.Tab>
          <Tabs.Tab value="files" leftSection={<IconPaperclip size={15} />}>Documents ({pFiles.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="milestones" pt="md">
          <Group gap="xs" mb="sm">
            <TextInput
              style={{ flex: 1 }} size="sm" radius="xl" placeholder="Add a milestone… (Enter to save)"
              value={quickMilestone} onChange={(e) => setQuickMilestone(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && quickMilestone.trim()) {
                  updateProject(project.id, {
                    milestones: [...(project.milestones ?? []), { id: uid(), title: quickMilestone.trim(), due: null, done: false }],
                  });
                  setQuickMilestone('');
                }
              }}
            />
          </Group>
          <Stack gap={6}>
            {(project.milestones ?? []).length === 0 && (
              <Text fz={13} c="dimmed">Break the project into big checkpoints — launch, handoff, review…</Text>
            )}
            {(project.milestones ?? []).map((m) => (
              <Group key={m.id} gap={8} className="glass" p={8} style={{ borderRadius: 12 }} wrap="nowrap">
                <Checkbox
                  size="sm" radius="xl" color="forest" checked={m.done}
                  onChange={() => updateProject(project.id, {
                    milestones: project.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)),
                  })}
                />
                <Text fz={13.5} style={{ flex: 1 }} td={m.done ? 'line-through' : undefined} opacity={m.done ? 0.6 : 1}>
                  {m.title}
                </Text>
                <DateInput
                  size="xs" radius="md" placeholder="due" clearable w={120}
                  leftSection={<IconCalendarEvent size={13} />}
                  value={m.due ?? null}
                  onChange={(v) => updateProject(project.id, {
                    milestones: project.milestones.map((x) => (x.id === m.id ? { ...x, due: v ? dayjs(v).format('YYYY-MM-DD') : null } : x)),
                  })}
                />
                <ActionIcon size="sm" variant="subtle" color="red"
                  onClick={() => updateProject(project.id, { milestones: project.milestones.filter((x) => x.id !== m.id) })}>
                  <IconTrash size={13} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="tasks" pt="md">
          <Group gap="xs" mb="sm">
            <TextInput
              style={{ flex: 1 }} size="sm" radius="xl" placeholder="Add task to this project…"
              value={quickTask} onChange={(e) => setQuickTask(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && quickTask.trim()) {
                  addTask({ title: quickTask.trim(), projectId: project.id });
                  setQuickTask('');
                }
              }}
            />
          </Group>
          <Stack gap={6}>
            {pTasks.map((t) => (
              <Group key={t.id} gap={8} className="glass" p={8} style={{ borderRadius: 12 }} wrap="nowrap">
                <Checkbox
                  size="sm" radius="xl" color="forest" checked={t.status === 'done'}
                  onChange={() => (t.status === 'done' ? updateTask(t.id, { status: 'todo', completedAt: null }) : completeTask(t.id))}
                />
                <Text fz={13.5} style={{ flex: 1 }} td={t.status === 'done' ? 'line-through' : undefined}>{t.title}</Text>
                {t.due && <Badge size="xs" variant="light">{dayjs(t.due).format('MMM D')}</Badge>}
                <ActionIcon size="sm" variant="subtle" color="red" onClick={() => deleteTask(t.id)}><IconTrash size={13} /></ActionIcon>
              </Group>
            ))}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="files" pt="md">
          <FileButton onChange={upload} multiple>
            {(props) => <Button {...props} size="xs" radius="xl" variant="light" leftSection={<IconUpload size={14} />}>Upload documents, designs, images</Button>}
          </FileButton>
          <Table mt="sm" verticalSpacing={6}>
            <Table.Tbody>
              {pFiles.map((f) => (
                <Table.Tr key={f.id} style={{ cursor: 'pointer' }}>
                  <Table.Td onClick={() => openPreview(f)}>
                    <Group gap={8}>{fileIcon(f.type)}<Text fz={13}>{f.name}</Text></Group>
                  </Table.Td>
                  <Table.Td w={90}><Text fz={12} c="dimmed">{(f.size / 1024).toFixed(0)} KB</Text></Table.Td>
                  <Table.Td w={80}>
                    <Group gap={4} justify="flex-end">
                      <ActionIcon size="sm" variant="subtle" onClick={() => downloadBlob(f.id, f.name)}><IconDownload size={14} /></ActionIcon>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => { deleteBlob(f.id); deleteFileMeta(f.id); }}><IconTrash size={14} /></ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {pFiles.length === 0 && <Text fz={13} c="dimmed" mt="sm">Upload briefs, designs, research docs — stored locally in your browser.</Text>}
        </Tabs.Panel>
      </Tabs>

      <Modal opened={!!preview} onClose={() => { URL.revokeObjectURL(preview?.url); setPreview(null); }} title={preview?.name} size="lg" radius="lg">
        {preview && <Image src={preview.url} radius="md" />}
      </Modal>
    </Stack>
  );
}

export default function ProjectsPanel() {
  const { projects, tasks, addProject, deleteProject } = useStore();
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', desc: '', deadline: null, color: '#0D2D1C' });
  const mine = projects;
  const open = mine.find((p) => p.id === openId);

  useEffect(() => { if (openId && !open) setOpenId(null); }, [openId, open]);

  const createProject = () => {
    if (!form.name.trim()) return;
    const p = addProject({
      name: form.name.trim(),
      desc: form.desc.trim(),
      deadline: form.deadline ? dayjs(form.deadline).format('YYYY-MM-DD') : null,
      color: form.color,
    });
    setForm({ name: '', desc: '', deadline: null, color: '#0D2D1C' });
    setCreating(false);
    setOpenId(p.id);
  };

  if (open) return <ProjectDetail project={open} onBack={() => setOpenId(null)} />;

  return (
    <Stack gap="md">
      <Button
        radius="xl" leftSection={<IconPlus size={16} />} variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }}
        onClick={() => setCreating(true)}
      >
        New project
      </Button>

      <Modal
        opened={creating} onClose={() => setCreating(false)} radius="xl" centered
        title={<Text fw={800} fz={18}>New project</Text>}
      >
        <Stack gap="sm">
          <TextInput
            label="Project name" placeholder="e.g. LMS platform v2" radius="md" data-autofocus required
            value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            onKeyDown={(e) => e.key === 'Enter' && createProject()}
          />
          <Textarea
            label="What is this project about?" placeholder="Goals, scope, what done looks like…"
            autosize minRows={2} radius="md"
            value={form.desc} onChange={(e) => setForm({ ...form, desc: e.currentTarget.value })}
          />
          <Group grow>
            <DateInput
              label="Deadline" placeholder="Pick a date" radius="md" clearable
              leftSection={<IconCalendarEvent size={14} />} minDate={new Date()}
              value={form.deadline} onChange={(v) => setForm({ ...form, deadline: v })}
            />
            <ColorInput label="Color tag" radius="md" value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
          </Group>
          <Button radius="xl" color="forest" onClick={createProject} disabled={!form.name.trim()}>
            Create project
          </Button>
        </Stack>
      </Modal>
      {mine.length === 0 && <EmptyState kind="projects" color="#e8590c" title="No projects yet" hint="A project holds tasks, milestones and documents in one place. Say what you're launching and Myth drafts one." />}
      {mine.map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const pct = pt.length ? Math.round((pt.filter((t) => t.status === 'done').length / pt.length) * 100) : 0;
        return (
          <Box key={p.id} className="glass hover-lift" p="md" style={{ borderRadius: 16, cursor: 'pointer' }} onClick={() => setOpenId(p.id)}>
            <Group justify="space-between" mb={6}>
              <Group gap={10}>
                <Box w={12} h={12} style={{ borderRadius: 6, background: p.color }} />
                <Text fw={700} fz={15}>{p.name}</Text>
                {p.status && p.status !== 'active' && (
                  <Badge size="xs" variant="light" color={STATUS_META[p.status]?.color}>{STATUS_META[p.status]?.label}</Badge>
                )}
                <DeadlineBadge deadline={p.deadline} />
              </Group>
              <Menu position="bottom-end" radius="md">
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" onClick={(e) => e.stopPropagation()}><IconDots size={16} /></ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}>
                    Delete project
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
            {p.desc && <Text fz={13} c="dimmed" lineClamp={1} mb={8}>{p.desc}</Text>}
            <Group gap="xs">
              <Progress value={pct} size={7} radius="xl" color={p.color} style={{ flex: 1 }} />
              <Text fz={12} c="dimmed">{pt.filter((t) => t.status === 'done').length}/{pt.length} tasks</Text>
            </Group>
          </Box>
        );
      })}
    </Stack>
  );
}
