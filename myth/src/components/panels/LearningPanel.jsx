import { useState } from 'react';
import { Stack, Group, Text, Box, TextInput, Button, ActionIcon, SimpleGrid, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconArrowRight, IconX, IconPlus } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store/useStore';

const STAGES = ['Want to learn', 'Learning', 'Applied', 'Taught / Shared'];
const STAGE_COLORS = ['#8a9691', '#1971c2', '#0D2D1C', '#7048e8'];

export default function LearningPanel() {
  const { learning, addLearning, moveLearning, deleteLearning } = useStore();
  const [title, setTitle] = useState('');

  const add = () => {
    if (!title.trim()) return;
    addLearning(title.trim());
    setTitle('');
  };

  const applied = learning.filter((l) => l.stage >= 2).length;
  const inProgress = learning.filter((l) => l.stage === 1).length;
  const queued = learning.filter((l) => l.stage === 0).length;

  return (
    <Stack gap="md">
      <Text fz={13} c="dimmed" mt={-6}>Nothing counts as learned until it reaches Applied. Move items forward as you grow.</Text>

      <Group gap="xs">
        <TextInput
          style={{ flex: 1 }} radius="xl" placeholder="What do you want to learn next?"
          value={title} onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button radius="xl" color="forest" leftSection={<IconPlus size={15} />} onClick={add}>Add</Button>
      </Group>

      <SimpleGrid cols={2} spacing="sm">
        {STAGES.map((stage, si) => {
          const items = learning.filter((l) => l.stage === si);
          return (
            <Box key={stage} p="sm" style={{ background: '#f7faf8', borderRadius: 16, border: '1px solid #e9eeeb', minHeight: 120 }}>
              <Group justify="space-between" mb={8}>
                <Text fz={11.5} fw={800} tt="uppercase" lts={0.6} c={STAGE_COLORS[si]}>{stage}</Text>
                <Text fz={11.5} fw={700} c="dimmed">{items.length}</Text>
              </Group>
              <Stack gap={6}>
                {items.length === 0 && <Text fz={12} c="dimmed">—</Text>}
                <AnimatePresence>
                  {items.map((l) => (
                    <motion.div
                      key={l.id} layout
                      initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.18 }}
                    >
                      <Box p={10} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5ebe7' }}>
                        <Text fz={13.5} fw={600} lh={1.35} mb={6}>{l.title}</Text>
                        <Group gap={4}>
                          {si > 0 && (
                            <Tooltip label={`Back to ${STAGES[si - 1]}`}>
                              <ActionIcon size="sm" radius="xl" variant="light" color="gray" onClick={() => moveLearning(l.id, -1)}>
                                <IconArrowLeft size={13} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {si < 3 && (
                            <Tooltip label={`Move to ${STAGES[si + 1]}`}>
                              <ActionIcon size="sm" radius="xl" variant="light" color="forest" onClick={() => moveLearning(l.id, 1)}>
                                <IconArrowRight size={13} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          <ActionIcon size="sm" radius="xl" variant="light" color="red" onClick={() => deleteLearning(l.id)}>
                            <IconX size={13} />
                          </ActionIcon>
                        </Group>
                      </Box>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </Stack>
            </Box>
          );
        })}
      </SimpleGrid>

      <div>
        <Text fw={700} fz={14} mb={8}>Learning score</Text>
        <SimpleGrid cols={3} spacing="sm">
          {[
            { n: applied, label: 'Applied in real work', color: '#0D2D1C' },
            { n: inProgress, label: 'In progress', color: '#1971c2' },
            { n: queued, label: 'In the queue', color: '#8a9691' },
          ].map((s) => (
            <Box key={s.label} p="md" style={{ background: '#f7faf8', borderRadius: 16, border: '1px solid #e9eeeb' }}>
              <Text fz={26} fw={900} c={s.color} lh={1}>{s.n}</Text>
              <Text fz={12} c="dimmed" mt={4}>{s.label}</Text>
            </Box>
          ))}
        </SimpleGrid>
      </div>
    </Stack>
  );
}
