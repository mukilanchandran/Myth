import { useMemo, useState } from 'react';
import {
  Stack, Group, Text, Box, Badge, SegmentedControl, ActionIcon, Button, Progress, SimpleGrid, RingProgress,
} from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconRefresh, IconTrophy, IconBulb, IconCalendarStats, IconFlame, IconSparkles } from '@tabler/icons-react';
import { BarChart, DonutChart } from '@mantine/charts';
import dayjs from 'dayjs';
import { motion, AnimatePresence } from 'framer-motion';
import { notifications } from '@mantine/notifications';
import { useStore } from '../../store/useStore';
import { monthStats, narrative } from '../../ai/insights';
import { aiMonthReview } from '../../ai/assistant';
import { habitIcon } from '../../icons';

const COLORS = ['#12a150', '#1971c2', '#e8590c', '#7048e8', '#f08c00', '#e03131', '#0ca678'];

const rise = (i) => ({
  initial: { opacity: 0, y: 26, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { delay: 0.1 + i * 0.12, duration: 0.55, ease: [0.22, 1, 0.36, 1] },
});

function BigStat({ label, value, suffix, color, i }) {
  return (
    <motion.div {...rise(i)}>
      <Box className="glass" p="md" ta="center" style={{ borderRadius: 18 }}>
        <Text fz={30} fw={900} c={color} lh={1}>
          <Counter target={value} />{suffix}
        </Text>
        <Text fz={12} c="dimmed" fw={600} mt={4}>{label}</Text>
      </Box>
    </motion.div>
  );
}

function Counter({ target }) {
  // animated count-up via framer-motion spring text
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <motion.span
        initial={{ '--n': 0 }}
        animate={{ '--n': target }}
        transition={{ duration: 1.1, ease: 'easeOut' }}
      >
        {target}
      </motion.span>
    </motion.span>
  );
}

