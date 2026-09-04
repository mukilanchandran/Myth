import { useState } from 'react';
import { Stack, Group, Text, ActionIcon, TextInput, Button, Box, RingProgress, Tooltip, ThemeIcon } from '@mantine/core';
import { IconPlus, IconTrash, IconFlame } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { HABIT_ICONS, habitIcon } from '../../icons';

export default function HabitsPanel() {
  const { habits, addHabit, toggleHabit, deleteHabit } = useStore();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('spark');

  const days = Array.from({ length: 7 }, (_, i) => dayjs().subtract(6 - i, 'day'));

  const add = () => {
    if (!name.trim()) return;
    addHabit({ name: name.trim(), icon });
    setName('');
  };

  return (
    <Stack gap="md">
      <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
        <Group gap={4} mb="xs" wrap="wrap">
          {Object.entries(HABIT_ICONS).map(([key, Icon]) => (
            <Tooltip key={key} label={key}>
              <ActionIcon
                size="md" radius="xl"
                variant={icon === key ? 'filled' : 'subtle'}
                color="forest"
                onClick={() => setIcon(key)}
              >
                <Icon size={16} />
              </ActionIcon>
            </Tooltip>
          ))}
        </Group>
        <Group gap="xs">
          <TextInput
            style={{ flex: 1 }} radius="xl" placeholder="New habit…" value={name}
            onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button radius="xl" leftSection={<IconPlus size={15} />} onClick={add}>Add</Button>
        </Group>
      </Box>

      {habits.length === 0 && <Text c="dimmed" ta="center" py="xl" fz={14}>Build your streaks — add a habit above.</Text>}

      {habits.map((h) => {
        const HIcon = habitIcon(h.icon);
        const last30 = Array.from({ length: 30 }, (_, i) => dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
        const rate = Math.round((last30.filter((d) => h.log[d]).length / 30) * 100);
        // current streak
        let streak = 0;
        for (let i = 0; ; i++) {
          const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
          if (h.log[d]) streak++;
          else if (i === 0) continue; // today not done yet doesn't break streak
          else break;
        }
        return (
          <Box key={h.id} className="glass" p="md" style={{ borderRadius: 16 }}>
            <Group justify="space-between" mb={10}>
              <Group gap={10}>
                <ThemeIcon size={38} radius="xl" variant="light" color="forest">
                  <HIcon size={20} />
                </ThemeIcon>
                <div>
                  <Text fw={700} fz={14.5}>{h.name}</Text>
                  <Group gap={4}>
                    <IconFlame size={13} color="#e8590c" />
                    <Text fz={12} c="dimmed">{streak}-day streak · {rate}% this month</Text>
                  </Group>
                </div>
              </Group>
              <Group gap={6}>
                <RingProgress size={44} thickness={5} roundCaps sections={[{ value: rate, color: rate >= 70 ? '#12a150' : rate >= 40 ? '#f08c00' : '#e03131' }]} />
                <ActionIcon variant="subtle" color="red" onClick={() => deleteHabit(h.id)}><IconTrash size={15} /></ActionIcon>
              </Group>
            </Group>
            <Group gap={6} justify="space-between">
              {days.map((d) => {
                const key = d.format('YYYY-MM-DD');
                const done = !!h.log[key];
                const isToday = d.isSame(dayjs(), 'day');
                return (
                  <Tooltip key={key} label={d.format('ddd, MMM D')}>
                    <Box
                      onClick={() => toggleHabit(h.id, key)}
                      style={{
                        width: 40, height: 48, borderRadius: 12, cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        background: done ? 'linear-gradient(135deg,#12a150,#0f766e)' : 'rgba(255,255,255,0.5)',
                        border: isToday ? '2px solid #0f766e' : '1px solid rgba(20,60,40,0.15)',
                        color: done ? '#fff' : '#334',
                        transition: 'all 140ms ease',
                      }}
                    >
                      <Text fz={10} fw={600} opacity={0.8}>{d.format('dd')}</Text>
                      <Text fz={13} fw={800}>{d.format('D')}</Text>
                    </Box>
                  </Tooltip>
                );
              })}
            </Group>
          </Box>
        );
      })}
    </Stack>
  );
}
