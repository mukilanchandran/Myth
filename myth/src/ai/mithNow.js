// MITH NOW — real-time decision support.
//
// Answers one question: "What should I do now?"  It measures the window until
// the next thing on the clock, picks the single best task that fits, then fills
// what is left with quick wins. Every fact comes from live data; a model may
// second-guess the pick (see aiMithNow in assistant.js) but never invent items.
//
// The engine learns from behaviour (see `learn*` below): suggestions Boss skips
// are demoted, projects worked at a given hour get a boost at that hour, and the
// time a task actually took calibrates future estimates. That state lives in
// the store as `nowLearn` and is fed back in on every call.
//
// Pure functions over a store snapshot with an optional `now`, so the same
// logic serves the modal, the assistant and node tests.
import dayjs from 'dayjs';
import { todayEvents, toMin, fromMin, fmtDuration, DAY_END } from './commandCenter.js';

export const BUFFER = 3;        // minutes kept free before the next event
export const QUICK_MAX = 15;    // a quick win takes at most this long
export const MIN_USEFUL = 10;   // below this the window fits quick wins only
const MAX_QUICK = 3;

const nowMin = (now) => now.hour() * 60 + now.minute();
const keyOf = (now) => now.format('YYYY-MM-DD');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// learning — what Boss's own choices teach the engine
// ---------------------------------------------------------------------------
export const emptyLearn = () => ({
  skips: {},        // taskId -> { count, last: 'YYYY-MM-DD' }
  projectHour: {},  // projectId -> { [hour]: count }  (when work on a project actually starts)
  durations: {},    // priority bucket -> smoothed real minutes (start → done)
  accepted: 0, skipped: 0, finished: 0,
});

const bucketOf = (task) => `p${Math.max(1, Math.min(5, task.priority ?? 3))}`;
const DEFAULT_MIN = { p5: 90, p4: 60, p3: 45, p2: 30, p1: 30 };

// Estimate in minutes: an explicit estimate wins, then what Boss's own history
// says tasks of this priority really take, then the defaults.
export function estimateOf(task, learn) {
  if (task.estimate) return task.estimate;
  const b = bucketOf(task);
  const learned = learn?.durations?.[b];
  if (learned) return Math.max(10, Math.min(180, Math.round(learned / 5) * 5));
  return DEFAULT_MIN[b] ?? 45;
}

export function learnSkip(learn = emptyLearn(), task, now = dayjs()) {
  const cur = learn.skips[task.id] ?? { count: 0, last: null };
  return {
    ...learn,
    skipped: (learn.skipped ?? 0) + 1,
    skips: { ...learn.skips, [task.id]: { count: cur.count + 1, last: keyOf(now) } },
  };
}

export function learnStart(learn = emptyLearn(), task, now = dayjs()) {
  const next = { ...learn, accepted: (learn.accepted ?? 0) + 1, projectHour: { ...learn.projectHour } };
  if (task.projectId) {
    const h = String(now.hour());
    const hours = { ...(next.projectHour[task.projectId] ?? {}) };
    hours[h] = (hours[h] ?? 0) + 1;
    next.projectHour[task.projectId] = hours;
  }
  // a task that was started is no longer "skipped"
  if (next.skips?.[task.id]) {
    next.skips = { ...next.skips };
    delete next.skips[task.id];
  }
  return next;
}

// Exponential moving average of how long tasks of this priority really take.
export function learnFinish(learn = emptyLearn(), task, minutesSpent) {
  if (!minutesSpent || minutesSpent < 3) return { ...learn, finished: (learn.finished ?? 0) + 1 };
  const b = bucketOf(task);
  const prev = learn.durations?.[b];
  const ema = prev ? Math.round(prev * 0.7 + minutesSpent * 0.3) : Math.round(minutesSpent);
  return { ...learn, finished: (learn.finished ?? 0) + 1, durations: { ...learn.durations, [b]: ema } };
}

// Number of tasks with a learned signal — used by the UI to say how "trained" Mith is.
export function learnSummary(learn = emptyLearn()) {
  const signals = (learn.accepted ?? 0) + (learn.skipped ?? 0) + (learn.finished ?? 0);
  return { signals, accepted: learn.accepted ?? 0, skipped: learn.skipped ?? 0, finished: learn.finished ?? 0 };
}

