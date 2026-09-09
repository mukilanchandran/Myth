// "Hey Boss, good afternoon" above the capture bar, with one small line for
// the day — a laugh, a fact, a tech note or a thought. The pool line shows
// instantly and stays the same all day; when a model answers, its fresh line
// replaces it and is remembered for the day so it doesn't flicker or change.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { dailyLine, welcomeLine } from '../ai/daily';
import { generateSpark } from '../ai/spark';

const KEY = 'myth-daily-line';

export default function Welcome() {
  const [now, setNow] = useState(() => dayjs());
  const [line, setLine] = useState(() => {
    const today = dayjs().format('YYYY-MM-DD');
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved?.date === today && saved.text) return { ...saved, source: 'ai' };
    } catch { /* fall through */ }
    return dailyLine();
  });

  // greeting follows the clock; the line only changes with the date
  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (line.source === 'ai') return undefined;
    let alive = true;
    generateSpark(useStore.getState()).then((text) => {
      if (!alive || !text) return;
      const fresh = { date: dayjs().format('YYYY-MM-DD'), text, tag: 'From Myth', source: 'ai' };
      try { localStorage.setItem(KEY, JSON.stringify(fresh)); } catch { /* storage may be unavailable */ }
      setLine(fresh);
    });
    return () => { alive = false; };
  }, [line.source]);

  return (
    <motion.div className="welcome" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <h2 className="welcome-h">{welcomeLine(now)}</h2>
      <p className="welcome-line"><span className="welcome-tag">{line.tag}</span>{line.text}</p>
    </motion.div>
  );
}
