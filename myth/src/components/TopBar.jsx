import { Box, Group, Text, SegmentedControl, ActionIcon, Tooltip, Popover, Stack } from '@mantine/core';
import {
  IconSearch, IconBell, IconSettings, IconLogout,
  IconBriefcase, IconHome2,
  IconAlertCircle, IconClockHour4, IconCalendarDue, IconRepeat,
} from '@tabler/icons-react';
import { spotlight } from '@mantine/spotlight';
import { useStore } from '../store/useStore';
import { pendingReminders } from '../notify';
import { eventIcon } from '../icons';
import WeatherChip from './Weather';
import { asset } from '../config/env';

const REMINDER_ICONS = {
  overdue: { icon: IconAlertCircle, color: '#e03131' },
  today: { icon: IconClockHour4, color: '#f08c00' },
  soon: { icon: IconCalendarDue, color: '#12a150' },
  habit: { icon: IconRepeat, color: '#7048e8' },
};

function ReminderIcon({ kind }) {
  const meta = REMINDER_ICONS[kind] ?? eventIcon(kind);
  const Icon = meta.icon;
  return <Icon size={15} color={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />;
}

export default function TopBar({ onOpen }) {
  const { settings, setSettings, logout } = useStore();
  const state = useStore();
  const reminders = pendingReminders(state);

  return (
    <Group justify="space-between" px={{ base: 12, sm: 28 }} py={14} style={{ position: 'relative', zIndex: 5 }}>
      <Group gap={12}>
        <img
          className="top-logo"
          src={asset('logo.png')}
          alt="Myth"
          style={{ height: 34, display: 'block', borderRadius: '50%', filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.35))' }}
        />
        <Box visibleFrom="sm"><WeatherChip /></Box>
      </Group>

      <SegmentedControl
        value={settings.mode}
        onChange={(mode) => setSettings({ mode })}
        radius="xl"
        size="sm"
        data={[
          { value: 'work', label: (<Group gap={6} wrap="nowrap"><IconBriefcase size={15} /><span>Work</span></Group>) },
          { value: 'personal', label: (<Group gap={6} wrap="nowrap"><IconHome2 size={15} /><span>Personal</span></Group>) },
        ]}
        styles={{
          root: { background: 'rgba(255,255,255,0.28)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.45)' },
          indicator: { background: settings.mode === 'work' ? '#0f766e' : '#e8590c' },
          label: { color: '#fff', fontWeight: 600 },
        }}
      />

      <Group gap={8}>
        <Tooltip label="Search everything (Ctrl+K)">
          <ActionIcon size={40} radius="xl" variant="default" onClick={spotlight.open} visibleFrom="sm"
            styles={{ root: { background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.45)', backdropFilter: 'blur(10px)' } }}>
            <IconSearch size={19} color="#fff" />
          </ActionIcon>
        </Tooltip>

        <Popover width={320} position="bottom-end" radius="lg" shadow="xl">
          <Popover.Target>
            <ActionIcon size={40} radius="xl" variant="default"
              styles={{ root: { background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.45)', backdropFilter: 'blur(10px)' } }}>
              <Box pos="relative">
                <IconBell size={19} color="#fff" />
                {reminders.length > 0 && (
                  <Box pos="absolute" top={-4} right={-6} w={16} h={16} bg="red" style={{ borderRadius: 8, fontSize: 10, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                    {reminders.length}
                  </Box>
                )}
              </Box>
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <Text fw={700} fz={14} mb={8}>Smart reminders</Text>
            {reminders.length === 0 ? (
              <Text fz={13} c="dimmed">All clear — nothing needs your attention right now.</Text>
            ) : (
              <Stack gap={8}>
                {reminders.map((r, i) => (
                  <Group key={i} gap={8} wrap="nowrap" align="flex-start">
                    <ReminderIcon kind={r.kind} />
                    <Text fz={13} lh={1.4}>{r.text}</Text>
                  </Group>
                ))}
              </Stack>
            )}
          </Popover.Dropdown>
        </Popover>

        <Tooltip label="Settings">
          <ActionIcon size={40} radius="xl" variant="default" onClick={() => onOpen('settings')}
            styles={{ root: { background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.45)', backdropFilter: 'blur(10px)' } }}>
            <IconSettings size={19} color="#fff" />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Lock">
          <ActionIcon size={40} radius="xl" variant="default" onClick={logout} visibleFrom="sm"
            styles={{ root: { background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.45)', backdropFilter: 'blur(10px)' } }}>
            <IconLogout size={19} color="#fff" />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
