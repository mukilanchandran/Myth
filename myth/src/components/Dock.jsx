import { Box, Group, Tooltip, ActionIcon } from '@mantine/core';
import {
  IconLayoutDashboard, IconChecklist, IconFolders, IconNotes,
  IconCalendarMonth, IconChartAreaLine,
  IconWallet, IconRepeat, IconSchool, IconCloudLock, IconBrain, IconCompass,
} from '@tabler/icons-react';
import { motion } from 'framer-motion';

const ITEMS = [
  { key: 'today', label: 'Daily planner', icon: IconLayoutDashboard },
  { key: 'context', label: 'Context engine — meeting prep & connections', icon: IconBrain },
  { key: 'tasks', label: 'Tasks', icon: IconChecklist },
  { key: 'projects', label: 'Projects', icon: IconFolders },
  { key: 'notes', label: 'Notes & Ideas', icon: IconNotes },
  { key: 'drive', label: 'Drive — screenshots, files & passwords', icon: IconCloudLock },
  { key: 'learning', label: 'Learning pipeline', icon: IconSchool },
  { key: 'habits', label: 'Habits', icon: IconRepeat },
  { key: 'finance', label: 'Finance', icon: IconWallet },
  { key: 'calendar', label: 'Calendar', icon: IconCalendarMonth },
  { key: 'reports', label: 'Monthly report', icon: IconChartAreaLine },
  { key: 'planner', label: 'Myth Planner — trips, events, exams, launches', icon: IconCompass },
];

export default function Dock({ onOpen, active, shift = 0 }) {
  const items = ITEMS;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'fixed', bottom: 18, left: 0, right: shift, display: 'flex', justifyContent: 'center',
        zIndex: 20, pointerEvents: 'none',
        transition: 'right 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <Box className="glass-strong" px={14} py={10} style={{ borderRadius: 999, pointerEvents: 'auto' }}>
        <Group gap={6}>
          {items.map(({ key, label, icon: Icon }) => (
            <Tooltip key={key} label={label} position="top" offset={12}>
              <ActionIcon
                className="dock-btn"
                size={46}
                radius="xl"
                variant={active === key ? 'gradient' : 'subtle'}
                gradient={{ from: '#12a150', to: '#0f766e' }}
                color="forest"
                onClick={() => onOpen(key)}
              >
                <Icon size={22} stroke={1.8} />
              </ActionIcon>
            </Tooltip>
          ))}
        </Group>
      </Box>
    </motion.div>
  );
}
