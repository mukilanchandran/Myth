// Myth Daily Brief — the morning status card on the home screen, rebuilt from
// live data every minute so it stays true all day.
//
//   Good morning.
//   Today               7 tasks · 2 meetings · 1 deadline
//   Your focus          Finish homepage design.
//   Potential problem   Project X is 2 days behind.
//   Personal            Electricity bill due tomorrow.
//   Learning            30 min React practice.
//   Suggested schedule  09:00 → Deep work · 11:00 → Meeting · 12:00 → Admin · 14:00 → Project X
//
// Pure functions over a store snapshot: the same brief feeds the hero card,
// the assistant (DATA.dailyBrief), the offline answer to "brief me" and the
// once-a-day toast. Node-testable.
import dayjs from 'dayjs';
import { commandCenter, greeting, todayEvents, toMin, fromMin, DAY_START, DAY_END } from './commandCenter.js';
import { mithNow } from './mithNow.js';
import { groupReminders, effectiveDue } from './reminders.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const keyOf = (d) => d.format('YYYY-MM-DD');
const endSentence = (s) => (s && !/[.!?…]$/.test(s.trim()) ? `${s.trim()}.` : s?.trim());

// ---------------------------------------------------------------------------
// today's numbers
// ---------------------------------------------------------------------------
export function todayCounts(state, now = dayjs()) {
  const today = keyOf(now);
  const tomorrow = keyOf(now.add(1, 'day'));
  const open = (state.tasks ?? []).filter((t) => t.status !== 'done');
  const tasks = open.filter((t) => t.due && t.due <= today).length;
  const events = todayEvents(state, now);
  const meetings = events.filter((e) => e.kind === 'meeting').length;
  const otherEvents = events.filter((e) => e.kind === 'event').length;
  const projects = (state.projects ?? []).filter((p) => p.status !== 'done' && p.status !== 'archived');
  const deadlines = projects.filter((p) => p.deadline && (p.deadline === today || p.deadline === tomorrow)).length
    + projects.reduce((n, p) => n + (p.milestones ?? []).filter((m) => !m.done && m.due && (m.due === today || m.due === tomorrow)).length, 0)
    + open.filter((t) => t.due === today && t.priority >= 5).length;
  const g = groupReminders(state.reminders ?? [], now);
  const reminders = g.overdue.length + g.today.length;
  const parts = [];
  if (tasks) parts.push(plural(tasks, 'task'));
  if (meetings) parts.push(plural(meetings, 'meeting'));
  if (otherEvents) parts.push(plural(otherEvents, 'event'));
  if (deadlines) parts.push(plural(deadlines, 'deadline'));
  if (reminders) parts.push(plural(reminders, 'reminder'));
  return { tasks, meetings, events: otherEvents, deadlines, reminders, line: parts.length ? parts.join(' · ') : 'A clear day — nothing due, nothing on the clock.' };
}