export default function ReportsPanel() {
  const state = useStore();
  const [mode, setMode] = useState(state.settings.mode);
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [regenKey, setRegenKey] = useState(0);
  const [aiText, setAiText] = useState(null);
  const [aiModel, setAiModel] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  const stats = useMemo(
    () => monthStats(state, mode, month.format('YYYY-MM-DD')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tasks, state.notes, state.transactions, state.habits, state.journal, mode, month, regenKey]
  );
  const story = narrative(stats, mode, 'Boss');

  const writeWithAI = async () => {
    setAiBusy(true);
    setAiText('');
    try {
      const result = await aiMonthReview(stats, mode, state, (t) => setAiText(t));
      if (!result) {
        setAiText(null);
        notifications.show({
          color: 'orange', title: 'AI model not reachable',
          message: 'Start Ollama on this device (Settings → AI brain) and try again.',
        });
      } else {
        setAiText(result.text);
        setAiModel(result.model);
      }
    } catch (e) {
      setAiText(null);
      notifications.show({ color: 'red', title: 'AI narrative failed', message: e.message });
    } finally {
      setAiBusy(false);
    }
  };

  const switchReport = (fn) => { setAiText(null); setAiModel(null); fn(); };

  return (
    <Stack gap="lg" pb="xl">
      <Group justify="space-between" wrap="wrap">
        <Group gap={6}>
          <ActionIcon variant="subtle" radius="xl" onClick={() => switchReport(() => setMonth(month.subtract(1, 'month')))}><IconChevronLeft size={18} /></ActionIcon>
          <Text fw={800} fz={18} w={160} ta="center">{month.format('MMMM YYYY')}</Text>
          <ActionIcon variant="subtle" radius="xl" disabled={month.add(1, 'month').isAfter(dayjs())} onClick={() => switchReport(() => setMonth(month.add(1, 'month')))}>
            <IconChevronRight size={18} />
          </ActionIcon>
        </Group>
        <Group gap="xs">
          <SegmentedControl
            value={mode} onChange={(v) => switchReport(() => setMode(v))} radius="xl" size="xs"
            data={[{ value: 'work', label: 'Work' }, { value: 'personal', label: 'Personal' }]}
          />
          <Button size="xs" radius="xl" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => switchReport(() => setRegenKey((k) => k + 1))}>
            Regenerate
          </Button>
          <Button
            size="xs" radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }}
            leftSection={<IconSparkles size={14} />} loading={aiBusy} onClick={writeWithAI}
          >
            Write with AI
          </Button>
        </Group>
      </Group>

      <AnimatePresence mode="wait">
        <motion.div key={`${mode}${month}${regenKey}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <Stack gap="lg">
            {/* Narrative */}
            <motion.div {...rise(0)}>
              <Box className="glass" p="lg" style={{ borderRadius: 20 }}>
                <Group gap={8} mb={8}>
                  <IconCalendarStats size={18} color="#12a150" />
                  <Text fw={800} fz={15}>Myth's month-in-review</Text>
                  {aiText !== null
                    ? <Badge size="xs" variant="light" color="grape">{aiModel ? `AI · ${aiModel}` : 'AI writing…'}</Badge>
                    : <Badge size="xs" variant="light" color="teal">auto generated</Badge>}
                </Group>
                {aiText !== null ? (
                  <Text fz={13.5} lh={1.6} style={{ whiteSpace: 'pre-line' }}>
                    {aiText || 'Thinking about your month…'}
                  </Text>
                ) : (
                  <Stack gap={6}>
                    {story.map((line, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.14 }}>
                        <Text fz={13.5} lh={1.5}>{line}</Text>
                      </motion.div>
                    ))}
                  </Stack>
                )}
              </Box>
            </motion.div>

            {/* Big numbers */}
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              <BigStat i={1} label="Tasks completed" value={stats.completed} color="#0b7a3e" />
              <BigStat i={2} label="Completion rate" value={stats.completionRate} suffix="%" color="#1971c2" />
              <BigStat i={3} label="Meetings logged" value={stats.meetings} color="#7048e8" />
              <BigStat i={4} label="Ideas captured" value={stats.ideas} color="#f08c00" />
            </SimpleGrid>

            {/* Weekly trend */}
            <motion.div {...rise(2)}>
              <Box className="glass" p="lg" style={{ borderRadius: 20 }}>
                <Text fw={700} fz={14} mb="sm">Weekly rhythm — created vs completed</Text>
                <BarChart
                  h={190}
                  data={stats.weekly}
                  dataKey="week"
                  series={[
                    { name: 'created', color: '#a8dcbc' },
                    { name: 'completed', color: '#12a150' },
                  ]}
                  radius={6}
                  withLegend
                />
              </Box>
            </motion.div>

            {/* Projects */}
            {stats.projectProgress.filter((p) => p.total > 0).length > 0 && (
              <motion.div {...rise(3)}>
                <Box className="glass" p="lg" style={{ borderRadius: 20 }}>
                  <Group gap={8} mb="sm"><IconTrophy size={17} color="#f08c00" /><Text fw={700} fz={14}>Project progress</Text></Group>
                  <Stack gap="sm">
                    {stats.projectProgress.filter((p) => p.total > 0).map((p, i) => (
                      <div key={p.name}>
                        <Group justify="space-between" mb={4}>
                          <Text fz={13.5} fw={600}>{p.name}</Text>
                          <Text fz={12.5} c="dimmed">{p.done}/{p.total} · {p.pct}%</Text>
                        </Group>
                        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.5 + i * 0.15, duration: 0.7, ease: 'easeOut' }} style={{ transformOrigin: 'left' }}>
                          <Progress value={p.pct} size={9} radius="xl" color={COLORS[i % COLORS.length]} />
                        </motion.div>
                      </div>
                    ))}
                  </Stack>
                </Box>
              </motion.div>
            )}

            {/* Personal extras */}
            {mode === 'personal' && (
              <>
                {(stats.spent > 0 || stats.earned > 0) && (
                  <motion.div {...rise(4)}>
                    <Box className="glass" p="lg" style={{ borderRadius: 20 }}>
                      <Text fw={700} fz={14} mb="sm">Money flow</Text>
                      <Group align="center" gap="xl" wrap="wrap">
                        {stats.expenseByCategory.length > 0 && (
                          <DonutChart
                            size={150} thickness={24} withTooltip
                            data={stats.expenseByCategory.map((c, i) => ({ ...c, color: COLORS[i % COLORS.length] }))}
                          />
                        )}
                        <Stack gap={6}>
                          <Text fz={14}>Earned <b style={{ color: '#0b7a3e' }}>₹{stats.earned.toLocaleString('en-IN')}</b></Text>
                          <Text fz={14}>Spent <b style={{ color: '#c92a2a' }}>₹{stats.spent.toLocaleString('en-IN')}</b></Text>
                          <Text fz={14}>{stats.savings >= 0 ? 'Saved' : 'Overspent'} <b>₹{Math.abs(stats.savings).toLocaleString('en-IN')}</b></Text>
                        </Stack>
                      </Group>
                    </Box>
                  </motion.div>
                )}
                {stats.habitStats?.length > 0 && (
                  <motion.div {...rise(5)}>
                    <Box className="glass" p="lg" style={{ borderRadius: 20 }}>
                      <Group gap={8} mb="sm"><IconFlame size={17} color="#e8590c" /><Text fw={700} fz={14}>Habit consistency — {stats.habitConsistency}%</Text></Group>
                      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
                        {stats.habitStats.map((h, i) => {
                          const HIcon = habitIcon(h.icon);
                          return (
                            <motion.div key={h.name} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 + i * 0.1 }}>
                              <Group gap={8} wrap="nowrap">
                                <RingProgress size={52} thickness={6} roundCaps sections={[{ value: h.pct, color: h.pct >= 60 ? '#12a150' : '#f08c00' }]}
                                  label={<Text ta="center" fz={10} fw={700}>{h.pct}%</Text>} />
                                <HIcon size={15} color="#0f766e" style={{ flexShrink: 0 }} />
                                <Text fz={12.5}>{h.name}</Text>
                              </Group>
                            </motion.div>
                          );
                        })}
                      </SimpleGrid>
                    </Box>
                  </motion.div>
                )}
              </>
            )}

            {/* Top wins */}
            {stats.topTasks.length > 0 && (
              <motion.div {...rise(6)}>
                <Box className="glass" p="lg" style={{ borderRadius: 20 }}>
                  <Group gap={8} mb="sm"><IconBulb size={17} color="#12a150" /><Text fw={700} fz={14}>Highlights shipped</Text></Group>
                  <Stack gap={6}>
                    {stats.topTasks.map((t) => (
                      <Group key={t.id} gap={8} wrap="nowrap">
                        <IconTrophy size={14} color="#f08c00" style={{ flexShrink: 0 }} />
                        <Text fz={13.5}>{t.title}</Text>
                      </Group>
                    ))}
                  </Stack>
                </Box>
              </motion.div>
            )}
          </Stack>
        </motion.div>
      </AnimatePresence>
    </Stack>
  );
}
