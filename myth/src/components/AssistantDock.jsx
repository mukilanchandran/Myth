// The floating Myth AI on desktop: a small mascot button in the bottom-right
// corner that follows you into every module. Tapping it opens a compact chat
// panel right above the button — no overlay, no blur, no focus trap, so the
// rest of the app stays usable while Myth is open. Ctrl+J toggles it from
// anywhere and Esc closes it. (Phones have the centre tab of the bottom bar.)
import { useEffect } from 'react';
import { Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../store/useUI';
import MythBot from './MythBot';
import ChatAssistant from './ChatAssistant';

export default function AssistantDock() {
  const open = useUI((s) => s.assistantOpen);
  const seed = useUI((s) => s.assistantSeed);
  const openAssistant = useUI((s) => s.openAssistant);
  const closeAssistant = useUI((s) => s.closeAssistant);
  const consume = useUI((s) => s.consumeAssistantSeed);
  const panel = useUI((s) => s.panel);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); if (open) closeAssistant(); else openAssistant(); }
      else if (e.key === 'Escape' && open) closeAssistant();
    };
    // capture phase: an open tooltip (Floating UI) swallows Escape at the document level, so listen before it
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, openAssistant, closeAssistant]);

  // the full Myth AI module is already on screen — no need for the launcher too
  if (panel === 'assistant') return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            key="ai-panel" className="ai-panel" aria-label="Myth AI"
            initial={{ opacity: 0, scale: 0.86, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <ChatAssistant compact onClose={closeAssistant} initialQuestion={seed} onConsumedInitial={consume} />
          </motion.section>
        )}
      </AnimatePresence>

      <Tooltip label={open ? 'Close Myth AI (Ctrl+J)' : 'Myth AI — ask, create files, add anything anywhere (Ctrl+J)'} position="left" offset={10}>
        <motion.button
          type="button" className="ai-dock" data-open={open || undefined} aria-label={open ? 'Close Myth AI' : 'Open Myth AI'} aria-expanded={open}
          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
          onClick={() => (open ? closeAssistant() : openAssistant())}
        >
          {open ? <IconX size={18} color="#fff" stroke={2.4} /> : <MythBot size={26} active />}
          {!open && <span className="ai-dock-pulse" />}
        </motion.button>
      </Tooltip>
    </>
  );
}
