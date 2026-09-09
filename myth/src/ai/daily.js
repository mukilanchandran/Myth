// The daily line under the welcome: one small thing a day — a laugh, a fact,
// a tech note or a thought. Deterministic per date (the same line all day,
// a new one tomorrow), with the category rotating day by day. A model may
// write a fresh one (see Welcome.jsx); these pools are the always-on fallback.
import dayjs from 'dayjs';

const POOLS = {
  funny: {
    tag: 'Just for laughs',
    lines: [
      'My to-do list is a work of fiction — today, let\'s make one chapter non-fiction.',
      'Procrastination is the art of keeping up with yesterday. Let\'s not be artists today.',
      'A clean desk is a sign of a full drawer. Both are fine.',
      'Coffee: because adulting is hard and the tasks won\'t do themselves. Yet.',
      'I put "wake up" on the list just to tick something off. Zero regrets.',
      'The Wi-Fi is strong today. So is the temptation. Choose wisely.',
      'Deadlines make a lovely whooshing sound as they fly by — let\'s catch one instead.',
      'If at first you don\'t succeed, call it version 1.0.',
      'Multitasking: doing several things badly at once. Single-task like a legend today.',
      'Every expert was once a beginner who refused to give up. Or googled a lot. Both work.',
    ],
  },
  knowledge: {
    tag: 'Did you know',
    lines: [
      'Honey never spoils — 3,000-year-old jars from Egyptian tombs are still edible.',
      'Your brain runs on about 20 watts, roughly a dim light bulb, and still writes your to-do list.',
      'Octopuses have three hearts, and two of them stop when they swim. Rest is built in.',
      'A day on Venus is longer than its year. Some Mondays feel like that.',
      'Bamboo can grow almost a metre in a single day. Consistency beats bursts.',
      'The Eiffel Tower grows about 15 cm in summer heat. Even iron stretches with the season.',
      'Sharks are older than trees by about 50 million years.',
      'Chandrayaan-3 made India the first nation to land near the Moon\'s south pole.',
      'Bananas are berries; strawberries are not. Categories are made up, keep going.',
      'The shortest war in history lasted about 40 minutes. Some meetings should take notes.',
    ],
  },
  tech: {
    tag: 'Tech note',
    lines: [
      'Small open models now run fully offline on a laptop — private by default, no cloud needed.',
      'A good prompt is context first, question last. Same rule works for asking humans.',
      'The two-minute rule ships more than the perfect plan: if it takes under two minutes, do it now.',
      'Most outages are caused by change, not by load. Ship small, ship often.',
      'Retrieval-augmented answers are just a search step before the model speaks — that\'s how Myth stays honest.',
      'Every "AI agent" is a loop: look, decide, act, check. You run one too, it\'s called a morning.',
      'Caching is the cheapest performance win in software and in life: decide once, reuse often.',
      'Version control your ideas — a note today beats a memory tomorrow.',
    ],
  },
  thought: {
    tag: 'Thought for today',
    lines: [
      'You don\'t rise to your goals; you fall to your systems. Tune the system.',
      'Done is a decision, not a feeling.',
      'Deep work for one hour beats shallow work all week.',
      'Progress loves speed of decision more than perfection of plan.',
      'What gets scheduled gets done. What gets written gets remembered.',
      'Discipline starts the day; momentum finishes it.',
      'The task you are avoiding usually takes twenty minutes. The avoiding takes all day.',
      'Rest is part of the work, not a break from it.',
      'Small daily wins compound into unrecognisable results in a year.',
      'Say no to the good so there is room for the great.',
    ],
  },
};
const ORDER = ['thought', 'funny', 'knowledge', 'tech'];

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// The line for a given date — same all day, different tomorrow.
export function dailyLine(date = dayjs()) {
  const key = dayjs(date).format('YYYY-MM-DD');
  const dayOfYear = dayjs(date).diff(dayjs(date).startOf('year'), 'day');
  const category = ORDER[dayOfYear % ORDER.length];
  const pool = POOLS[category];
  return { category, tag: pool.tag, text: pool.lines[hash(key) % pool.lines.length], source: 'pool' };
}

// A time-aware welcome: "Hey Boss, good morning".
export function welcomeLine(now = dayjs(), name = 'Boss') {
  const h = now.hour();
  const part = h < 5 ? 'still up' : h < 12 ? 'good morning' : h < 17 ? 'good afternoon' : h < 21 ? 'good evening' : 'good night';
  return h < 5 ? `Hey ${name}, ${part}?` : `Hey ${name}, ${part}`;
}

export const CATEGORY_TAGS = Object.fromEntries(Object.entries(POOLS).map(([k, v]) => [k, v.tag]));
