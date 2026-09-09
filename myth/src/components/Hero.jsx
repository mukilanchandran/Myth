// The hero: one compact frosted tile — the day's percentage, what Myth would
// do next, the plan and its actions, and three small stats in a row.
import { Button, Badge } from '@mantine/core';
import { IconCheck, IconTargetArrow, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { useCommandCenter, useMythSays } from './CommandCenter';
import { MithNowButton } from './MithNow';
import { fmtDuration } from '../ai/commandCenter';
import { APP_NAME } from '../config/env';

export default function Hero({ onNow, mobile }) {
  const cc = useCommandCenter();
  const { progress, plan, active, now } = cc;
  const applyPlan = useStore((s) => s.applyPlan);
  const clearFocusBlocks = useStore((s) => s.clearFocusBlocks);
  const completeTask = useStore((s) => s.completeTask);
  const streak = useStore((s) => s.xp.streakCount);
  const showActive = !!active && active.remaining > 0;
  const message = useMythSays(plan, showActive);

  const follow = () => {
    applyPlan(plan.blocks);
    notifications.show({ title: 'Plan set', message: `${plan.blocks.length} focus block${plan.blocks.length === 1 ? '' : 's'} added to today — first one starts ${plan.blocks[0].start}.`, color: 'forest' });
  };

  const quote = showActive
    ? (active.current
      ? `Now: ${active.current.title} until ${active.current.end}.${active.next ? ` Then ${active.next.title} at ${active.next.time}.` : ' Last block of the day.'}`
      : active.next ? `Next up: ${active.next.title} at ${active.next.time}. Until then, clear the small stuff.` : 'Every block is behind you. Tick off what got finished.')
    : message;

  const stats = [
    { v: `${progress.done}/${progress.total}`, l: 'commitments' },
    { v: fmtDuration(plan.focusMinutes), l: 'focus left' },
    { v: `${streak}d`, l: 'streak' },
  ];

  return (
    <motion.section className="hero" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
      <div className="hg-tile hg-main">
        <div className="hero-eyebrow">{now.format('dddd, MMMM D')} · your day</div>
        <div className="hg-big">
          <span className="hg-pct">{progress.pct}<small>%</small></span>
          <div style={{ minWidth: 0 }}>
            <div className="hg-big-label">of your day complete</div>
            <div className="hero-meta">
              {progress.total ? `${progress.done} of ${progress.total} commitments done` : 'Nothing committed yet — capture something above'}
              {' · '}{showActive ? `${active.remaining} focus block${active.remaining === 1 ? '' : 's'} ahead` : `${fmtDuration(plan.focusMinutes)} of focus time left`}
            </div>
          </div>
        </div>
        <div className="hero-bar"><i style={{ width: `${progress.pct}%` }} /></div>

        <div className="hero-quote"><b>{APP_NAME} says</b>{quote}</div>

        {(showActive ? active.blocks : plan.blocks).length > 0 && (
          <div className="hero-plan">
            {showActive
              ? active.blocks.slice(0, 4).map((b) => { const done = b.task?.status === 'done'; return <div key={b.id} style={{ textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.55 : 1 }}><b>{b.time}–{b.end}</b>{b.title}</div>; })
              : plan.blocks.slice(0, 4).map((b) => <div key={b.taskId}><b>{b.start}–{b.end}</b>{b.title} <Badge size="xs" variant="light" color={b.why === 'overdue' ? 'red' : b.why === 'due today' ? 'orange' : 'gray'} ml={6}>{b.why}</Badge></div>)}
          </div>
        )}

        <div className="hero-cta">
          {showActive ? (
            <>
              {active.current && !active.current.taskDone && <Button size="sm" radius="xl" color="#3ddc84" autoContrast leftSection={<IconCheck size={15} />} onClick={() => completeTask(active.current.taskId)}>Done with this block</Button>}
              <Button size="sm" radius="xl" variant="white" color="dark" leftSection={<IconTrash size={14} />} onClick={() => clearFocusBlocks()}>Clear plan</Button>
            </>
          ) : plan.blocks.length > 0 && (
            <Button size="sm" radius="xl" color="#3ddc84" autoContrast leftSection={<IconTargetArrow size={16} />} onClick={follow}>Follow {APP_NAME}&apos;s plan</Button>
          )}
          <MithNowButton mobile={mobile} onClick={onNow} />
        </div>

        <div className="hg-stats">
          {stats.map((s) => <div key={s.l} className="hg-stat"><b>{s.v}</b><span>{s.l}</span></div>)}
        </div>
      </div>
    </motion.section>
  );
}
