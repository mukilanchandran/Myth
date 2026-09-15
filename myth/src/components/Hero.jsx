// The hero: the Myth Daily Brief on one frosted tile — the greeting, today's
// numbers, the one thing to finish, what is slipping, the personal line, the
// learning slot and a suggested schedule — plus the "What should I do now?"
// button. Rebuilt from live data every minute (ai/dailyBrief.js).
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { useCommandCenter } from './CommandCenter';
import { MithNowButton } from './MithNow';
import { dailyBrief } from '../ai/dailyBrief';
import { APP_NAME } from '../config/env';

const PANEL_FOR = { task: 'tasks', project: 'projects', reminder: 'reminders', event: 'calendar', learning: 'learning' };

function Item({ label, text, tone, onClick, wide }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`brief-item${tone ? ` is-${tone}` : ''}${wide ? ' is-wide' : ''}`} onClick={onClick}>
      <b>{label}</b>
      <span>{text}</span>
    </Tag>
  );
}

export default function Hero({ onNow, mobile }) {
  const cc = useCommandCenter();
  const state = useStore();
  const setPanel = useUI((s) => s.setPanel);
  const { now } = cc;
  const brief = useMemo(() => dailyBrief(state, now), [state, now]);
  const open = (ref) => (ref?.type && PANEL_FOR[ref.type] ? () => setPanel(PANEL_FOR[ref.type]) : undefined);

  return (
    <motion.section className="hero" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
      <div className="hg-tile hg-main">
        <div className="hero-eyebrow">{APP_NAME} daily brief · {brief.date}</div>
        <div className="brief-greeting">{brief.greeting}</div>

        <div className="brief-grid">
          <Item label="Today" text={brief.today.line} wide />
          <Item label="Your focus" text={brief.focus.text} tone="focus" onClick={open(brief.focus.ref)} />
          <Item label="Potential problem" text={brief.problem.text} tone={brief.problem.kind === 'none' ? 'calm' : 'warn'} onClick={open(brief.problem.ref)} />
          <Item label="Personal" text={brief.personal.text} onClick={open(brief.personal.ref)} />
          <Item label="Learning" text={brief.learning.text} onClick={open(brief.learning.ref)} />
          {brief.schedule.length > 0 && (
            <div className="brief-item is-wide">
              <b>Suggested schedule</b>
              <div className="hero-plan brief-schedule">
                {brief.schedule.map((s) => (
                  <div key={`${s.time}${s.label}`} className={s.past ? 'is-past' : s.now ? 'is-now' : ''}>
                    <b>{s.time}</b><i>→</i>{s.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="hero-cta">
          <MithNowButton mobile={mobile} onClick={onNow} />
        </div>
      </div>
    </motion.section>
  );
}
