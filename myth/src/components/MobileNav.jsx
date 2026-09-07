// Mobile bottom navigation — native-app-style tab bar.
// Four primary tabs + a raised center chat button; "More" opens a sheet with
// every remaining section as a touch-friendly grid.
import { useState } from 'react';
import { Box, Drawer, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import {
  IconLayoutDashboard, IconChecklist, IconFolders, IconGridDots,
  IconNotes, IconCalendarMonth, IconChartAreaLine, IconWallet,
  IconRepeat, IconSchool, IconCloudLock, IconSettings,
  IconRobotFace, IconBrain, IconCompass,
} from '@tabler/icons-react';

const PRIMARY = [
  { key: 'today', label: 'Today', icon: IconLayoutDashboard },
  { key: 'tasks', label: 'Tasks', icon: IconChecklist },
  { key: 'assistant', label: 'Myth', icon: IconRobotFace, center: true },
  { key: 'projects', label: 'Projects', icon: IconFolders },
  { key: 'more', label: 'More', icon: IconGridDots },
];

const MORE = [
  { key: 'context', label: 'Context', icon: IconBrain, color: '#7048e8' },
  { key: 'notes', label: 'Notes & Ideas', icon: IconNotes, color: '#7048e8' },
  { key: 'drive', label: 'Drive', icon: IconCloudLock, color: '#1971c2' },
  { key: 'learning', label: 'Learning', icon: IconSchool, color: '#e8590c' },
  { key: 'habits', label: 'Habits', icon: IconRepeat, color: '#12a150' },
  { key: 'finance', label: 'Finance', icon: IconWallet, color: '#0f766e' },
  { key: 'calendar', label: 'Calendar', icon: IconCalendarMonth, color: '#f08c00' },
  { key: 'reports', label: 'Reports', icon: IconChartAreaLine, color: '#5f3dc4' },
  { key: 'planner', label: 'Planner', icon: IconCompass, color: '#1971c2' },
  { key: 'settings', label: 'Settings', icon: IconSettings, color: '#495057' },
];

export default function MobileNav({ onOpen, active }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems = MORE;
  const moreActive = MORE.some((i) => i.key === active);

  const tap = (key) => {
    if (key === 'more') { setMoreOpen(true); return; }
    setMoreOpen(false);
    onOpen(key);
  };

  return (
    <>
      <Box className="mobile-nav glass-strong">
        {PRIMARY.map(({ key, label, icon: Icon, center }) => {
          const isActive = key === 'more' ? moreActive || moreOpen : active === key;
          if (center) {
            return (
              <button key={key} className="mobile-tab" onClick={() => tap(key)} aria-label={label}>
                <Box className="mobile-fab" data-active={active === key || undefined}>
                  <Icon size={26} stroke={1.9} color="#fff" />
                </Box>
              </button>
            );
          }
          return (
            <button key={key} className="mobile-tab" data-active={isActive || undefined} onClick={() => tap(key)} aria-label={label}>
              <Icon size={23} stroke={isActive ? 2.1 : 1.7} />
              <span>{label}</span>
            </button>
          );
        })}
      </Box>

      <Drawer
        opened={moreOpen}
        onClose={() => setMoreOpen(false)}
        position="bottom"
        size="auto"
        radius={0}
        title={<Text fw={800} fz={17}>Everything else</Text>}
        transitionProps={{ transition: 'slide-up', duration: 240, timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
        styles={{
          content: { height: 'auto', borderRadius: '22px 22px 0 0', paddingBottom: 'env(safe-area-inset-bottom)' },
          body: { paddingBottom: 24 },
        }}
      >
        <SimpleGrid cols={3} spacing={10}>
          {moreItems.map(({ key, label, icon: Icon, color }) => (
            <Stack
              key={key} gap={7} align="center" py={14}
              className="mobile-more-item"
              data-active={active === key || undefined}
              onClick={() => { setMoreOpen(false); onOpen(key); }}
            >
              <ThemeIcon size={46} radius="xl" variant="light" color="gray" style={{ background: `${color}18` }}>
                <Icon size={23} color={color} stroke={1.8} />
              </ThemeIcon>
              <Text fz={12} fw={600} ta="center">{label}</Text>
            </Stack>
          ))}
        </SimpleGrid>
      </Drawer>
    </>
  );
}
