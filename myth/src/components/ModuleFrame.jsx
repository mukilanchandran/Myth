// A module opened in place of the hero on desktop: title, subtitle, close.
import { ActionIcon, Text, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { motion } from 'framer-motion';

export default function ModuleFrame({ title, sub, onClose, flex, children }) {
  return (
    <motion.section className="module" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <div className="module-head">
        <div>
          <Text fw={800} fz={21} lh={1.15}>{title}</Text>
          {sub && <Text fz={12.5} c="dimmed" mt={3}>{sub}</Text>}
        </div>
        <Tooltip label="Back to home (Esc)">
          <ActionIcon size={38} radius="xl" variant="light" color="gray" onClick={onClose} aria-label="Close"><IconX size={18} /></ActionIcon>
        </Tooltip>
      </div>
      <div className={`module-body${flex ? ' is-flex' : ''}`}>{children}</div>
    </motion.section>
  );
}
