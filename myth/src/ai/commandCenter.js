// Life Command Center — the brain behind the home screen.
// Answers "what matters right now?" from live data: day progress, what needs
// attention, today's timeline and a concrete plan for the remaining hours.
// Pure functions over the store state, so the same logic serves the home
// screen, the assistant and node tests. Every function takes an optional
// `now` (dayjs) so results are deterministic when testing.
import dayjs from 'dayjs';

export const DAY_START = 8 * 60;  // 08:00 — the day starts counting here
export const DAY_END = 21 * 60;   // 21:00 — focus time is measured until here
const DEFAULT_EVENT_MIN = 60;      // events without an end time block an hour
const MIN_BLOCK = 20;              // never plan a focus block shorter than this
const MAX_BLOCKS = 4;              // more than four blocks is a wish list, not a plan
const GAP = 5;                     // breathing room between blocks

// ---------- time helpers ----------
export const toMin = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
};
export const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const nowMin = (now) => now.hour() * 60 + now.minute();
const keyOf = (now) => now.format('YYYY-MM-DD');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function fmtDuration(min) {
  if (!min || min <= 0) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h} hour${h === 1 ? '' : 's'}`;
  if (m === 30) return `${h}.5 hours`;
  return `${h}h ${m}m`;
}

export function greeting(now = dayjs()) {
  const h = now.hour();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

// ---------- today's schedule ----------
// Events dated today (yearly ones by month-day) — meetings are calendar entries too.
export function todayEvents(state, now = dayjs()) {
  const key = keyOf(now);
  const md = now.format('MM-DD');
  return (state.events ?? [])
    .filter((e) => e.date === key || (e.yearly && dayjs(e.date).format('MM-DD') === md))
    .map((e) => ({
      id: e.id, title: e.title, kind: e.kind ?? 'event',
      time: e.time || null, end: e.end || null, taskId: e.taskId ?? null, source: 'event',
    }));
}

const endOf = (e) => (e.end ? toMin(e.end) : toMin(e.time) + DEFAULT_EVENT_MIN);

// ---------- "Your day is 64% complete" ----------
// Commitments = tasks due by today (or finished today), focus blocks, today's
// plan pills, habits and timed events. Done = completed, ticked, or already
// behind you. A task counts once even when it also has a focus block and a
// plan pill. With nothing committed the number falls back to time of day.
export function dayProgress(state, now = dayjs()) {
  const key = keyOf(now);
  const n = nowMin(now);
  const tasks = state.tasks ?? [];
  const items = [];
  const countedIds = new Set();
  const countedTitles = new Set();
  const countTask = (t, done) => {
    items.push({ kind: 'task', done });
    countedIds.add(t.id);
    countedTitles.add(t.title.trim().toLowerCase());
  };

  tasks.forEach((t) => {
    const doneToday = t.status === 'done' && t.completedAt && dayjs(t.completedAt).isSame(now, 'day');
    const dueNow = t.status !== 'done' && t.due && !dayjs(t.due).isAfter(now, 'day');
    if (doneToday || dueNow) countTask(t, !!doneToday);
  });
  todayEvents(state, now)
    .filter((e) => e.time)
    .forEach((e) => {
      if (e.kind === 'focus' && e.taskId) {
        if (countedIds.has(e.taskId)) return; // the task itself is already a commitment
        const task = tasks.find((t) => t.id === e.taskId);
        if (task) countTask(task, task.status === 'done');
        else items.push({ kind: 'focus', done: endOf(e) <= n });
        return;
      }
      items.push({ kind: e.kind, done: endOf(e) <= n });
    });
  ((state.plans ?? {})[key] ?? [])
    .filter((p) => !countedTitles.has(p.text.trim().toLowerCase())) // a pill mirroring a task counts once
    .forEach((p) => items.push({ kind: 'plan', done: !!p.done }));
  (state.habits ?? []).forEach((h) => items.push({ kind: 'habit', done: !!h.log?.[key] }));

  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const timePct = Math.round(Math.max(0, Math.min(1, (n - DAY_START) / (DAY_END - DAY_START))) * 100);
  return { pct: total ? Math.round((done / total) * 100) : timePct, done, total, timePct };
}

// ---------- NEEDS ATTENTION ----------
// severity 3 = act now, 2 = today, 1 = soon. Each item carries a `ref` the UI
// resolves to an action (complete / reschedule / tick / open).
export function attentionItems(state, now = dayjs()) {
  const key = keyOf(now);
  const n = nowMin(now);
  const out = [];
  const dayDiff = (date) => dayjs(date).startOf('day').diff(now.startOf('day'), 'day');
  const open = (state.tasks ?? []).filter((t) => t.status !== 'done');

  open.forEach((t) => {
    let pushed = false;
    if (t.due) {
      const diff = dayDiff(t.due);
      if (diff < 0) {
        out.push({ id: `task:${t.id}`, kind: 'overdue', severity: 3, title: t.title, sub: `${plural(-diff, 'day')} overdue`, ref: { type: 'task', id: t.id }, sort: diff, priority: t.priority });
        pushed = true;
      } else if (diff === 0) {
        out.push({ id: `task:${t.id}`, kind: 'today', severity: 2, title: t.title, sub: 'due today', ref: { type: 'task', id: t.id }, sort: 0, priority: t.priority });
        pushed = true;
      }
    }
    if (!pushed && t.status === 'blocked') {
      out.push({ id: `task:${t.id}`, kind: 'blocked', severity: 2, title: t.title, sub: 'blocked — unblock or reschedule', ref: { type: 'task', id: t.id }, sort: 1, priority: t.priority });
    }
  });

  todayEvents(state, now).forEach((e) => {
    if (e.kind === 'focus') return;
    if (e.time) {
      const s = toMin(e.time);
      const end = endOf(e);
      if (s <= n && n < end) out.push({ id: `event:${e.id}`, kind: 'now', severity: 3, title: e.title, sub: 'happening now', ref: { type: 'event', id: e.id, source: e.source }, eventKind: e.kind, sort: -1 });
      else if (s > n && s - n <= 90) out.push({ id: `event:${e.id}`, kind: 'soon', severity: 2, title: e.title, sub: `starts in ${s - n} min`, ref: { type: 'event', id: e.id, source: e.source }, eventKind: e.kind, sort: s - n });
    }
    if (e.kind === 'bill') out.push({ id: `bill:${e.id}`, kind: 'bill', severity: 2, title: e.title, sub: 'bill due today', ref: { type: 'bill', id: e.id }, sort: 0 });
  });

  (state.events ?? [])
    .filter((e) => e.kind === 'bill' && !e.yearly && e.date !== key)
    .forEach((e) => {
      const diff = dayDiff(e.date);
      if (diff === 1 || diff === 2) out.push({ id: `bill:${e.id}`, kind: 'bill', severity: 1, title: e.title, sub: diff === 1 ? 'bill due tomorrow' : 'bill due in 2 days', ref: { type: 'bill', id: e.id }, sort: diff });
    });

  (state.projects ?? [])
    .filter((p) => p.status === 'active' && p.deadline)
    .forEach((p) => {
      const diff = dayDiff(p.deadline);
      const openCount = open.filter((t) => t.projectId === p.id).length;
      if (diff <= 3 && openCount) {
        const when = diff < 0 ? `deadline ${plural(-diff, 'day')} ago` : diff === 0 ? 'deadline today' : `deadline in ${plural(diff, 'day')}`;
        out.push({ id: `project:${p.id}`, kind: 'deadline', severity: diff <= 0 ? 3 : 2, title: p.name, sub: `${plural(openCount, 'open task')} · ${when}`, ref: { type: 'project', id: p.id }, sort: diff });
      }
    });

  if (now.hour() >= 18) {
    const missed = (state.habits ?? []).filter((h) => !h.log?.[key]);
    if (missed.length) {
      const names = missed.slice(0, 3).map((h) => h.name).join(', ') + (missed.length > 3 ? '…' : '');
      out.push({ id: 'habits', kind: 'habits', severity: 1, title: `${plural(missed.length, 'habit')} still open today`, sub: names, ref: { type: 'habits', ids: missed.map((h) => h.id) }, sort: 5 });
    }
  }

  return out.sort((a, b) => b.severity - a.severity || (a.sort ?? 0) - (b.sort ?? 0) || (b.priority ?? 0) - (a.priority ?? 0));
}

// ---------- TODAY timeline ----------
// All-day items first, then by time. Status: allday / past / now / next / later.
export function timeline(state, now = dayjs()) {
  const n = nowMin(now);
  const tasks = state.tasks ?? [];
  const items = todayEvents(state, now).map((e) => {
    const start = toMin(e.time);
    const endMin = e.time ? endOf(e) : null;
    const task = e.taskId ? tasks.find((t) => t.id === e.taskId) : null;
    const status = start == null ? 'allday' : endMin <= n ? 'past' : start <= n ? 'now' : 'later';
    return { ...e, start, endMin, status, taskDone: task?.status === 'done' };
  });
  items.sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
  const next = items.find((i) => i.status === 'later');
  if (next) next.status = 'next';
  return items;
}

// ---------- free time ----------
// Windows of at least MIN_BLOCK minutes between now (rounded up to 5 min) and
// DAY_END, after removing every timed event, meeting and focus block.
export function freeWindows(state, now = dayjs()) {
  const n = nowMin(now);
  const start = Math.ceil(Math.max(n, DAY_START) / 5) * 5;
  if (start >= DAY_END) return [];
  const busy = todayEvents(state, now)
    .filter((e) => e.time)
    .map((e) => [toMin(e.time), endOf(e)])
    .filter(([, e]) => e > start)
    .sort((a, b) => a[0] - b[0]);
  const windows = [];
  let cursor = start;
  for (const [s, e] of busy) {
    if (s > cursor) windows.push([cursor, Math.min(s, DAY_END)]);
    cursor = Math.max(cursor, e);
    if (cursor >= DAY_END) break;
  }
  if (cursor < DAY_END) windows.push([cursor, DAY_END]);
  return windows.filter(([s, e]) => e - s >= MIN_BLOCK);
}

export const estimateOf = (t) => t.estimate || (t.priority >= 5 ? 90 : t.priority === 4 ? 60 : t.priority === 3 ? 45 : 30);

// Focus blocks already on today's calendar, with their task state.
export function activePlan(state, now = dayjs()) {
  const n = nowMin(now);
  const tasks = state.tasks ?? [];
  const blocks = todayEvents(state, now)
    .filter((e) => e.kind === 'focus' && e.time)
    .map((e) => ({ ...e, start: toMin(e.time), endMin: endOf(e), task: tasks.find((t) => t.id === e.taskId) ?? null }))
    .sort((a, b) => a.start - b.start);
  if (!blocks.length) return null;
  const isDone = (b) => b.task?.status === 'done';
  const done = blocks.filter(isDone).length;
  const remaining = blocks.filter((b) => !isDone(b) && b.endMin > n);
  return {
    blocks, done, total: blocks.length, remaining: remaining.length,
    current: remaining.find((b) => b.start <= n) ?? null,
    next: remaining.find((b) => b.start > n) ?? null,
  };
}

// ---------- MYTH SAYS ----------
// Ranks open tasks (overdue → due today → in progress → high priority → by due
// date), fits them into the free windows and writes a two-sentence
// recommendation. `blocks` is what "Follow the plan" puts on the calendar.
export function suggestPlan(state, now = dayjs()) {
  const key = keyOf(now);
  const n = nowMin(now);
  const windows = freeWindows(state, now);
  const focusMinutes = windows.reduce((a, [s, e]) => a + (e - s), 0);
  const open = (state.tasks ?? []).filter((t) => t.status !== 'done');
  const dayDiff = (t) => (t.due ? dayjs(t.due).startOf('day').diff(now.startOf('day'), 'day') : null);

  // tasks that already have a focus block still ahead of them are not re-planned
  const planned = new Set(
    todayEvents(state, now).filter((e) => e.kind === 'focus' && e.taskId && e.time && endOf(e) > n).map((e) => e.taskId)
  );
  const rank = (t) => {
    const d = dayDiff(t);
    if (d != null && d < 0) return 0;
    if (d === 0) return 1;
    if (t.status === 'doing') return 2;
    if (t.priority >= 4) return 3;
    return 4;
  };
  const candidates = open
    .filter((t) => !planned.has(t.id) && t.status !== 'blocked')
    .map((t) => ({ t, r: rank(t), d: dayDiff(t) ?? 9999 }))
    .sort((a, b) => a.r - b.r || a.d - b.d || b.t.priority - a.t.priority)
    .map((x) => x.t);

  const blocks = [];
  let wi = 0;
  let cursor = windows.length ? windows[0][0] : null;
  for (const t of candidates) {
    if (blocks.length >= MAX_BLOCKS || wi >= windows.length) break;
    let placed = false;
    while (wi < windows.length && !placed) {
      const [ws, we] = windows[wi];
      const s = Math.max(cursor ?? ws, ws);
      const room = we - s;
      if (room < MIN_BLOCK) { wi++; cursor = null; continue; }
      const dur = Math.min(estimateOf(t), room);
      const d = dayDiff(t);
      blocks.push({
        taskId: t.id, title: t.title, start: fromMin(s), end: fromMin(s + dur), minutes: dur,
        why: d != null && d < 0 ? 'overdue' : d === 0 ? 'due today' : t.status === 'doing' ? 'in progress' : t.priority >= 4 ? 'high priority' : 'next up',
      });
      cursor = s + dur + GAP;
      if (cursor >= we) { wi++; cursor = null; }
      placed = true;
    }
  }

  const first = blocks[0];
  const second = blocks[1];
  const firstTask = first ? open.find((t) => t.id === first.taskId) : null;
  const firstDiff = firstTask ? dayDiff(firstTask) : null;
  const soon = todayEvents(state, now)
    .filter((e) => e.time && e.kind !== 'focus')
    .map((e) => ({ e, inMin: toMin(e.time) - n }))
    .filter((x) => x.inMin > 0 && x.inMin <= 90)
    .sort((a, b) => a.inMin - b.inMin)[0];
  const missedHabits = now.hour() >= 18 ? (state.habits ?? []).filter((h) => !h.log?.[key]) : [];
  const hrs = fmtDuration(focusMinutes);

  let kind;
  let message;
  if (!blocks.length) {
    if (focusMinutes < MIN_BLOCK) {
      kind = 'winddown';
      message = missedHabits.length
        ? `The working day is done. ${plural(missedHabits.length, 'habit')} still open — ${missedHabits.map((h) => h.name).slice(0, 3).join(', ')} — worth closing before you switch off.`
        : "The working day is done. Tick off what got finished and let tomorrow's plan wait until morning.";
    } else {
      kind = 'clear';
      message = `Your plate is clear, with ${hrs} of open time. Pull something from the backlog or capture tomorrow's plan while it's quiet.`;
    }
  } else if (firstDiff != null && firstDiff < 0) {
    kind = 'overdue';
    message = `You have ${hrs} of focused time left. I'd clear "${first.title}" first — it's ${plural(-firstDiff, 'day')} overdue — ${second ? `then move to "${second.title}".` : 'and stop there.'}`;
  } else if (soon && toMin(first.start) < toMin(soon.e.time)) {
    kind = 'meeting-first';
    message = `"${soon.e.title}" starts in ${soon.inMin} min. A ${first.minutes}-minute sprint on "${first.title}" fits before it${second ? `; "${second.title}" comes after.` : '.'}`;
  } else {
    kind = 'focus';
    message = `You have ${hrs} of focused time left. I'd finish "${first.title}" before starting anything new${second ? ` — "${second.title}" can wait until it's done.` : '.'}`;
  }

  return {
    kind, message, focusMinutes, blocks,
    signature: blocks.map((b) => `${b.taskId}@${b.start}`).join(','),
  };
}

// One object with everything the home screen and the assistant need.
export function commandCenter(state, now = dayjs()) {
  return {
    now,
    greeting: greeting(now),
    progress: dayProgress(state, now),
    attention: attentionItems(state, now),
    timeline: timeline(state, now),
    plan: suggestPlan(state, now),
    active: activePlan(state, now),
  };
}