// ---------------------------------------------------------------------------
// the one thing to finish
// ---------------------------------------------------------------------------
export function focusOf(state, cc, now = dayjs()) {
  const rn = mithNow(state, now);
  if (rn.primary) return { text: endSentence(rn.primary.title), why: rn.primary.why, project: rn.primary.project, ref: { type: 'task', id: rn.primary.id } };
  const a = (cc.attention ?? [])[0];
  if (a) return { text: endSentence(a.title), why: a.sub, ref: a.ref };
  const open = (state.tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'blocked')
    .sort((a, b) => b.priority - a.priority || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  if (open[0]) return { text: endSentence(open[0].title), why: open[0].due ? `due ${dayjs(open[0].due).format('MMM D')}` : 'highest priority on the list', ref: { type: 'task', id: open[0].id } };
  return { text: 'Nothing lined up — pick one thing from the backlog.', why: null, ref: null };
}

// ---------------------------------------------------------------------------
// what is slipping
// ---------------------------------------------------------------------------
/** Projects whose progress trails the calendar: days behind = (expected − actual) × total days. */
export function projectsBehind(state, now = dayjs()) {
  const today = now.startOf('day');
  const out = [];
  (state.projects ?? []).filter((p) => p.status !== 'done' && p.status !== 'archived').forEach((p) => {
    const tasks = (state.tasks ?? []).filter((t) => t.projectId === p.id);
    const milestones = p.milestones ?? [];
    // a slipped milestone is the plainest signal
    const slipped = milestones.filter((m) => !m.done && m.due && dayjs(m.due).isBefore(today)).sort((a, b) => a.due.localeCompare(b.due))[0];
    if (slipped) {
      const days = today.diff(dayjs(slipped.due), 'day');
      out.push({ id: p.id, name: p.name, days, text: `${p.name} is ${plural(days, 'day')} behind — "${slipped.title}" slipped.`, ref: { type: 'project', id: p.id } });
      return;
    }
    if (!p.deadline || tasks.length < 2 || !p.created) return;
    const start = dayjs(p.created).startOf('day');
    const end = dayjs(p.deadline).startOf('day');
    const total = end.diff(start, 'day');
    if (total < 3) return;
    const expected = Math.max(0, Math.min(1, today.diff(start, 'day') / total));
    const actual = tasks.filter((t) => t.status === 'done').length / tasks.length;
    const days = Math.round((expected - actual) * total);
    if (days >= 1) out.push({ id: p.id, name: p.name, days, text: `${p.name} is ${plural(days, 'day')} behind.`, ref: { type: 'project', id: p.id } });
  });
  return out.sort((a, b) => b.days - a.days);
}

export function problemOf(state, cc, now = dayjs()) {
  const behind = projectsBehind(state, now)[0];
  if (behind) return { text: behind.text, ref: behind.ref, kind: 'project' };
  const overdue = (cc.attention ?? []).filter((a) => a.kind === 'overdue');
  if (overdue.length) {
    const oldest = [...overdue].sort((a, b) => a.sort - b.sort)[0];
    return { text: overdue.length === 1 ? `"${oldest.title}" is ${oldest.sub}.` : `${plural(overdue.length, 'task')} overdue — the oldest is "${oldest.title}" (${oldest.sub}).`, ref: oldest.ref, kind: 'overdue' };
  }
  if (cc.plan?.kind === 'overdue') return { text: cc.plan.message, ref: null, kind: 'plan' };
  const g = groupReminders(state.reminders ?? [], now);
  if (g.overdue.length) return { text: `${plural(g.overdue.length, 'reminder')} missed — "${g.overdue[0].title}".`, ref: { type: 'reminder', id: g.overdue[0].id }, kind: 'reminder' };
  const deadlineTomorrow = (state.projects ?? []).find((p) => p.status !== 'done' && p.deadline === keyOf(now.add(1, 'day')));
  if (deadlineTomorrow) {
    const open = (state.tasks ?? []).filter((t) => t.projectId === deadlineTomorrow.id && t.status !== 'done').length;
    if (open) return { text: `${deadlineTomorrow.name} is due tomorrow with ${plural(open, 'task')} still open.`, ref: { type: 'project', id: deadlineTomorrow.id }, kind: 'deadline' };
  }
  if (now.hour() >= 18) {
    const missed = (state.habits ?? []).filter((h) => !h.log?.[keyOf(now)]);
    if (missed.length) return { text: `${plural(missed.length, 'habit')} not ticked yet — ${missed.slice(0, 2).map((h) => h.name).join(', ')}.`, ref: null, kind: 'habit' };
  }
  return { text: 'Nothing is slipping.', ref: null, kind: 'none' };
}

// ---------------------------------------------------------------------------
// the personal line
// ---------------------------------------------------------------------------
export function personalOf(state, now = dayjs()) {
  const today = keyOf(now);
  const tomorrow = keyOf(now.add(1, 'day'));
  const lines = [];
  const when = (date) => (date === today ? 'today' : 'tomorrow');
  (state.events ?? []).filter((e) => e.kind === 'bill' && (e.date === today || e.date === tomorrow))
    .forEach((e) => lines.push({ text: `${e.title} due ${when(e.date)}.`, ref: { type: 'event', id: e.id } }));
  (state.events ?? []).filter((e) => e.yearly && e.kind === 'birthday').forEach((e) => {
    const md = dayjs(e.date).format('MM-DD');
    if (md === now.format('MM-DD')) lines.push({ text: `${e.title} today.`, ref: { type: 'event', id: e.id } });
    else if (md === now.add(1, 'day').format('MM-DD')) lines.push({ text: `${e.title} tomorrow.`, ref: { type: 'event', id: e.id } });
  });
  const g = groupReminders(state.reminders ?? [], now);
  [...g.overdue, ...g.today].filter((r) => r.category !== 'work').slice(0, 2)
    .forEach((r) => lines.push({ text: `${r.title}${r.time ? ` at ${effectiveDue(r).format('HH:mm')}` : ''}.`, ref: { type: 'reminder', id: r.id } }));
  if (!lines.length) {
    const habits = state.habits ?? [];
    const left = habits.filter((h) => !h.log?.[today]);
    if (habits.length && left.length) return { text: `${plural(left.length, 'habit')} to tick — ${left.slice(0, 3).map((h) => h.name).join(', ')}.`, ref: null };
    if (habits.length) return { text: 'Every habit ticked — nothing else personal today.', ref: null };
    return { text: 'Nothing personal on the list.', ref: null };
  }
  return { text: lines.slice(0, 2).map((l) => l.text).join(' '), ref: lines[0].ref };
}

// ---------------------------------------------------------------------------
// the learning line
// ---------------------------------------------------------------------------
export function learningOf(state) {
  const items = state.learning ?? [];
  const active = items.filter((l) => l.stage === 1);
  const wanted = items.filter((l) => l.stage === 0);
  const pick = active[0] ?? wanted[0];
  if (!pick) return { text: 'Nothing in the pipeline — add one thing you want to learn.', ref: null };
  const minutes = active.length > 1 ? 20 : 30;
  return { text: pick.stage === 1 ? `${minutes} min ${pick.title} practice.` : `Start ${pick.title} — 30 min to begin.`, ref: { type: 'learning', id: pick.id }, minutes };
}

// ---------------------------------------------------------------------------
// the suggested schedule
// ---------------------------------------------------------------------------
/**
 * Today's timed events plus Myth's focus blocks, in clock order, filled out
 * with a deep-work slot in the morning and an admin slot around noon when the
 * day is still open. Past items are kept (they show what already happened).
 */
export function scheduleOf(state, cc, focus, now = dayjs()) {
  const n = now.hour() * 60 + now.minute();
  const items = [];
  const busy = (min) => items.some((i) => i.start <= min && min < i.end);
  (cc.timeline ?? []).filter((e) => e.start != null).forEach((e) => {
    const label = e.kind === 'focus' ? `Deep work — ${e.title}` : e.title;
    items.push({ start: e.start, end: e.endMin ?? e.start + 60, label, kind: e.kind, past: e.status === 'past' });
  });
  (cc.plan?.blocks ?? []).forEach((b) => {
    const start = toMin(b.start);
    if (busy(start)) return;
    items.push({ start, end: toMin(b.end), label: `Deep work — ${b.title}`, kind: 'focus', past: false });
  });
  // light anchors for the gaps while the day is still open
  const anchors = [
    { start: Math.max(DAY_START + 60, 9 * 60), end: 11 * 60, label: focus?.ref ? `Deep work — ${focus.text.replace(/\.$/, '')}` : 'Deep work', kind: 'focus' },
    { start: 12 * 60, end: 13 * 60, label: 'Admin & inbox', kind: 'admin' },
    { start: 14 * 60, end: 16 * 60, label: 'Project time', kind: 'focus' },
  ];
  if (items.filter((i) => !i.past).length < 4) {
    anchors.forEach((a) => {
      if (a.end <= n || a.start >= DAY_END) return;
      if (items.some((i) => i.start < a.end && a.start < i.end)) return;
      if (a.kind === 'focus' && items.some((i) => i.kind === 'focus' && !i.past && a.label === i.label)) return;
      items.push({ ...a, past: false });
    });
  }
  items.sort((a, b) => a.start - b.start);
  return items.slice(0, 6).map((i) => ({ time: fromMin(i.start), label: i.label, kind: i.kind, past: i.past, now: i.start <= n && n < i.end }));
}

// ---------------------------------------------------------------------------
// the brief
// ---------------------------------------------------------------------------
export function dailyBrief(state, now = dayjs()) {
  const cc = commandCenter(state, now);
  const name = state.settings?.name || 'Boss';
  const focus = focusOf(state, cc, now);
  return {
    greeting: `${greeting(now)}, ${name}.`,
    date: now.format('dddd, MMMM D'),
    today: todayCounts(state, now),
    focus,
    problem: problemOf(state, cc, now),
    personal: personalOf(state, now),
    learning: learningOf(state),
    schedule: scheduleOf(state, cc, focus, now),
    progress: cc.progress,
  };
}

/** Plain text — the assistant's offline answer and the morning toast. */
export function briefText(brief, { schedule = true } = {}) {
  const lines = [
    brief.greeting,
    '',
    `Today — ${brief.today.line}`,
    `Your focus — ${brief.focus.text}${brief.focus.why ? ` (${brief.focus.why})` : ''}`,
    `Potential problem — ${brief.problem.text}`,
    `Personal — ${brief.personal.text}`,
    `Learning — ${brief.learning.text}`,
  ];
  if (schedule && brief.schedule.length) {
    lines.push('', 'Suggested schedule');
    brief.schedule.forEach((s) => lines.push(`${s.time} → ${s.label}`));
  }
  return lines.join('\n');
}

/** The compact shape the assistant sees in DATA.dailyBrief. */
export function briefForAi(brief) {
  return {
    greeting: brief.greeting,
    today: brief.today.line,
    focus: brief.focus.text,
    focusWhy: brief.focus.why ?? undefined,
    potentialProblem: brief.problem.text,
    personal: brief.personal.text,
    learning: brief.learning.text,
    suggestedSchedule: brief.schedule.map((s) => `${s.time} ${s.label}`),
  };
}
