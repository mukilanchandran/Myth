// The Context Engine's next briefing, shown above the landing-page widgets:
// "Tomorrow 10:00 · Client meeting — 4 open tasks · 2 documents · 3 unresolved
// actions · Prepare for meeting →". Disappears when there is nothing to say.
import { useMemo } from 'react';
import { Box, Group, Text, Badge, Button } from '@mantine/core';
import { IconBrain, IconChevronRight } from '@tabler/icons-react';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { nextBriefing } from '../ai/context';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ContextStrip() {
  const state = useStore();
  const openContext = useUI((s) => s.openContext);
  const brief = useMemo(
    () => nextBriefing(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tasks, state.notes, state.events, state.projects, state.files, state.drive, state.plans],
  );
  if (!brief) return null;

  const { ctx, kind } = brief;
  const c = ctx.counts;
  const chips = [];
  if (c.openTasks) chips.push({ text: plural(c.openTasks, 'open task'), color: 'green' });
  if (c.documents) chips.push({ text: plural(c.documents, 'document'), color: 'blue' });
  if (c.unresolvedActions) chips.push({ text: plural(c.unresolvedActions, 'unresolved action'), color: 'orange' });
  if (ctx.travel?.leaveBy) chips.push({ text: `leave by ${ctx.travel.leaveBy}`, color: 'grape' });
  if (kind === 'followup') chips.push({ text: 'no follow-up yet', color: 'red' });

  const eyebrow = kind === 'followup'
    ? 'Needs a follow-up'
    : `${ctx.when.rel}${ctx.when.time ? ` · ${ctx.when.time}` : ''}`;

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <Box maw={1400} mx="auto" px={{ base: 12, sm: 24 }} mb="md">
        <Box
          className="glass-strong hover-lift"
          px="md" py={10}
          style={{ borderRadius: 20, cursor: 'pointer' }}
          onClick={() => openContext(ctx.node.id)}
        >
          <Group justify="space-between" wrap="wrap" gap={10}>
            <Group gap={10} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
              <Box style={{ width: 34, height: 34, borderRadius: 12, background: 'linear-gradient(135deg, #7048e8, #5f3dc4)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <IconBrain size={18} color="#fff" />
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Text fz={11} fw={700} tt="uppercase" lts={0.6} c="dimmed">{eyebrow}</Text>
                <Text fz={14.5} fw={700} lineClamp={1}>{ctx.node.label}</Text>
              </Box>
            </Group>
            <Group gap={6} wrap="wrap">
              {chips.map((ch) => (
                <Badge key={ch.text} variant="light" color={ch.color} size="sm" radius="xl" style={{ textTransform: 'none' }}>{ch.text}</Badge>
              ))}
              {chips.length === 0 && <Text fz={12} c="dimmed">nothing linked yet</Text>}
              <Button size="xs" radius="xl" variant="gradient" gradient={{ from: '#7048e8', to: '#5f3dc4' }} rightSection={<IconChevronRight size={14} />}>
                {kind === 'followup' ? 'Add follow-up' : 'Prepare for meeting'}
              </Button>
            </Group>
          </Group>
        </Box>
      </Box>
    </motion.div>
  );
}
