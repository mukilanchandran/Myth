// "Today's Plan" — an inline strip that lives right under the capture bar,
// where the example suggestion chips used to be.
// Empty day: a single dashed "Set today's plan" pill (morning ritual).
// With items: a summary pill (2/5 + add more) followed by one pill per item —
// tap the ring to complete, tap the × to remove.
import { useMemo, useState } from 'react';
import { Group, Text, Modal, Textarea, Button, Chip, Stack } from '@mantine/core';
import { IconPlus, IconCheck, IconX, IconTargetArrow } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, today } from '../store/useStore';

function PlanPill({ item, onToggle, onDelete }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
    >
      <Group
        gap={7} wrap="nowrap" px={10} py={5}
        style={{
          borderRadius: 999,
          background: item.done ? 'rgba(10,26,18,0.45)' : 'rgba(10,26,18,0.72)',
          backdropFilter: 'blur(12px)',
          border: item.done ? '1px solid rgba(61,220,132,0.4)' : '1px solid rgba(255,255,255,0.2)',
          transition: 'background 200ms ease, border 200ms ease',
        }}
      >
        <motion.button
          whileTap={{ scale: 0.8 }}
          onClick={() => onToggle(item.id)}
          title={item.done ? 'Mark as not done' : 'Mark completed'}
          style={{
            width: 18, height: 18, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
            border: item.done ? 'none' : '2px solid rgba(255,255,255,0.55)',
            background: item.done ? 'linear-gradient(135deg,#3ddc84,#0f766e)' : 'transparent',
            display: 'grid', placeItems: 'center', padding: 0,
          }}
        >
          {item.done && <IconCheck size={11} color="#fff" stroke={3} />}
        </motion.button>
        <Text
          fz={12.5} fw={600} c="#fff"
          td={item.done ? 'line-through' : undefined}
          opacity={item.done ? 0.65 : 1}
          style={{ maxWidth: 230, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {item.text}
        </Text>
        <button
          onClick={() => onDelete(item.id)}
          title="Remove from plan"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: 0.5 }}
        >
          <IconX size={12} color="#fff" />
        </button>
      </Group>
    </motion.div>
  );
}

export default function DayPlan() {
  const { plans, settings, addPlanItems, togglePlanItem, deletePlanItem, tasks } = useStore();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');

  const key = `${today()}|${settings.mode}`;
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
      .filter((t) => t.mode === settings.mode && t.status !== 'done')
      .filter((t) => (t.due && new Date(t.due) - new Date() < 2 * 86400e3) || t.priority >= 4)
      .filter((t) => !planned.has(t.title.toLowerCase()))
      .slice(0, 5);
  }, [tasks, settings.mode, items]);

  const savePlan = () => {
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length) addPlanItems(lines);
    setDraft('');
    setComposing(false);
  };

  return (
    <>
      <Group justify="center" gap={8} mt={10} px={12} wrap="wrap" maw={920} mx="auto">
        {items.length === 0 ? (
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}>
            <Group
              gap={7} px={14} py={7} wrap="nowrap"
              onClick={() => setComposing(true)}
              style={{
                cursor: 'pointer', borderRadius: 999,
                border: '2px dashed rgba(255,255,255,0.6)',
                background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(10px)',
              }}
            >
              <IconPlus size={15} color="#fff" />
              <Text fz={13} fw={700} c="#fff" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>
                Set today's plan
              </Text>
            </Group>
          </motion.div>
        ) : (
          <>
            {/* summary pill — tap to add more lines */}
            <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.95 }}>
              <Group
                gap={7} px={12} py={6} wrap="nowrap"
                onClick={() => setComposing(true)}
                title="Add more to today's plan"
                style={{
                  cursor: 'pointer', borderRadius: 999,
                  background: allDone
                    ? 'linear-gradient(135deg, rgba(18,161,80,0.9), rgba(15,118,110,0.9))'
                    : 'rgba(10,26,18,0.85)',
                  backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.22)',
                }}
              >
                <IconTargetArrow size={14} color="#3ddc84" style={{ flexShrink: 0 }} />
                <Text fz={12.5} fw={800} c="#fff">
                  {allDone ? 'All done today!' : "Today's plan"} · {doneCount}/{items.length}
                </Text>
                <IconPlus size={13} color="rgba(255,255,255,0.85)" style={{ flexShrink: 0 }} />
              </Group>
            </motion.div>

            <AnimatePresence>
              {ordered.map((item) => (
                <PlanPill key={item.id} item={item} onToggle={togglePlanItem} onDelete={deletePlanItem} />
              ))}
            </AnimatePresence>
          </>
        )}
      </Group>

      {/* plan composer */}
      <Modal
        opened={composing} onClose={() => setComposing(false)} radius="xl" size="md" centered
        title={
          <div>
            <Text fw={800} fz={18}>What are you doing today?</Text>
            <Text fz={12.5} c="dimmed" mt={2}>One thing per line — they appear as pills under the capture bar.</Text>
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
