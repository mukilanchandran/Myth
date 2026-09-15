// "Today's plan" — the morning ritual, as a strip of pills inside the Myth AI
// box: a summary pill (done/total — tap it to add more) and one pill per item;
// tap the ring to complete, the × to remove. An empty day shows one dashed
// "Set today's plan" pill. Myth AI edits the same list from chat ("add X to
// today's plan", "done with X"), and the Command Center's focus blocks land here too.
import { useMemo, useState } from 'react';
import { Group, Text, Modal, Textarea, Button, Chip, Stack } from '@mantine/core';
import { IconPlus, IconCheck, IconX, IconTargetArrow } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, today } from '../store/useStore';

function PlanPill({ item, onToggle, onDelete }) {
  return (
    <motion.div
      layout className={`plan-pill${item.done ? ' is-done' : ''}`}
      initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
    >
      <motion.button
        type="button" className="plan-ring" whileTap={{ scale: 0.8 }} aria-pressed={item.done}
        onClick={() => onToggle(item.id)} title={item.done ? 'Mark as not done' : 'Mark completed'}
      >
        {item.done && <IconCheck size={11} color="#fff" stroke={3} />}
      </motion.button>
      <span className="plan-pill-text">{item.text}</span>
      <button type="button" className="plan-pill-x" onClick={() => onDelete(item.id)} title="Remove from plan" aria-label={`Remove ${item.text}`}>
        <IconX size={12} />
      </button>
    </motion.div>
  );
}

export default function DayPlan() {
  const { plans, addPlanItems, togglePlanItem, deletePlanItem, tasks } = useStore();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');

  const key = today();
  const items = plans[key] ?? [];
  const doneCount = items.filter((i) => i.done).length;
  const allDone = items.length > 0 && doneCount === items.length;

  // pending first, completed sink to the end
  const ordered = useMemo(
    () => [...items].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1)),
    [items]
  );

  const suggestions = useMemo(() => {
    const planned = new Set(items.map((i) => i.text.toLowerCase()));
    return tasks
      .filter((t) => t.status !== 'done')
      .filter((t) => (t.due && new Date(t.due) - new Date() < 2 * 86400e3) || t.priority >= 4)
      .filter((t) => !planned.has(t.title.toLowerCase()))
      .slice(0, 5);
  }, [tasks, items]);

  const savePlan = () => {
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length) addPlanItems(lines);
    setDraft('');
    setComposing(false);
  };

  return (
    <>
      <div className="plan-strip" aria-label="Today's plan">
        {items.length === 0 ? (
          <>
            <motion.button type="button" className="plan-set" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }} onClick={() => setComposing(true)}>
              <IconPlus size={14} /> Set today's plan
            </motion.button>
            <span className="plan-strip-hint">The morning ritual — the few things that matter today.</span>
          </>
        ) : (
          <>
            {/* summary pill — tap to add more lines */}
            <motion.button
              type="button" layout className={`plan-sum${allDone ? ' is-all' : ''}`} whileTap={{ scale: 0.96 }}
              onClick={() => setComposing(true)} title="Add more to today's plan"
            >
              <IconTargetArrow size={14} color="#3ddc84" />
              <span>{allDone ? 'All done today!' : "Today's plan"} · {doneCount}/{items.length}</span>
              <IconPlus size={13} style={{ opacity: 0.85 }} />
            </motion.button>
            <AnimatePresence>
              {ordered.map((item) => (
                <PlanPill key={item.id} item={item} onToggle={togglePlanItem} onDelete={deletePlanItem} />
              ))}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* plan composer */}
      <Modal
        opened={composing} onClose={() => setComposing(false)} radius="xl" size="md" centered
        title={
          <div>
            <Text fw={800} fz={18}>What are you doing today?</Text>
            <Text fz={12.5} c="dimmed" mt={2}>One thing per line — they appear as pills in the Myth AI box. You can also just tell Myth "add … to today's plan".</Text>
          </div>
        }
      >
        <Stack gap="sm">
          <Textarea
            autosize minRows={4} radius="md" data-autofocus
            placeholder={'Finish dashboard wireframes\nReview intern designs\nCall vendor about quote'}
            value={draft} onChange={(e) => setDraft(e.currentTarget.value)}
          />
          {suggestions.length > 0 && (
            <div>
              <Text fz={12.5} fw={600} c="dimmed" mb={6}>Pull from your tasks:</Text>
              <Group gap={6}>
                {suggestions.map((t) => (
                  <Chip
                    key={t.id} size="xs" checked={false} variant="light"
                    onClick={() => setDraft((d) => (d ? `${d}\n${t.title}` : t.title))}
                  >
                    {t.title}
                  </Chip>
                ))}
              </Group>
            </div>
          )}
          <Group justify="space-between">
            {items.length > 0 ? (
              <Text fz={12.5} c="dimmed">{items.length} already planned — new lines get added.</Text>
            ) : <span />}
            <Button radius="xl" color="forest" onClick={savePlan} disabled={!draft.trim()}>
              Set today's plan
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
