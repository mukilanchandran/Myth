// The right-hand icon rail (desktop navigation): home on top, the main
// modules, the More menu, then settings and lock. Sized to its icons and flush
// with the canvas edge. Talking to Myth happens in the capture bar.
import { Tooltip, Popover, SimpleGrid, Text, ThemeIcon } from '@mantine/core';
import {
  IconHome, IconChecklist, IconFolders, IconCalendarMonth, IconRepeat, IconWallet,
  IconChartAreaLine, IconGridDots, IconSchool, IconCloudLock, IconSettings, IconLogout, IconLayoutDashboard, IconBellRinging, IconClockPlay,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useStore } from '../store/useStore';

const MAIN = [
  { key: 'tasks', label: 'Tasks', icon: IconChecklist },
  { key: 'projects', label: 'Projects', icon: IconFolders },
  { key: 'calendar', label: 'Calendar', icon: IconCalendarMonth },
];
// everything else lives behind the grid-dots button (the Planner moved into
// the capture bar's mode dial — it is a way of typing, not a place)
const MORE = [
  { key: 'track', label: 'Track', icon: IconClockPlay, color: '#0f8a7e' },
  { key: 'reminders', label: 'Reminders', icon: IconBellRinging, color: '#e03131' },
  { key: 'habits', label: 'Habits', icon: IconRepeat, color: '#0D2D1C' },
  { key: 'finance', label: 'Finance', icon: IconWallet, color: '#e8590c' },
  { key: 'reports', label: 'Monthly report', icon: IconChartAreaLine, color: '#5f3dc4' },
  { key: 'today', label: 'Daily planner', icon: IconLayoutDashboard, color: '#0D2D1C' },
  { key: 'learning', label: 'Learning', icon: IconSchool, color: '#e8590c' },
  { key: 'drive', label: 'Drive', icon: IconCloudLock, color: '#1971c2' },
];

function RailButton({ item, active, onOpen, badge }) {
  const Icon = item.icon;
  return (
    <Tooltip label={item.label} position="left" offset={10}>
      <button type="button" className="rail-btn" data-active={active || undefined} onClick={() => onOpen(item.key)} aria-label={item.label}>
        <Icon size={21} stroke={1.9} />
        {badge > 0 && <span className="rail-badge">{badge}</span>}
      </button>
    </Tooltip>
  );
}

export default function Rail({ active, onOpen }) {
  const logout = useStore((s) => s.logout);
  const openTasks = useStore((s) => s.tasks.filter((t) => t.status !== 'done' && t.due && t.due <= new Date().toISOString().slice(0, 10)).length);
  const [more, setMore] = useState(false);
  const moreActive = MORE.some((i) => i.key === active);

  return (
    <nav className="rail" aria-label="Sections">
      <Tooltip label="Home" position="left" offset={10}>
        <button type="button" className="rail-btn rail-home" data-active={!active || undefined} onClick={() => onOpen(null)} aria-label="Home">
          <IconHome size={21} stroke={2} />
        </button>
      </Tooltip>
      <div className="rail-sep" />
      {MAIN.map((it) => <RailButton key={it.key} item={it} active={active === it.key} onOpen={onOpen} badge={it.key === 'tasks' ? openTasks : 0} />)}
      <Popover opened={more} onChange={setMore} position="left" radius="lg" shadow="xl" width={300}>
        <Popover.Target>
          <button type="button" className="rail-btn" data-active={moreActive || undefined} onClick={() => setMore((o) => !o)} aria-label="More sections">
            <IconGridDots size={21} stroke={1.9} />
          </button>
        </Popover.Target>
        <Popover.Dropdown p="sm">
          <SimpleGrid cols={2} spacing={8}>
            {MORE.map(({ key, label, icon: Icon, color }) => (
              <button key={key} type="button" className="mobile-more-item" data-active={active === key || undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', background: '#f7f9f8' }} onClick={() => { setMore(false); onOpen(key); }}>
                <ThemeIcon size={30} radius="xl" variant="light" color="gray" style={{ background: `${color}18` }}><Icon size={16} color={color} /></ThemeIcon>
                <Text fz={12.5} fw={600}>{label}</Text>
              </button>
            ))}
          </SimpleGrid>
        </Popover.Dropdown>
      </Popover>
      <div className="rail-sep" />
      <RailButton item={{ key: 'settings', label: 'Settings', icon: IconSettings }} active={active === 'settings'} onOpen={onOpen} />
      <Tooltip label="Lock" position="left" offset={10}>
        <button type="button" className="rail-btn" onClick={logout} aria-label="Lock"><IconLogout size={20} stroke={1.9} /></button>
      </Tooltip>
    </nav>
  );
}
