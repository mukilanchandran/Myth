// Settings card for the Notification Intelligence Engine: the lock-screen
// budget, quiet hours, and a live preview of what Myth would say right now.
import { Box, Group, Text, SegmentedControl, Select, Stack, Badge, Divider } from '@mantine/core';
import { IconBrain } from '@tabler/icons-react';
import { useStore } from '../../store/useStore';
import { visibleNotifications, prefsOf } from '../../ai/notifications.js';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));
const LEVEL_COLOR = { act: 'red', plan: 'orange', fyi: 'gray' };

export default function NotificationPrefs({ settings, setSettings }) {
  const state = useStore();
  const prefs = prefsOf(settings);
  const preview = visibleNotifications(state).slice(0, 3);

  return (
    <Box className="glass" p="md" style={{ borderRadius: 16 }}>
      <Group gap={6} mb={4}>
        <IconBrain size={16} color="#7048e8" />
        <Text fw={700} fz={14}>Notification intelligence</Text>
      </Group>
      <Text fz={12.5} c="dimmed" mb="sm">
        Myth interrupts you only when it can say why: what, by when, how long it needs and whether the day has room.
        Everything else waits in the bell, and nothing repeats unless the situation changes.
      </Text>
      <Group gap="md" align="flex-end" wrap="wrap">
        <div>
          <Text fz={12} fw={600} mb={4}>Lock-screen budget per day</Text>
          <SegmentedControl
            size="xs" radius="xl" value={String(prefs.notifyBudget)}
            onChange={(v) => setSettings({ notifyBudget: Number(v) })}
            data={[{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '6', label: '6' }]}
          />
        </div>
        <Select size="xs" radius="md" label="Quiet from" data={HOURS} value={String(prefs.quietStart)} onChange={(v) => v != null && setSettings({ quietStart: Number(v) })} w={110} allowDeselect={false} />
        <Select size="xs" radius="md" label="until" data={HOURS} value={String(prefs.quietEnd)} onChange={(v) => v != null && setSettings({ quietEnd: Number(v) })} w={110} allowDeselect={false} />
      </Group>
      <Text fz={11.5} c="dimmed" mt={6}>
        Urgent items can arrive any time outside quiet hours; the rest wait for 8:30, 13:00 or 18:30.
      </Text>
      <Divider my="sm" />
      <Text fw={600} fz={12.5} mb={6}>What Myth would say right now</Text>
      {preview.length === 0 ? (
        <Text fz={12.5} c="dimmed">Nothing — a quiet day is a good day.</Text>
      ) : (
        <Stack gap={8}>
          {preview.map((n) => (
            <Box key={n.key}>
              <Group gap={6} wrap="nowrap">
                <Badge size="xs" variant="light" color={LEVEL_COLOR[n.level]}>{n.level}</Badge>
                <Text fz={13} fw={600} lineClamp={1}>{n.headline}</Text>
              </Group>
              <Text fz={12} c="dimmed" lh={1.4}>{n.lines.join(' ')}</Text>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