// ---------------------------------------------------------------------------
// the window: how long until the next thing on the clock?
// ---------------------------------------------------------------------------
export function currentWindow(state, now = dayjs()) {
  const n = nowMin(now);
  const timed = todayEvents(state, now)
    .filter((e) => e.time && e.kind !== 'focus')
    .map((e) => ({ ...e, start: toMin(e.time), endMin: e.end ? toMin(e.end) : toMin(e.time) + 60 }))
    .sort((a, b) => a.start - b.start);
  const inside = timed.find((e) => e.start <= n && n < e.endMin);
  const from = inside ? inside.endMin : n;
  const next = timed.find((e) => e.start > from);

  let until;
  let kind;
  let minutes;
  if (next) {
    until = next.start;
    kind = next.kind === 'meeting' ? 'meeting' : 'event';
    minutes = Math.max(0, until - from - BUFFER);
  } else {
    until = DAY_END;
    kind = 'day';
    minutes = Math.max(0, until - from);
  }
  if (from >= DAY_END) { kind = 'night'; minutes = 0; }

  return {
    now: n, from, until, minutes, kind,
    inside: inside ? { id: inside.id, title: inside.title, endsAt: fromMin(inside.endMin), minutesLeft: inside.endMin - n } : null,
    next: next ? { id: next.id, title: next.title, at: next.time, kind: next.kind, source: next.source, inMin: next.start - n } : null,
  };
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------
function scoreTask(t, ctx) {
  const { now, window, learn } = ctx;
  const reasons = [];
  let score = 0;
  const d = t.due ? dayjs(t.due).startOf('day').diff(now.startOf('day'), 'day') : null;

  if (d != null && d < 0) { score += 100 + Math.min(20, -d * 2); reasons.push(`${plural(-d, 'day')} overdue`); }
  else if (d === 0) { score += 80; reasons.push('due today'); }
  else if (d === 1) { score += 55; reasons.push('due tomorrow'); }
  else if (d != null && d <= 3) { score += 40; reasons.push(`due in ${plural(d, 'day')}`); }
  if (t.status === 'doing') { score += 30; reasons.push('already in progress'); }
  score += (t.priority ?? 3) * 6;
  if ((t.priority ?? 3) >= 5) reasons.push('top priority');
  else if ((t.priority ?? 3) === 4) reasons.push('high priority');

  const est = estimateOf(t, learn);
  if (est <= window.minutes) { score += 12; reasons.push(`fits in the ${fmtDuration(window.minutes)} you have`); }
  else if (window.minutes >= MIN_USEFUL) { score -= Math.min(30, (est - window.minutes) / 5); }

  // learned: this project tends to get worked at this hour
  if (t.projectId && learn?.projectHour?.[t.projectId]) {
    const hours = learn.projectHour[t.projectId];
    const h = now.hour();
    const hits = (hours[h] ?? 0) + 0.5 * ((hours[h - 1] ?? 0) + (hours[h + 1] ?? 0));
    if (hits >= 1) { score += Math.min(16, hits * 4); reasons.push(`you usually work on this project around ${now.format('h A').toLowerCase()}`); }
  }
  // learned: Boss keeps skipping this one
  const sk = learn?.skips?.[t.id];
  if (sk?.count) {
    score -= sk.last === keyOf(now) ? 45 : Math.min(30, sk.count * 10);
  }
  return { score, reasons, est };
}

// ---------------------------------------------------------------------------
// the recommendation
// ---------------------------------------------------------------------------
// opts.exclude: Set of task ids skipped in this sitting (never suggested again today's session)
// opts.prefer:  a task id the model (or Boss) wants as the primary, if it exists and is open
export function mithNow(state, now = dayjs(), opts = {}) {
  const exclude = opts.exclude ?? new Set();
  const learn = state.nowLearn ?? emptyLearn();
  const window = currentWindow(state, now);
  const key = keyOf(now);
  const projects = state.projects ?? [];
  const projectName = (id) => projects.find((p) => p.id === id)?.name ?? null;

  const open = (state.tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'blocked' && !exclude.has(t.id));
  const ctx = { now, window, learn };
  const scored = open
    .map((t) => ({ t, ...scoreTask(t, ctx) }))
    .sort((a, b) => b.score - a.score || (a.t.due ?? '9999').localeCompare(b.t.due ?? '9999'));

  // ----- primary -----
  let primary = null;
  if (window.minutes >= MIN_USEFUL && scored.length) {
    let pick = opts.prefer ? scored.find((s) => s.t.id === opts.prefer) : null;
    if (!pick) pick = scored.find((s) => s.est <= window.minutes) ?? null;
    let partial = false;
    if (!pick) { pick = scored[0]; partial = true; }
    else if (pick.est > window.minutes) partial = true;
    const minutes = Math.min(pick.est, window.minutes);
    primary = {
      kind: 'task', id: pick.t.id, title: pick.t.title, project: projectName(pick.t.projectId),
      minutes, estimate: pick.est, partial, priority: pick.t.priority, due: pick.t.due,
      status: pick.t.status, reasons: pick.reasons, score: Math.round(pick.score),
      why: pick.reasons[0] ?? 'next in line',
    };
  }

  // ----- quick wins for whatever is left -----
  const remaining = Math.max(0, window.minutes - (primary?.minutes ?? 0));
  const pool = [];
  scored
    .filter((s) => s.t.id !== primary?.id && s.est <= QUICK_MAX)
    .forEach((s) => pool.push({ kind: 'task', id: s.t.id, title: s.t.title, minutes: s.est, rank: 100 + s.score, project: projectName(s.t.projectId) }));

  const planItems = ((state.plans ?? {})[key] ?? []).filter((p) => !p.done);
  const taskTitles = new Set((state.tasks ?? []).map((t) => t.title.trim().toLowerCase()));
  planItems
    .filter((p) => !taskTitles.has(p.text.trim().toLowerCase()))
    .forEach((p) => pool.push({ kind: 'plan', id: p.id, title: p.text, minutes: 10, rank: 60 }));

  if (now.hour() >= 12) {
    (state.habits ?? []).filter((h) => !h.log?.[key]).forEach((h) =>
      pool.push({ kind: 'habit', id: h.id, title: h.name, minutes: 5, rank: 20 }));
  }

  pool.sort((a, b) => b.rank - a.rank);
  const quick = [];
  let left = remaining;
  for (const q of pool) {
    if (quick.length >= MAX_QUICK) break;
    if (q.minutes <= left) { quick.push(q); left -= q.minutes; }
  }

  // ----- alternatives (what the model, or Boss, can swap in) -----
  const alternatives = scored
    .filter((s) => s.t.id !== primary?.id)
    .slice(0, 4)
    .map((s) => ({ id: s.t.id, title: s.t.title, minutes: s.est, why: s.reasons[0] ?? 'next in line', project: projectName(s.t.projectId), fits: s.est <= window.minutes }));

  // ----- words -----
  const headline = headlineFor(window);
  let mood;
  if (window.kind === 'night') mood = 'night';
  else if (!primary && !quick.length) mood = window.minutes < MIN_USEFUL ? 'tight' : 'clear';
  else mood = primary ? 'focus' : 'quick';

  return {
    window, headline, mood, primary, quick, remaining, leftAfterQuick: left, alternatives,
    learn: learnSummary(learn),
    signature: `${window.until}:${primary?.id ?? '-'}:${quick.map((q) => q.id).join(',')}`,
  };
}

function headlineFor(w) {
  if (w.kind === 'night') return 'The working day is over.';
  if (w.inside) {
    const after = w.next ? `then ${fmtDuration(w.minutes)} before ${w.next.title}` : `then ${fmtDuration(w.minutes)} of open time`;
    return `You're in "${w.inside.title}" until ${w.inside.endsAt} — ${after}.`;
  }
  if (w.next) {
    const what = w.next.kind === 'meeting' ? 'your next meeting' : `"${w.next.title}"`;
    return `You have ${fmtDuration(w.minutes)} before ${what}.`;
  }
  return `You have ${fmtDuration(w.minutes)} until the day winds down.`;
}

// Plain-text version for the assistant and for notifications.
export function nowText(r) {
  const lines = [r.headline];
  if (r.window.next && r.window.kind === 'meeting') lines[0] += ` (${r.window.next.title} at ${r.window.next.at})`;
  if (r.mood === 'night') {
    lines.push('Tick off what got finished and let tomorrow wait until morning.');
    return lines.join('\n');
  }
  if (r.primary) {
    lines.push(
      '', 'Best use of this time:',
      `→ ${r.primary.title}${r.primary.project ? ` (${r.primary.project})` : ''}`,
      r.primary.partial
        ? `   Make a dent: ${r.primary.minutes} of ~${r.primary.estimate} min · ${r.primary.why}`
        : `   Estimated: ${r.primary.minutes} min · ${r.primary.why}`,
    );
  }
  if (r.quick.length) {
    lines.push('', r.primary ? `Then — ${r.remaining >= 60 ? fmtDuration(r.remaining) : `${r.remaining} minutes`} remaining.` : 'Quick wins that fit:');
    r.quick.forEach((q) => lines.push(`• ${q.title} (${q.minutes} min)`));
  } else if (r.primary && r.remaining >= 5) {
    lines.push('', `Then ${r.remaining} minutes to breathe before the next thing.`);
  }
  if (!r.primary && !r.quick.length) {
    lines.push(r.mood === 'tight' ? 'Not enough room to start anything — take a breath, glance at the prep for what is next.' : 'Your plate is clear. Pull something from the backlog or capture tomorrow.');
  }
  return lines.join('\n');
}

// Everything the model needs to second-guess the pick, and nothing private.
export function nowBrief(r) {
  return {
    now: r.window.now, minutesAvailable: r.window.minutes,
    next: r.window.next ? { title: r.window.next.title, at: r.window.next.at, kind: r.window.next.kind } : null,
    inside: r.window.inside,
    recommended: r.primary ? { id: r.primary.id, title: r.primary.title, minutes: r.primary.minutes, reasons: r.primary.reasons, partial: r.primary.partial } : null,
    alternatives: r.alternatives,
    quickWins: r.quick.map((q) => ({ id: q.id, title: q.title, minutes: q.minutes, kind: q.kind })),
    remainingAfter: r.remaining,
  };
}
