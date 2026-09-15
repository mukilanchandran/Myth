// Reminders — the engine. Pure functions, no React, no I/O, node-testable:
//   parseReminder     "call Ravi tomorrow 5pm every week" → title, date, time, repeat, category
//   dueAt / statusOf  when a reminder is due and what state it is in (overdue, soon, today…)
//   completePatch     what completing does — a one-off is done, a repeat advances to its next date
//   groupReminders    the sections the panel shows
//   reminderNotifications  what the Notification Intelligence Engine delivers for reminders
//   suggestReminders  reminders Myth proposes from the rest of the data (meetings, due tasks, bills, birthdays)
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import { tokens } from './text.js';

export const REPEATS = {
  none: 'Once',
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

export const CATEGORIES = {
  personal: { label: 'Personal', color: '#0D2D1C' },
  work: { label: 'Work', color: '#1971c2' },
  health: { label: 'Health', color: '#2f9e44' },
  money: { label: 'Money', color: '#e8590c' },
  people: { label: 'People', color: '#e64980' },
  errand: { label: 'Errand', color: '#f08c00' },
  home: { label: 'Home', color: '#7048e8' },
};

const CATEGORY_WORDS = [
  ['money', /\b(?:pay|bill|rent|emi|invoice|salary|tax|insurance|premium|recharge|subscription|fee|loan|transfer|deposit)\b/i],
  ['health', /\b(?:medicine|meds|tablet|pill|doctor|dentist|gym|workout|run|yoga|water|vitamin|checkup|check-up|sleep|stretch|walk)\b/i],
  ['people', /\b(?:call|ring|text|message|wish|birthday|mom|dad|mum|amma|appa|wife|husband|friend|sister|brother|meet|reply to)\b/i],
  ['work', /\b(?:meeting|standup|client|report|deadline|submit|review|deploy|email|boss|office|presentation|interview|invoice|sprint)\b/i],
  ['errand', /\b(?:buy|pick\s?up|drop|collect|order|grocery|groceries|shop|return|book|renew|courier|parcel|post)\b/i],
  ['home', /\b(?:clean|laundry|cook|plants?|water the|garbage|trash|repair|fix|maid|electric|gas|cylinder)\b/i],
];

export function guessCategory(title = '') {
  for (const [cat, rx] of CATEGORY_WORDS) if (rx.test(title)) return cat;
  return 'personal';
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const weekdayIndex = (word) => WEEKDAYS.findIndex((d) => d.startsWith(word.toLowerCase().slice(0, 3)));

const REPEAT_RX = [
  ['weekdays', /\b(?:every\s+weekday|on\s+weekdays|weekdays|mon(?:day)?\s*(?:-|to)\s*fri(?:day)?)\b/i],
  ['daily', /\b(?:every\s*day|everyday|daily|each\s+day|every\s+(?:morning|evening|night|afternoon)|nightly)\b/i],
  ['weekly', /\b(?:every|each)\s+((?:sun|mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur)(?:day)?s?)\b/i],
  ['weekly', /\b(?:every\s+week|weekly|each\s+week)\b/i],
  ['monthly', /\b(?:every|each)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+(?:the|every)\s+month)?\b/i],
  ['monthly', /\b(?:every\s+month|monthly|each\s+month)\b/i],
  ['yearly', /\b(?:every\s+year|yearly|annually|each\s+year)\b/i],
];

/** Find a repeat phrase; returns the repeat, the text without it, and any weekday / day-of-month it named. */
export function detectRepeat(text) {
  for (const [repeat, rx] of REPEAT_RX) {
    const m = text.match(rx);
    if (!m) continue;
    const out = { repeat, rest: text.replace(rx, ' ').replace(/\s{2,}/g, ' ').trim(), weekday: null, monthDay: null };
    if (repeat === 'weekly' && m[1]) out.weekday = weekdayIndex(m[1]);
    if (repeat === 'monthly' && m[1]) out.monthDay = Math.min(28, Math.max(1, Number(m[1])));
    return out;
  }
  return { repeat: 'none', rest: text, weekday: null, monthDay: null };
}

const LEAD = /^(?:please\s+)?(?:remind(?:er)?\s*(?:me)?\s*(?:to|about|of|that|:|-)?\s+|reminder[:\-\s]+|don'?t\s+(?:let me\s+)?forget\s+(?:to\s+)?)/i;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tidy = (s) => s
  .replace(/\s{2,}/g, ' ')
  .replace(/^(?:to|that|about|of)\s+/i, '')
  .replace(/\s*\b(?:at|on|by|before|until|till|around|for|in)\s*[,.]?$/i, '')
  .replace(/[,\s]+$/, '')
  .trim();

/**
 * A sentence → { title, date, time, repeat, category, hasDate }.
 * Missing time on a dated reminder = all-day (shown first thing); repeats with
 * no date start today (or the named weekday / day of month).
 */
export function parseReminder(raw, now = new Date()) {
  const base = dayjs(now);
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  text = text.replace(LEAD, '');
  const rep = detectRepeat(text);
  text = rep.rest;

  const results = chrono.parse(text, base.toDate(), { forwardDate: true });
  let date = null;
  let time = null;
  if (results.length) {
    const r = results[0];
    const d = dayjs(r.start.date());
    date = d.format('YYYY-MM-DD');
    if (r.start.isCertain('hour')) time = d.format('HH:mm');
    for (const res of results) text = text.replace(res.text, ' ');
  }
  // "every morning", "tonight" without an hour → a sensible default hour
  if (!time) {
    if (/\b(?:morning)\b/i.test(raw)) time = '08:00';
    else if (/\b(?:afternoon)\b/i.test(raw)) time = '14:00';
    else if (/\b(?:evening)\b/i.test(raw)) time = '18:00';
    else if (/\b(?:night|tonight)\b/i.test(raw)) time = '21:00';
  }
  text = text.replace(/\b(?:morning|afternoon|evening|night|tonight)\b/gi, ' ');

  // a repeat with no explicit day ("every monday 10am", "every 1st", "every evening") is anchored here
  const dateCertain = results.some((r) => r.start.isCertain('day') || r.start.isCertain('weekday'));
  if (rep.repeat !== 'none' && !dateCertain) {
    let d = base.startOf('day');
    if (rep.weekday != null) {
      const delta = (rep.weekday - d.day() + 7) % 7;
      d = d.add(delta, 'day');
      if (delta === 0 && time && base.isAfter(dayjs(`${d.format('YYYY-MM-DD')}T${time}`))) d = d.add(7, 'day');
    } else if (rep.monthDay != null) {
      d = d.date(rep.monthDay);
      if (d.isBefore(base.startOf('day'))) d = d.add(1, 'month');
    } else if (time && base.isAfter(dayjs(`${d.format('YYYY-MM-DD')}T${time}`))) {
      d = d.add(1, 'day'); // "every evening" said after 18:00 → starts tomorrow
    }
    date = d.format('YYYY-MM-DD');
  }
  if (!date) date = base.format('YYYY-MM-DD');
  // a plain time that already passed today → tomorrow
  if (!dateCertain && time && rep.repeat === 'none' && base.isAfter(dayjs(`${date}T${time}`))) {
    date = base.add(1, 'day').format('YYYY-MM-DD');
  }

  const title = cap(tidy(text));
  if (!title) return null;
  return { title, date, time, repeat: rep.repeat, category: guessCategory(title), hasDate: results.length > 0 };
}

// ---------------------------------------------------------------------------
// timing
// ---------------------------------------------------------------------------
export const dueAt = (r) => dayjs(`${r.date}T${r.time ?? '09:00'}`);

/** When the reminder actually fires: its snooze time while snoozed, else its date + time. */
export function effectiveDue(r) {
  if (r.snoozedUntil) return dayjs(r.snoozedUntil);
  return dueAt(r);
}

/** The next date of a repeating reminder strictly after `after` (the current date or now, whichever is later). */
export function nextDate(r, now = dayjs()) {
  const cur = dueAt(r);
  const floor = now.isAfter(cur) ? now : cur;
  let d = dayjs(r.date);
  const timeOf = (day) => dayjs(`${day.format('YYYY-MM-DD')}T${r.time ?? '09:00'}`);
  const step = () => {
    switch (r.repeat) {
      case 'daily': d = d.add(1, 'day'); break;
      case 'weekdays': do { d = d.add(1, 'day'); } while (d.day() === 0 || d.day() === 6); break;
      case 'weekly': d = d.add(7, 'day'); break;
      case 'monthly': d = d.add(1, 'month'); break;
      case 'yearly': d = d.add(1, 'year'); break;
      default: d = d.add(1, 'day');
    }
  };
  step();
  let guard = 0;
  while (!timeOf(d).isAfter(floor) && guard++ < 800) step();
  return d.format('YYYY-MM-DD');
}

/** The store patch for "done": a one-off closes, a repeat rolls forward. */
export function completePatch(r, now = dayjs()) {
  const at = now.toISOString();
  if (!r.repeat || r.repeat === 'none') return { done: true, doneAt: at, snoozedUntil: null };
  return { date: nextDate(r, now), snoozedUntil: null, lastDoneAt: at, timesDone: (r.timesDone ?? 0) + 1 };
}

/** 'done' | 'snoozed' | 'overdue' | 'soon' | 'today' | 'tomorrow' | 'week' | 'later' */
export function statusOf(r, now = dayjs()) {
  if (r.done) return 'done';
  const due = effectiveDue(r);
  if (r.snoozedUntil && due.isAfter(now)) return 'snoozed';
  const diffMin = due.diff(now, 'minute');
  if (diffMin < 0 && (r.time || r.snoozedUntil || due.startOf('day').isBefore(now.startOf('day')))) return 'overdue';
  if (r.time && diffMin <= 60) return 'soon';
  if (due.isSame(now, 'day')) return 'today';
  if (due.isSame(now.add(1, 'day'), 'day')) return 'tomorrow';
  if (due.isBefore(now.add(7, 'day').endOf('day'))) return 'week';
  return 'later';
}

const SECTION_OF = { overdue: 'overdue', soon: 'today', today: 'today', snoozed: 'today', tomorrow: 'tomorrow', week: 'week', later: 'later', done: 'done' };

/** Sections for the panel: each item carries `.due` (dayjs) and `.status`. */
export function groupReminders(list = [], now = dayjs()) {
  const g = { overdue: [], today: [], tomorrow: [], week: [], later: [], done: [] };
  for (const r of list) {
    const status = statusOf(r, now);
    const item = { ...r, status, due: effectiveDue(r) };
    let section = SECTION_OF[status];
    if (status === 'snoozed') section = SECTION_OF[statusOf({ ...r, snoozedUntil: null, date: item.due.format('YYYY-MM-DD'), time: item.due.format('HH:mm') }, now)] ?? 'today';
    g[section].push(item);
  }
  for (const k of Object.keys(g)) g[k].sort((a, b) => (k === 'done' ? dayjs(b.doneAt).valueOf() - dayjs(a.doneAt).valueOf() : a.due.valueOf() - b.due.valueOf()));
  return g;
}

export const activeReminders = (list = []) => list.filter((r) => !r.done);

/** "Today 17:00", "Tomorrow", "Mon, Sep 21 · 09:00", "Overdue by 2h", "Snoozed till 18:00" */
export function describeWhen(r, now = dayjs()) {
  const due = effectiveDue(r);
  const status = r.done ? 'done' : statusOf(r, now);
  const timeTxt = r.time || r.snoozedUntil ? due.format('HH:mm') : null;
  if (status === 'done') return `Done ${dayjs(r.doneAt).format('MMM D')}`;
  if (status === 'snoozed') return `Snoozed till ${due.isSame(now, 'day') ? due.format('HH:mm') : due.format('ddd HH:mm')}`;
  if (status === 'overdue') {
    const min = now.diff(due, 'minute');
    const ago = min < 60 ? `${min} min` : min < 24 * 60 ? `${Math.round(min / 60)}h` : `${Math.round(min / 1440)}d`;
    return `Overdue by ${ago}`;
  }
  if (status === 'soon') return `In ${Math.max(1, due.diff(now, 'minute'))} min`;
  if (status === 'today') return timeTxt ? `Today ${timeTxt}` : 'Today';
  if (status === 'tomorrow') return timeTxt ? `Tomorrow ${timeTxt}` : 'Tomorrow';
  return `${due.format('ddd, MMM D')}${timeTxt ? ` · ${timeTxt}` : ''}`;
}

/** Snooze presets from now. */
export function snoozeOptions(now = dayjs()) {
  const evening = now.hour() < 17 ? now.hour(18).minute(0).second(0) : now.add(1, 'day').hour(18).minute(0).second(0);
  const nextMonday = now.add(((8 - now.day()) % 7) || 7, 'day').hour(9).minute(0).second(0);
  return [
    { key: '10m', label: '10 minutes', until: now.add(10, 'minute').toISOString() },
    { key: '1h', label: '1 hour', until: now.add(1, 'hour').toISOString() },
    { key: '3h', label: '3 hours', until: now.add(3, 'hour').toISOString() },
    { key: 'evening', label: `${evening.isSame(now, 'day') ? 'This' : 'Tomorrow'} evening 18:00`, until: evening.toISOString() },
    { key: 'tomorrow', label: 'Tomorrow 09:00', until: now.add(1, 'day').hour(9).minute(0).second(0).toISOString() },
    { key: 'nextweek', label: `Next Monday 09:00`, until: nextMonday.toISOString() },
  ];
}

/** Quick phrases the panel appends to what is typed. */
export function quickPhrases(now = dayjs()) {
  return [
    { label: 'In 1 hour', phrase: 'in 1 hour' },
    { label: now.hour() < 17 ? 'This evening' : 'Tonight', phrase: now.hour() < 17 ? 'this evening' : 'tonight' },
    { label: 'Tomorrow 9am', phrase: 'tomorrow 9am' },
    { label: 'Next Monday', phrase: 'next monday 9am' },
    { label: 'Every day', phrase: 'every day' },
    { label: 'Every week', phrase: 'every week' },
  ];
}

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------
/**
 * Candidates for the Notification Intelligence Engine. A reminder at its time is
 * `exempt` from windows and budget — the user asked for it at that moment.
 */
export function reminderNotifications(state, now = dayjs()) {
  const out = [];
  const list = activeReminders(state.reminders ?? []);
  const today = now.format('YYYY-MM-DD');
  for (const r of list) {
    const due = effectiveDue(r);
    const hasTime = !!(r.time || r.snoozedUntil);
    const diff = due.diff(now, 'minute');
    const stamp = due.format('YYYYMMDDHHmm');
    const timed = hasTime && diff <= 0;
    const allDayToday = !hasTime && due.isSame(now, 'day') && now.hour() >= 8;
    const overdueDays = now.startOf('day').diff(due.startOf('day'), 'day');
    if ((timed && diff > -3 * 24 * 60) || allDayToday || (!hasTime && overdueDays > 0 && overdueDays <= 3)) {
      const late = -diff;
      const bucket = late < 60 ? 'due' : late < 24 * 60 ? 'late' : 'stale';
      out.push({
        key: `reminder:${r.id}:${stamp}`, fp: bucket, kind: 'reminder', level: 'act', exempt: true, ref: { type: 'reminder', id: r.id },
        headline: `⏰ ${r.title}`,
        lines: [
          hasTime ? (late < 2 ? `It's ${due.format('HH:mm')}.` : `Was due ${describeWhen(r, now).replace('Overdue by ', '').trim()} ago${due.isSame(now, 'day') ? '' : ` (${due.format('ddd, MMM D')})`}.`) : (overdueDays > 0 ? `From ${due.format('ddd, MMM D')} — still open.` : 'On your list for today.'),
          ...(r.note ? [r.note] : []),
          ...(r.repeat && r.repeat !== 'none' ? [`${REPEATS[r.repeat]}.`] : []),
        ],
        action: { type: 'reminderDone', id: r.id, title: r.title, label: r.repeat && r.repeat !== 'none' ? 'Done for now' : 'Done' },
      });
      continue;
    }
    // a heads-up half an hour before a timed reminder
    if (hasTime && diff > 0 && diff <= 30) {
      out.push({
        key: `reminder-soon:${r.id}:${stamp}`, fp: 'soon', kind: 'reminder', level: 'plan', exempt: true, ref: { type: 'reminder', id: r.id },
        headline: `${r.title} in ${diff} min.`,
        lines: [`Set for ${due.format('HH:mm')}${r.note ? ` — ${r.note}` : ''}.`],
        action: { type: 'open', panel: 'reminders', label: 'Open reminders' },
      });
    }
  }
  // the morning rundown when the day carries several reminders
  const todays = list.filter((r) => effectiveDue(r).isSame(now, 'day') && effectiveDue(r).isAfter(now));
  if (todays.length >= 2 && now.hour() >= 7 && now.hour() < 11) {
    out.push({
      key: `reminders-today:${today}`, fp: String(todays.length), kind: 'reminder', level: 'fyi',
      headline: `${todays.length} reminders today.`,
      lines: todays.slice(0, 4).map((r) => `• ${r.time ? `${effectiveDue(r).format('HH:mm')} — ` : ''}${r.title}`),
      action: { type: 'open', panel: 'reminders', label: 'Open reminders' },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// suggestions from the rest of the data
// ---------------------------------------------------------------------------
const overlaps = (a, b) => {
  const ta = tokens(a);
  const tb = tokens(b);
  return ta.some((w) => tb.includes(w));
};

/** Up to `max` reminders worth adding, each with the reason. */
export function suggestReminders(state, now = dayjs(), max = 4) {
  const existing = activeReminders(state.reminders ?? []).map((r) => r.title);
  const covered = (title) => existing.some((t) => overlaps(t, title));
  const out = [];
  const push = (s) => { if (out.length < max && !covered(s.title) && !out.some((o) => overlaps(o.title, s.title))) out.push(s); };
  const today = now.format('YYYY-MM-DD');
  const tomorrow = now.add(1, 'day').format('YYYY-MM-DD');

  // meetings today / tomorrow → a 30-minute heads-up
  (state.events ?? [])
    .filter((e) => (e.kind === 'meeting' || e.kind === 'event') && e.time && [today, tomorrow].includes(e.date))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .forEach((e) => {
      const at = dayjs(`${e.date}T${e.time}`).subtract(30, 'minute');
      if (!at.isAfter(now)) return;
      push({ key: `ev:${e.id}`, title: `${e.title} — get ready`, date: at.format('YYYY-MM-DD'), time: at.format('HH:mm'), repeat: 'none', category: 'work', why: `${e.kind === 'meeting' ? 'Meeting' : 'Event'} at ${e.time} ${e.date === today ? 'today' : 'tomorrow'}` });
    });

  // tasks due today or tomorrow
  (state.tasks ?? [])
    .filter((t) => t.status !== 'done' && t.due && [today, tomorrow].includes(t.due))
    .sort((a, b) => b.priority - a.priority)
    .forEach((t) => {
      const at = t.due === today ? now.add(2, 'hour') : dayjs(`${t.due}T09:00`);
      if (t.due === today && at.hour() >= 21) return;
      push({ key: `task:${t.id}`, title: t.title, date: at.format('YYYY-MM-DD'), time: at.format('HH:mm'), repeat: 'none', category: 'work', why: `Task due ${t.due === today ? 'today' : 'tomorrow'}` });
    });

  // birthdays and bills within three days
  (state.events ?? []).filter((e) => e.yearly && e.kind === 'birthday').forEach((e) => {
    const next = dayjs(e.date).year(now.year());
    const d = (next.isBefore(now.startOf('day')) ? next.add(1, 'year') : next);
    const diff = d.diff(now.startOf('day'), 'day');
    if (diff < 0 || diff > 3) return;
    const name = (e.title.match(/^(.+?)['’]s\b/) ?? [null, e.title])[1].trim();
    push({ key: `bday:${e.id}`, title: `Wish ${name}`, date: d.format('YYYY-MM-DD'), time: '09:00', repeat: 'none', category: 'people', why: `${e.title} ${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`}` });
  });
  (state.events ?? []).filter((e) => e.kind === 'bill').forEach((e) => {
    const d = dayjs(e.date);
    const diff = d.diff(now.startOf('day'), 'day');
    if (diff < 0 || diff > 3) return;
    push({ key: `bill:${e.id}`, title: `Pay ${e.title}`, date: d.format('YYYY-MM-DD'), time: '10:00', repeat: 'none', category: 'money', why: `Bill due ${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`}` });
  });
  return out;
}

/** A compact text rundown for the assistant and the offline brain. */
export function reminderRundown(state, now = dayjs()) {
  const g = groupReminders(state.reminders ?? [], now);
  const line = (r) => `• ${r.title} — ${describeWhen(r, now)}${r.repeat && r.repeat !== 'none' ? ` (${REPEATS[r.repeat].toLowerCase()})` : ''}`;
  const parts = [];
  if (g.overdue.length) parts.push(`Overdue (${g.overdue.length}):`, ...g.overdue.slice(0, 6).map(line));
  if (g.today.length) parts.push(`Today (${g.today.length}):`, ...g.today.slice(0, 8).map(line));
  if (g.tomorrow.length) parts.push(`Tomorrow (${g.tomorrow.length}):`, ...g.tomorrow.slice(0, 5).map(line));
  if (g.week.length) parts.push(`This week (${g.week.length}):`, ...g.week.slice(0, 5).map(line));
  if (!parts.length) return g.later.length ? `Nothing before next week. ${g.later.length} reminder${g.later.length === 1 ? '' : 's'} further out — the first is "${g.later[0].title}" on ${g.later[0].due.format('ddd, MMM D')}.` : 'No reminders set. Say "remind me to …" and I will set one.';
  return parts.join('\n');
}
