// "I created a proposed plan. [Create project]" — the confirmation sheet for
// automatic project creation. Opens whenever the store holds a pending
// proposal (from the capture bar or the assistant). The template plan shows
// instantly; if a model is reachable it tailors the tasks in the background
// and the sheet swaps them in, unless the user has already started editing.
// Nothing touches the store until "Create project".
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Stack, Group, Text, TextInput, Button, Checkbox, Badge, Box, Loader } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { IconSparkles, IconFolderPlus, IconCalendarDue } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { buildPlan } from '../ai/projectPlanner';
import { aiProjectPlan } from '../ai/assistant';
import { APP_NAME } from '../config/env';

export default function ProjectProposal() {
  const proposal = useStore((s) => s.pendingProposal);
  const discardProposal = useStore((s) => s.discardProposal);
  const createProposedProject = useStore((s) => s.createProposedProject);
  const setPanel = useUI((s) => s.setPanel);
  const mobile = useMediaQuery('(max-width: 768px)');

  const [name, setName] = useState('');
  const [deadline, setDeadline] = useState(null);
  const [milestones, setMilestones] = useState(null); // template-level list, null = the built-in template
  const [source, setSource] = useState('template');
  const [excluded, setExcluded] = useState(() => new Set());
  const [refining, setRefining] = useState(false);
  const touched = useRef(false);

  // a new proposal resets the sheet and asks the model for a tailored version
  useEffect(() => {
    if (!proposal) return undefined;
    setName(proposal.plan.name);
    setDeadline(proposal.plan.deadline);
    setMilestones(null);
    setSource('template');
    setExcluded(new Set());
    touched.current = false;
    let alive = true;
    setRefining(true);
    aiProjectPlan(proposal.intent, useStore.getState()).then((tailored) => {
      if (!alive) return;
      setRefining(false);
      if (tailored && !touched.current) { setMilestones(tailored); setSource('ai'); }
    });
    return () => { alive = false; };
  }, [proposal]);

  // the schedule follows the deadline and name live; ids are positional so ticks survive
  const plan = useMemo(
    () => (proposal ? buildPlan(proposal.intent, dayjs(), { name: name.trim() || proposal.plan.name, deadline: deadline ?? proposal.plan.deadline, milestones: milestones ?? undefined, source }) : null),
    [proposal, name, deadline, milestones, source]
  );

  if (!proposal || !plan) return null;

  const allIds = plan.milestones.flatMap((m) => m.tasks.map((t) => t.id));
  const selectedCount = allIds.filter((id) => !excluded.has(id)).length;
  const toggleTask = (id) => {
    touched.current = true;
    setExcluded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleMilestone = (m) => {
    touched.current = true;
    const ids = m.tasks.map((t) => t.id);
    const allOn = ids.every((id) => !excluded.has(id));
    setExcluded((prev) => { const next = new Set(prev); ids.forEach((id) => (allOn ? next.add(id) : next.delete(id))); return next; });
  };

  const create = () => {
    const selected = new Set(allIds.filter((id) => !excluded.has(id)));
    const res = createProposedProject(plan, selected);
    if (!res) return;
    notifications.show({
      title: `Project "${res.project.name}" created`,
      message: `${res.milestoneCount} milestones · ${res.taskCount} tasks · deadline ${dayjs(plan.deadline).format('MMM D')}. Opening Projects.`,
      color: 'forest',
    });
    setPanel('projects');
  };

  return (
    <Modal
      opened onClose={discardProposal} size="lg" radius="xl" centered={!mobile} fullScreen={mobile}
      title={(
        <div>
          <Group gap={6}>
            <IconSparkles size={16} color="#12a150" />
            <Text fw={800} fz={18}>{APP_NAME} drafted a plan</Text>
          </Group>
          <Text fz={12.5} c="dimmed" mt={2}>Nothing is created yet. Untick what you don't need, then create the project.</Text>
        </div>
      )}
    >
      <Stack gap="md">
        <Group grow align="flex-end">
          <TextInput label="Project" radius="md" value={name} onChange={(e) => { touched.current = true; setName(e.currentTarget.value); }} />
          <DateInput
            label="Deadline" radius="md" leftSection={<IconCalendarDue size={15} />} minDate={new Date()}
            value={deadline ? dayjs(deadline).toDate() : null}
            onChange={(v) => { if (v) { touched.current = true; setDeadline(dayjs(v).format('YYYY-MM-DD')); } }}
          />
        </Group>
        <Group gap={8}>
          <Badge variant="light" color="gray">{plan.templateLabel}</Badge>
          {refining ? (
            <Group gap={5}>
              <Loader size={11} color="forest" />
              <Text fz={11.5} c="dimmed">{APP_NAME} is tailoring the tasks…</Text>
            </Group>
          ) : source === 'ai' ? (
            <Badge variant="light" color="forest" leftSection={<IconSparkles size={10} />}>tailored by {APP_NAME}</Badge>
          ) : null}
          {proposal.intent.deadlineGuessed && (
            <Text fz={11.5} c="dimmed">No date in your sentence — {plan.horizonWeeks} weeks assumed. Change it above.</Text>
          )}
        </Group>

        <Stack gap="sm" className="scroll-y" style={{ maxHeight: mobile ? undefined : '46vh' }}>
          {plan.milestones.map((m, mi) => {
            const ids = m.tasks.map((t) => t.id);
            const on = ids.filter((id) => !excluded.has(id)).length;
            return (
              <Box key={m.id} className="glass" p="sm" style={{ borderRadius: 14 }}>
                <Group justify="space-between" mb={6} wrap="nowrap">
                  <Group gap={8} wrap="nowrap">
                    <Checkbox size="sm" radius="xl" color="forest" checked={on === ids.length} indeterminate={on > 0 && on < ids.length} onChange={() => toggleMilestone(m)} />
                    <Text fw={700} fz={14}>{mi + 1}. {m.title}</Text>
                  </Group>
                  <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>by {dayjs(m.due).format('MMM D')}</Badge>
                </Group>
                <Stack gap={4} pl={26}>
                  {m.tasks.map((t) => {
                    const off = excluded.has(t.id);
                    return (
                      <Group key={t.id} gap={8} wrap="nowrap">
                        <Checkbox size="xs" radius="xl" color="forest" checked={!off} onChange={() => toggleTask(t.id)} />
                        <Text fz={13} style={{ flex: 1, minWidth: 0 }} c={off ? 'dimmed' : undefined} td={off ? 'line-through' : undefined}>{t.title}</Text>
                        <Text fz={11.5} c="dimmed" style={{ flexShrink: 0 }}>{dayjs(t.due).format('MMM D')}</Text>
                      </Group>
                    );
                  })}
                </Stack>
              </Box>
            );
          })}
        </Stack>

        <Group justify="space-between" align="center">
          <Text fz={12.5} c="dimmed">{plan.milestones.length} milestones · {selectedCount} of {plan.taskCount} tasks</Text>
          <Group gap={8}>
            <Button variant="subtle" color="gray" radius="xl" onClick={discardProposal}>Not now</Button>
            <Button
              radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }}
              leftSection={<IconFolderPlus size={16} />} onClick={create} disabled={!name.trim()}
            >
              Create project
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
