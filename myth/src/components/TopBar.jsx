// Top of the canvas: brand on the left; weather, search and the bell tucked
// into the right corner (settings joins them on phones, where there is no rail).
import { useState } from 'react';
import { Box, Group, Text, Popover, Tooltip } from '@mantine/core';
import { IconSearch, IconBell, IconSettings } from '@tabler/icons-react';
import { spotlight } from '@mantine/spotlight';
import { useStore } from '../store/useStore';
import { visibleNotifications } from '../ai/notifications.js';
import NotificationCenter from './NotificationCenter';
import WeatherChip from './Weather';
import SyncBadge from './SyncBadge';
import { asset, APP_NAME } from '../config/env';

export default function TopBar({ onOpen, desktop }) {
  const state = useStore();
  const [open, setOpen] = useState(false);
  // the bell shows what the Notification Intelligence Engine has a reason for;
  // the badge counts only what needs a decision
  const notifs = visibleNotifications(state);
  const count = notifs.filter((n) => n.level !== 'fyi').length;

  return (
    <div className="canvas-top">
      <div className="canvas-brand">
        <img className="top-logo" src={asset('logo.png')} alt={APP_NAME} style={{ height: 34, display: 'block', borderRadius: '50%' }} />
        {desktop && <span>{APP_NAME}</span>}
      </div>

      <div className="canvas-top-actions">
        <Box visibleFrom="sm"><WeatherChip /></Box>
        <SyncBadge />

        <Tooltip label="Search everything (Ctrl K)">
          <button type="button" className="canvas-icon-btn" onClick={spotlight.open} aria-label="Search">
            <IconSearch size={19} />
          </button>
        </Tooltip>

        <Popover width="min(380px, calc(100vw - 24px))" position="bottom-end" radius="lg" shadow="xl" opened={open} onChange={setOpen}>
          <Popover.Target>
            <button type="button" className="canvas-icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
              <IconBell size={19} />
              {count > 0 && <span className="rail-badge">{count}</span>}
            </button>
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

        {!desktop && (
          <Tooltip label="Settings">
            <button type="button" className="canvas-icon-btn" onClick={() => onOpen('settings')} aria-label="Settings"><IconSettings size={19} /></button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
