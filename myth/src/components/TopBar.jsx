import { useState } from 'react';
import { Box, Group, Text, ActionIcon, Tooltip, Popover } from '@mantine/core';
import { IconSearch, IconBell, IconSettings, IconLogout } from '@tabler/icons-react';
import { spotlight } from '@mantine/spotlight';
import { useStore } from '../store/useStore';
import { visibleNotifications } from '../ai/notifications.js';
import NotificationCenter from './NotificationCenter';
import WeatherChip from './Weather';
import { asset } from '../config/env';

const glassBtn = { root: { background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.45)', backdropFilter: 'blur(10px)' } };

export default function TopBar({ onOpen }) {
  const state = useStore();
  const { logout } = state;
  const [open, setOpen] = useState(false);
  // the bell shows what the Notification Intelligence Engine has a reason for;
  // the badge counts only what needs a decision
  const notifs = visibleNotifications(state);
  const count = notifs.filter((n) => n.level !== 'fyi').length;

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

      <Group gap={8}>
        <Tooltip label="Search everything (Ctrl+K)">
          <ActionIcon size={40} radius="xl" variant="default" onClick={spotlight.open} visibleFrom="sm" styles={glassBtn}>
            <IconSearch size={19} color="#fff" />
          </ActionIcon>
        </Tooltip>

        <Popover width="min(380px, calc(100vw - 24px))" position="bottom-end" radius="lg" shadow="xl" opened={open} onChange={setOpen}>
          <Popover.Target>
            <ActionIcon size={40} radius="xl" variant="default" styles={glassBtn} onClick={() => setOpen((o) => !o)} aria-label="Notifications">
              <Box pos="relative">
                <IconBell size={19} color="#fff" />
                {count > 0 && (
                  <Box pos="absolute" top={-4} right={-6} w={16} h={16} bg="red" style={{ borderRadius: 8, fontSize: 10, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                    {count}
                  </Box>
                )}
              </Box>
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown p="sm">
            <Group justify="space-between" mb={8}>
              <Text fw={700} fz={14}>Worth your attention</Text>
              {notifs.length > 0 && <Text fz={11} c="dimmed">{count} to act on · {notifs.length - count} fyi</Text>}
            </Group>
            <Box className="scroll-y" style={{ maxHeight: 'min(70vh, 540px)' }}>
              <NotificationCenter onNavigate={() => setOpen(false)} />
            </Box>
          </Popover.Dropdown>
        </Popover>

        <Tooltip label="Settings">
          <ActionIcon size={40} radius="xl" variant="default" onClick={() => onOpen('settings')} styles={glassBtn}>
            <IconSettings size={19} color="#fff" />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Lock">
          <ActionIcon size={40} radius="xl" variant="default" onClick={logout} visibleFrom="sm" styles={glassBtn}>
            <IconLogout size={19} color="#fff" />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
