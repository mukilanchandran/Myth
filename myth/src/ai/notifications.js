// Notification Intelligence Engine — says something only when it can say why.
//
// Every notification is a small piece of reasoning over the same live data the
// Command Center and the Context Engine use:
//
//   You should handle this today.
//   Proposal is due tomorrow and needs ~2 hours.
//   Your calendar is already full tomorrow (3 meetings).
//   You have 3 hours free today — the 14:00–16:00 slot fits it.
//
// Rules produce candidates (smartNotifications). A delivery policy decides what
// actually reaches the lock screen (selectForDelivery): quiet hours, a daily
// budget, at most two per check, and never the same situation twice unless it
// changed or got worse. The user can snooze or dismiss (isMuted). Pure
// functions over a store snapshot — the same code runs in the app, in node
// tests and in the server-side push digest.
import dayjs from 'dayjs';
import { todayEvents, freeWindows, fmtDuration, estimateOf, fromMin, DAY_START, suggestPlan } from './commandCenter.js';
import { relDay, tokens } from './text.js';
import { reminderNotifications } from './reminders.js';

export const LEVEL_RANK = { act: 3, plan: 2, fyi: 1 };
export const DEFAULT_PREFS = { notifyBudget: 4, quietStart: 22, quietEnd: 7 };
// minutes after midnight; "plan"/"fyi" items wait for one of these (± WINDOW_SPAN)
export const DELIVERY_WINDOWS = [8 * 60 + 30, 13 * 60, 18 * 60 + 30];
const WINDOW_SPAN = 60;
const MAX_PER_TICK = 2;
const KIND_ORDER = ['reminder', 'travel', 'overbooked', 'room', 'overdue', 'deadline', 'prep', 'followup', 'bill', 'habit', 'birthday', 'stale', 'plan'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const keyOf = (d) => d.format('YYYY-MM-DD');
const minOf = (d) => d.hour() * 60 + d.minute();
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

// ---------------------------------------------------------------------------
// time budget helpers
// ---------------------------------------------------------------------------
const startOfWork = (d) => d.startOf('day').add(DAY_START, 'minute');

// Free minutes on a date: from `now` when it is today, from the start of the working day otherwise.
export function freeMinutesOn(state, date, now = dayjs()) {
  const d = dayjs(date);
  if (d.isBefore(now, 'day')) return 0;
  const at = d.isSame(now, 'day') ? now : startOfWork(d);
  return freeWindows(state, at).reduce((a, [s, e]) => a + (e - s), 0);
}

export function daySummary(state, date, now = dayjs()) {
  const d = dayjs(date);
  const at = d.isSame(now, 'day') ? now : startOfWork(d);
  const meetings = todayEvents(state, at).filter((e) => e.time && e.kind !== 'focus').length;
  return { free: freeMinutesOn(state, date, now), meetings };
}

export function firstFreeSlot(state, now, minutes) {
  const w = freeWindows(state, now).find(([s, e]) => e - s >= minutes);
  return w ? { start: fromMin(w[0]), end: fromMin(w[0] + minutes) } : null;
}

// consecutive kept days ending yesterday
export function streakOf(habit, now = dayjs()) {
  let n = 0;
  for (let i = 1; i <= 366; i++) {
    if (habit.log?.[keyOf(now.subtract(i, 'day'))]) n += 1;
    else break;
  }
  return n;
}

const yearlyDiff = (e, now) => {
  let d = dayjs(e.date);
  if (e.yearly) {
    d = d.year(now.year());
    if (d.isBefore(now, 'day')) d = d.add(1, 'year');
  }
  return d.startOf('day').diff(now.startOf('day'), 'day');
};

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------
export function smartNotifications(state, now = dayjs()) {
  const out = [];
  const today = keyOf(now);
  const tomorrow = keyOf(now.add(1, 'day'));
  const open = (state.tasks ?? []).filter((t) => t.status !== 'done');
  const dayDiff = (date) => dayjs(date).startOf('day').diff(now.startOf('day'), 'day');
  const todayFree = freeMinutesOn(state, today, now);
  const tmrw = daySummary(state, tomorrow, now);

  // 1. Due tomorrow, but tomorrow has no room for it
  const dueTomorrow = open.filter((t) => t.due === tomorrow && t.status !== 'blocked').sort((a, b) => estimateOf(b) - estimateOf(a));
  if (dueTomorrow.length) {
    const need = sum(dueTomorrow, estimateOf);
    if (need > tmrw.free) {
      const t = dueTomorrow[0];
      const e = estimateOf(t);
      const single = dueTomorrow.length === 1;
      const fitsToday = todayFree >= e;
      const slot = fitsToday ? firstFreeSlot(state, now, e) : null;
      const tomorrowLine = tmrw.free < 30
        ? `Your calendar is already full tomorrow${tmrw.meetings ? ` (${plural(tmrw.meetings, 'meeting')})` : ''}.`
        : `Tomorrow only has ${fmtDuration(tmrw.free)} free${tmrw.meetings ? ` around ${plural(tmrw.meetings, 'meeting')}` : ''}.`;
      out.push({
        key: single ? `room:${t.id}` : `room:${tomorrow}`, fp: `${need}/${tmrw.free}/${fitsToday}`, kind: 'room',
        level: fitsToday ? 'act' : 'plan', ref: { type: 'task', id: t.id },
        headline: fitsToday ? 'You should handle this today.' : single ? 'Tomorrow can’t absorb this.' : 'Tomorrow is overcommitted.',
        lines: [
          single
            ? `${t.title} is due tomorrow and needs ~${fmtDuration(e)}.`
            : `${plural(dueTomorrow.length, 'task')} are due tomorrow and need ~${fmtDuration(need)} together — "${t.title}" is the biggest.`,
          tomorrowLine,
          fitsToday
            ? `You have ${fmtDuration(todayFree)} free today${slot ? ` — the ${slot.start}–${slot.end} slot fits it` : ''}.`
            : `Today only has ${fmtDuration(todayFree)} left too — split it or push the date.`,
        ],
        action: slot
          ? { type: 'block', taskId: t.id, title: t.title, start: slot.start, end: slot.end, minutes: e, label: `Block ${slot.start}–${slot.end} today` }
          : { type: 'open', panel: 'tasks', label: 'Open tasks' },
      });
    }
  }

  // 2. Today is overbooked: what is due by today does not fit in what is left of it
  const dueByToday = open.filter((t) => t.due && dayDiff(t.due) <= 0 && t.status !== 'blocked');
  const needToday = sum(dueByToday, estimateOf);
  if (dueByToday.length >= 2 && needToday > todayFree + 15) {
    const movable = [...dueByToday].sort((a, b) => a.priority - b.priority || b.due.localeCompare(a.due));
    const move = [];
    let remaining = needToday;
    for (const t of movable) {
      if (remaining <= todayFree) break;
      move.push(t);
      remaining -= estimateOf(t);
    }
    const moveNeed = sum(move, estimateOf);
    out.push({
      key: `overbooked:${today}`, fp: `${dueByToday.length}/${needToday}/${todayFree}`, kind: 'overbooked', level: 'act',
      headline: 'Today is overbooked.',
      lines: [
        `${plural(dueByToday.length, 'task')} due by today need ~${fmtDuration(needToday)}; ${fmtDuration(todayFree)} of free time is left.`,
        move.length
          ? `Move ${move.slice(0, 2).map((t) => `"${t.title}"`).join(' and ')}${move.length > 2 ? ` and ${move.length - 2} more` : ''} to tomorrow${tmrw.free >= moveNeed ? ' — it has room.' : ', and clear something there too.'}`
          : 'Trim the smallest one so the rest fits.',
      ],
      action: move.length
        ? { type: 'move', taskIds: move.map((t) => t.id), date: tomorrow, label: move.length === 1 ? 'Move it to tomorrow' : `Move ${move.length} tasks to tomorrow` }
        : { type: 'open', panel: 'tasks', label: 'Open tasks' },
    });
  }

  // 3. Overdue: one notification for the whole cluster, never one per task
  const overdue = open.filter((t) => t.due && dayDiff(t.due) < 0).sort((a, b) => a.due.localeCompare(b.due));
  if (overdue.length) {
    const oldest = -dayDiff(overdue[0].due);
    out.push({
      key: 'overdue', fp: overdue.map((t) => t.id).sort().join(','), kind: 'overdue',
      level: overdue.some((t) => t.priority >= 4) || oldest >= 3 ? 'act' : 'plan',
      headline: overdue.length === 1 ? `"${overdue[0].title}" slipped ${plural(oldest, 'day')} ago.` : `${overdue.length} tasks have slipped past their dates.`,
      lines: [
        ...overdue.slice(0, 3).map((t) => `• ${t.title} — ${plural(-dayDiff(t.due), 'day')} late`),
        overdue.length > 3 ? `• …and ${overdue.length - 3} more` : null,
        'Give each a real date or drop it — an overdue list stops meaning anything.',
      ].filter(Boolean),
      action: { type: 'open', panel: 'tasks', label: 'Reschedule' },
    });
  }

  // 4. A project deadline that the remaining free time cannot cover
  (state.projects ?? []).filter((p) => p.status === 'active' && p.deadline).forEach((p) => {
    const diff = dayDiff(p.deadline);
    if (diff < 0 || diff > 10) return;
    const pt = open.filter((t) => t.projectId === p.id);
    if (!pt.length) return;
    const need = sum(pt, estimateOf);
    let freeUntil = 0;
    for (let i = 0; i <= diff; i++) freeUntil += freeMinutesOn(state, keyOf(now.add(i, 'day')), now);
    if (need <= freeUntil) return;
    out.push({
      key: `deadline:${p.id}`, fp: `${pt.length}/${need}/${freeUntil}`, kind: 'deadline', level: diff <= 2 ? 'act' : 'plan', ref: { type: 'project', id: p.id },
      headline: `"${p.name}" won’t make ${relDay(p.deadline, now).toLowerCase()} at this pace.`,
      lines: [
        `${plural(pt.length, 'open task')} need ~${fmtDuration(need)}; only ${fmtDuration(freeUntil)} is free before then.`,
        'Cut scope, move tasks out or push the deadline — decide now rather than on the day.',
      ],
      action: { type: 'open', panel: 'projects', label: 'Open project' },
    });
  });

  // 5. Bills within two days, with what they cost last time
  (state.events ?? []).filter((e) => e.kind === 'bill').forEach((e) => {
    const diff = yearlyDiff(e, now);
    if (diff < 0 || diff > 2) return;
    const words = tokens(e.title);
    const last = (state.transactions ?? [])
      .filter((tx) => tx.type === 'expense' && tokens(`${tx.note ?? ''} ${tx.category ?? ''}`).some((w) => words.includes(w)))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push({
      key: `bill:${e.id}`, fp: String(diff), kind: 'bill', level: diff === 0 ? 'act' : 'fyi',
      headline: `${e.title} is due ${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : 'in 2 days'}.`,
      lines: [last
        ? `Last time it was ₹${Number(last.amount).toLocaleString('en-IN')} (${dayjs(last.date).format('MMM D')}).`
        : 'No past payment on record — log it when paid and Myth will predict the amount next time.'],
      action: { type: 'open', panel: 'finance', label: 'Open finance' },
    });
  });

  // 8. Habit streaks that end at midnight (evening only, real streaks only)
  if (now.hour() >= 19) {
    const atRisk = (state.habits ?? [])
      .filter((h) => !h.log?.[today])
      .map((h) => ({ h, streak: streakOf(h, now) }))
      .filter((x) => x.streak >= 3)
      .sort((a, b) => b.streak - a.streak);
    if (atRisk.length) {
      out.push({
        key: `streak:${today}`, fp: atRisk.map((x) => x.h.id).join(','), kind: 'habit', level: 'plan',
        headline: atRisk.length === 1 ? `Your ${atRisk[0].streak}-day "${atRisk[0].h.name}" streak ends at midnight.` : `${atRisk.length} streaks end at midnight.`,
        lines: [
          ...(atRisk.length > 1 ? atRisk.slice(0, 4).map((x) => `• ${x.h.name} — ${plural(x.streak, 'day')}`) : []),
          'Ticking it takes a minute; rebuilding a streak takes weeks.',
        ],
        action: { type: 'open', panel: 'habits', label: 'Tick habits' },
      });
    }
  }

  // 9. A birthday or anniversary with nothing planned for it
  (state.events ?? []).filter((e) => e.yearly && e.kind === 'birthday').forEach((e) => {
    const diff = yearlyDiff(e, now);
    if (diff < 0 || diff > 1) return;
    const name = (e.title.match(/^(.+?)['’]s\b/) ?? [null, e.title])[1].trim();
    const planned = open.some((t) => t.title.toLowerCase().includes(name.toLowerCase()));
    if (planned) return;
    const date = keyOf(now.add(diff, 'day'));
    out.push({
      key: `bday:${e.id}:${now.year()}`, fp: String(diff), kind: 'birthday', level: diff === 0 ? 'act' : 'plan',
      headline: `${e.title} is ${diff === 0 ? 'today' : 'tomorrow'}.`,
      lines: ['Nothing is planned for it yet — no call, gift or wish on your list.'],
      action: { type: 'task', title: `Wish ${name}${diff === 0 ? '' : ' — call or gift'}`, due: date, label: 'Add a reminder task' },
    });
  });

  // 10. Something has sat "in progress" for days
  open.filter((t) => t.status === 'doing' && t.startedAt).forEach((t) => {
    const days = now.diff(dayjs(t.startedAt), 'day');
    if (days < 3 || (t.due && dayDiff(t.due) <= 1)) return;
    out.push({
      key: `stale:${t.id}`, fp: String(days), kind: 'stale', level: 'fyi', ref: { type: 'task', id: t.id },
      headline: `"${t.title}" has been in progress for ${plural(days, 'day')}.`,
      lines: ['Finish it, or park it back in the backlog so it stops weighing on every day.'],
      action: { type: 'open', panel: 'tasks', label: 'Open tasks' },
    });
  });

  // 11. A working morning with real work, real time and no plan
  if (now.hour() >= 8 && now.hour() < 11) {
    const plan = suggestPlan(state, now);
    const hasFocus = todayEvents(state, now).some((e) => e.kind === 'focus');
    const pills = (state.plans?.[today] ?? []).length;
    if (!hasFocus && !pills && plan.blocks.length >= 2 && plan.focusMinutes >= 120) {
      out.push({
        key: `plan:${today}`, fp: plan.signature, kind: 'plan', level: 'fyi',
        headline: 'Your day has no plan yet.',
        lines: [
          `${fmtDuration(plan.focusMinutes)} of free time and ${plural(open.length, 'open task')}.`,
          `Myth would start with "${plan.blocks[0].title}" at ${plan.blocks[0].start}.`,
        ],
        action: { type: 'followPlan', blocks: plan.blocks, label: "Follow Myth's plan" },
      });
    }
  }

  // 12. Reminders — the user asked to be told at this moment (see ai/reminders.js)
  out.push(...reminderNotifications(state, now));

  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

// ---------------------------------------------------------------------------
// snooze / dismiss
// muted[key] = { until: ISO, fp: string | null } — a dismiss is bound to the
// fingerprint (the situation changing brings it back); a snooze is not.
// ---------------------------------------------------------------------------
export function isMuted(n, muted = {}, now = dayjs()) {
  const m = muted?.[n.key];
  if (!m) return false;
  if (!dayjs(m.until).isAfter(now)) return false;
  return m.fp == null || m.fp === n.fp;
}

export function visibleNotifications(state, now = dayjs()) {
  return smartNotifications(state, now).filter((n) => !isMuted(n, state.notifyMuted, now));
}

// ---------------------------------------------------------------------------
// delivery policy — what may interrupt, and when
// ---------------------------------------------------------------------------
export function prefsOf(settings = {}) {
  return {
    notifyBudget: settings.notifyBudget ?? DEFAULT_PREFS.notifyBudget,
    quietStart: settings.quietStart ?? DEFAULT_PREFS.quietStart,
    quietEnd: settings.quietEnd ?? DEFAULT_PREFS.quietEnd,
  };
}

export function inQuietHours(now, prefs = DEFAULT_PREFS) {
  const h = now.hour();
  const { quietStart, quietEnd } = prefsOf(prefs);
  if (quietStart === quietEnd) return false;
  return quietStart > quietEnd ? h >= quietStart || h < quietEnd : h >= quietStart && h < quietEnd;
}

export function inDeliveryWindow(now) {
  const n = minOf(now);
  return DELIVERY_WINDOWS.some((w) => Math.abs(n - w) <= WINDOW_SPAN);
}

// log: [{ key, fp, level, ts }] — what already reached this device.
export function selectForDelivery(notifs, log = [], now = dayjs(), prefs = DEFAULT_PREFS) {
  const p = prefsOf(prefs);
  const quiet = inQuietHours(now, p);
  const today = keyOf(now);
  // reminders (`exempt`) never count against the daily budget
  const sentToday = log.filter((l) => keyOf(dayjs(l.ts)) === today && !l.exempt).length;
  const budgetLeft = p.notifyBudget - sentToday;
  const lastTs = log.filter((l) => !l.exempt).reduce((a, l) => Math.max(a, l.ts), 0);
  const sinceLastMin = lastTs ? (now.valueOf() - lastTs) / 60000 : Infinity;
  const window = inDeliveryWindow(now);
  const picked = [];
  let regular = 0;
  const saidAlready = (n) => {
    const prev = log.filter((l) => l.key === n.key).sort((a, b) => b.ts - a.ts)[0];
    if (!prev) return false;
    const escalated = LEVEL_RANK[n.level] > LEVEL_RANK[prev.level];
    const changed = prev.fp !== n.fp;
    const ageH = (now.valueOf() - prev.ts) / 3600000;
    if (!changed && !escalated) return true; // nothing new to say
    if (changed && !escalated && ageH < 6) return true; // changed, but it was said recently
    return false;
  };
  for (const n of notifs) {
    if (saidAlready(n)) continue;
    if (n.exempt) {
      // a reminder the user set for this moment: outside the windows and the
      // budget; quiet hours only hold back the heads-up, never the alarm itself
      if (quiet && n.level !== 'act') continue;
      if (picked.filter((x) => x.exempt).length >= 3) continue;
      picked.push(n);
      continue;
    }
    if (quiet || budgetLeft <= 0) continue;
    if (regular >= Math.min(MAX_PER_TICK, budgetLeft)) continue;
    if (n.level === 'fyi' && !window) continue;
    if (n.level === 'plan' && !window && sinceLastMin < 180) continue;
    picked.push(n);
    regular++;
  }
  return picked;
}

// One lock-screen message out of several notifications (used by the server digest).
export function composeDigest(notifs, greeting = null) {
  if (!notifs.length) return null;
  const [top, ...rest] = notifs;
  const body = [top.lines.join(' '), rest.length ? `+${rest.length} more in Myth: ${rest.slice(0, 2).map((n) => n.headline.replace(/\.$/, '')).join(' · ')}` : null].filter(Boolean).join('\n');
  return { title: greeting && top.level !== 'act' ? `Good ${greeting}, Boss — ${top.headline}` : top.headline, body };
}

// ---------------------------------------------------------------------------
// the action attached to a notification, applied to the store
// ---------------------------------------------------------------------------
export function performAction(action, store, ui) {
  if (!action) return null;
  const s = store.getState();
  switch (action.type) {
    case 'block':
      s.applyPlan([{ taskId: action.taskId, title: action.title, start: action.start, end: action.end, minutes: action.minutes }]);
      return `Blocked ${action.start}–${action.end} today for "${action.title}".`;
    case 'move':
      action.taskIds.forEach((id) => s.updateTask(id, { due: action.date }));
      return `Moved ${plural(action.taskIds.length, 'task')} to ${relDay(action.date).toLowerCase()}.`;
    case 'open':
      ui?.setPanel?.(action.panel);
      return null;
    case 'reminderDone':
      s.completeReminder(action.id);
      return `"${action.title}" done.`;
    case 'reminderSnooze':
      s.snoozeReminder(action.id, action.until);
      return `Snoozed "${action.title}" until ${dayjs(action.until).format('HH:mm')}.`;
    case 'task':
      s.addTask({ title: action.title, due: action.due, priority: 4 });
      return `Added "${action.title}".`;
    case 'followPlan':
      s.applyPlan(action.blocks);
      return `${plural(action.blocks.length, 'focus block')} added to today.`;
    default:
      return null;
  }
}
