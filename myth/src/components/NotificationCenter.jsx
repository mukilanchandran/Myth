// The bell: every notification with its reasoning and a way to act, snooze or
// dismiss it. Nothing here is a bare "task due tomorrow".
import { Stack, Group, Text, Box, Badge, Button, Tooltip, ActionIcon } from '@mantine/core';
import {
  IconAlertTriangle, IconHourglass, IconTargetArrow, IconBrain, IconCar, IconArrowForwardUp, IconCreditCard,
  IconFlame, IconCake, IconClockPause, IconChecklist, IconBellZ, IconX, IconCircleCheck,
} from '@tabler/icons-react';
import { notifications as toast } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { visibleNotifications, performAction } from '../ai/notifications.js';

const KIND_ICON = {
  room: IconHourglass, overbooked: IconAlertTriangle, overdue: IconAlertTriangle, deadline: IconTargetArrow,
  prep: IconBrain, travel: IconCar, followup: IconArrowForwardUp, bill: IconCreditCard, habit: IconFlame,
  birthday: IconCake, stale: IconClockPause, plan: IconChecklist,
};
const LEVEL_META = {
  act: { color: '#e03131', label: 'act now' },
  plan: { color: '#f08c00', label: 'decide today' },
  fyi: { color: '#868e96', label: 'fyi' },
};

export default function NotificationCenter({ onNavigate }) {
  const state = useStore();
  const ui = useUI();
  const list = visibleNotifications(state);

  const snooze = (n) => {
    state.muteNotification(n.key, dayjs().add(1, 'day').hour(8).minute(0).second(0).toISOString(), null);
    toast.show({ color: 'gray', message: 'Snoozed until tomorrow 08:00.' });
  };
  const dismiss = (n) => state.muteNotification(n.key, dayjs().add(30, 'day').toISOString(), n.fp);
  const act = (n) => {
    const msg = performAction(n.action, useStore, ui);
    if (msg) toast.show({ color: 'forest', title: 'Done', message: msg });
    onNavigate?.();
  };

  if (!list.length) {
    return (
      <Group gap={8} py={4}>
        <IconCircleCheck size={18} color="#0D2D1C" />
        <Text fz={13} c="dimmed">All quiet — nothing worth interrupting you for.</Text>
      </Group>
    );
  }

  return (
    <Stack gap={8}>
      {list.map((n) => {
        const Icon = KIND_ICON[n.kind] ?? IconAlertTriangle;
        const meta = LEVEL_META[n.level] ?? LEVEL_META.fyi;
        return (
          <Box key={n.key} className="glass" p={10} style={{ borderRadius: 12, borderLeft: `3px solid ${meta.color}` }}>
            <Group gap={8} wrap="nowrap" align="flex-start">
              <Icon size={16} color={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} justify="space-between" wrap="nowrap">
                  <Text fz={13.5} fw={700} lh={1.3}>{n.headline}</Text>
                  <Badge size="xs" variant="light" color={n.level === 'act' ? 'red' : n.level === 'plan' ? 'orange' : 'gray'} style={{ flexShrink: 0 }}>{meta.label}</Badge>
                </Group>
                {n.lines.map((l, i) => <Text key={i} fz={12.5} c="dimmed" lh={1.4}>{l}</Text>)}
                <Group gap={6} mt={6} wrap="nowrap">
                  {n.action && (
                    <Button size="compact-xs" radius="xl" variant="light" color={n.level === 'act' ? 'red' : 'forest'} onClick={() => act(n)}>
                      {n.action.label}
                    </Button>
                  )}
                  <Tooltip label="Snooze until tomorrow 08:00">
                    <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => snooze(n)}><IconBellZ size={14} /></ActionIcon>
                  </Tooltip>
                  <Tooltip label="Dismiss — comes back only if the situation changes">
                    <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => dismiss(n)}><IconX size={14} /></ActionIcon>
                  </Tooltip>
                </Group>
              </Box>
            </Group>
          </Box>
        );
      })}
    </Stack>
  );
}
