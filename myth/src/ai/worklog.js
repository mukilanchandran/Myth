// Track — the work-log engine. A day is the list of what got done (name, description,
// project, status); time is optional. Pure functions, no React, no I/O, node-testable:
//   parseDuration / parseRange   "1h 30m", "90 min", "half an hour" · "10am-11:30am", "14:00 to 15:30"
//   parseWorkLog      "worked on GHMC dashboard for 2h yesterday" → title, minutes, start, end, date, project, category
//   looksLikeWorkLog  is this sentence a work log (and not an expense, a task, a meeting)?
//   placeEntry        start/end/minutes for an entry that carries a clock time (the timer, "3pm-4pm")
//   entriesOn / byProject / byCategory / weekDays / trackStreak   the numbers the panel shows
//   autoSummary       the daily summary Myth keeps when nobody wrote one
//   workRundown / timeOnProject / trackForAi   what the assistant answers from
//   suggestWorkLogs   finished tasks, meetings and focus blocks that are not logged yet
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';

// the kind of work (guessed from the words) — `tint` is the pastel, `color` the accent
export const WORK_CATEGORIES = {
  dev: { label: 'Development', color: '#1864ab', tint: '#d3e9fb' },
  design: { label: 'Design', color: '#a61e4d', tint: '#fbd9ec' },
  meeting: { label: 'Meetings', color: '#0b7285', tint: '#c8eef3' },
  research: { label: 'Research', color: '#5f3dc4', tint: '#e0dafb' },
  docs: { label: 'Writing & docs', color: '#c2530a', tint: '#fde2c8' },
  learning: { label: 'Learning', color: '#2b8a3e', tint: '#d5f1da' },
  admin: { label: 'Admin & ops', color: '#8f6a00', tint: '#fbedb9' },
  personal: { label: 'Personal', color: '#495057', tint: '#e6ebe8' },
};

const CATEGORY_WORDS = [
  ['meeting', /\b(?:meeting|standup|stand-up|sync|call|1:1|demo|presentation|interview|discussion|review call|huddle|workshop|client)\b/i],
  ['design', /\b(?:design(?:ed|ing)?|figma|ui|ux|wireframes?|mockups?|prototypes?|logos?|layouts?|illustrations?|style guide)\b/i],
  ['docs', /\b(?:wrote|writing|write|document(?:ed|ation)?|docs?|readme|report|proposal|blog|article|email|spec|prd|notes)\b/i],
  ['research', /\b(?:research(?:ed|ing)?|explor(?:ed|ing)|investigat(?:ed|ing)|analy[sz](?:ed|ing|is)|compar(?:ed|ing)|evaluat(?:ed|ing)|poc|spike)\b/i],
  ['learning', /\b(?:learn(?:ed|ing|t)?|stud(?:y|ied|ying)|course|tutorial|practi[cs](?:ed|ing|e)|training|read(?:ing)?)\b/i],
  ['admin', /\b(?:invoice|timesheet|admin|planning|hiring|accounts?|tax|billing|deploy(?:ed|ment)?|release|server|infra|setup|install(?:ed)?|config(?:ured)?|ops|backup)\b/i],
  ['dev', /\b(?:cod(?:e|ed|ing)|bug|fix(?:ed|ing)?|debug(?:ged|ging)?|api|build|built|implement(?:ed|ing)?|develop(?:ed|ing|ment)?|refactor(?:ed|ing)?|test(?:ed|ing|s)?|pr|merge[d]?|frontend|backend|database|db|query|integration|feature|component|endpoint|migration|script)\b/i],
  ['personal', /\b(?:gym|workout|errand|family|personal|chores?|cooking|cleaning)\b/i],
];

export function guessWorkCategory(text = '') {
  for (const [cat, rx] of CATEGORY_WORDS) if (rx.test(text)) return cat;
  return 'dev';
}

// ---------------------------------------------------------------------------
// time helpers
// ---------------------------------------------------------------------------
export const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? ''); return m ? Math.min(1439, +m[1] * 60 + +m[2]) : null; };
export const fromMin = (min) => { const m = Math.max(0, Math.min(1439, Math.round(min))); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** 135 → "2h 15m", 45 → "45m", 120 → "2h" */
export function fmtMinutes(min) {
  const m = Math.max(0, Math.round(min ?? 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
/** "09:30" → "9:30 AM" */
export const fmtClock = (hhmm) => { const t = toMin(hhmm); if (t == null) return ''; const h = Math.floor(t / 60); const m = t % 60; return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------
const GLUE = '(?:\\b(?:for|about|around|roughly|nearly|almost)\\s+|~\\s*)*';
const DURATIONS = [
  [new RegExp(`${GLUE}\\b(?:an?|one)\\s+hour\\s+and\\s+a\\s+half\\b`, 'i'), () => 90],
  [new RegExp(`${GLUE}\\bhalf\\s+(?:an?\\s+)?hour\\b`, 'i'), () => 30],
  [new RegExp(`${GLUE}\\b(\\d+(?:\\.\\d+)?)\\s*(?:hours?|hrs?|h)\\b\\s*(?:and\\s+)?(?:(\\d{1,2})\\s*(?:minutes?|mins?|m)\\b)?`, 'i'), (m) => Math.round(parseFloat(m[1]) * 60) + (m[2] ? +m[2] : 0)],
  [new RegExp(`${GLUE}\\b(\\d{1,3})\\s*(?:minutes?|mins?|m)\\b`, 'i'), (m) => +m[1]],
  [new RegExp(`${GLUE}\\b(?:an|one)\\s+hour\\b`, 'i'), () => 60],
];

/** "for 1h 30m" → { minutes: 90, match: 'for 1h 30m' } (or null) */
export function parseDuration(text = '') {
  for (const [rx, calc] of DURATIONS) {
    const m = rx.exec(text);
    if (!m) continue;
    const minutes = calc(m);
    if (minutes > 0 && minutes <= 24 * 60) return { minutes, match: m[0] };
  }
  return null;
}

const RANGE = /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\w:])/i;

/** "10am-11:30am", "9 to 11am", "14:00-15:30" → { start, end, minutes, match } (or null) */
export function parseRange(text = '') {
  const m = RANGE.exec(text);
  if (!m) return null;
  const [, h1, m1, ap1, h2, m2, ap2] = m;
  // "fixed 2-3 bugs" is not a time range: a clock needs am/pm or minutes somewhere
  if (!ap1 && !ap2 && m1 == null && m2 == null) return null;
  let a = +h1; let b = +h2;
  if (a > 23 || b > 23) return null;
  const pm = (h, ap) => (/pm/i.test(ap) && h < 12 ? h + 12 : /am/i.test(ap) && h === 12 ? 0 : h);
  if (ap1 || ap2) {
    b = pm(b, ap2 ?? ap1);
    a = ap1 ? pm(a, ap1) : pm(a, ap2);
    if (!ap1 && a > b) a -= 12; // "11-1pm" → 11:00–13:00
  } else if (b <= a && b < 12) b += 12; // "9:30-1:00" → until 13:00
  const start = a * 60 + +(m1 ?? 0);
  const end = b * 60 + +(m2 ?? 0);
  if (start < 0 || end <= start || end > 1439) return null;
  return { start: fromMin(start), end: fromMin(end), minutes: end - start, match: m[0] };
}

const PREFIX = /^(?:please\s+)?(?:log(?:ged)?(?:\s+(?:my\s+)?work)?|work\s*log|worklog|track(?:ed)?(?:\s+(?:my\s+)?work)?|time\s*log)\s*[:-]\s*|^(?:please\s+)?(?:log(?:ged)?|track(?:ed)?)\s+(?=\S)/i;
const WORK_VERB = /^(?:today\s+|yesterday\s+)?(?:i\s+)?(?:have\s+|was\s+|also\s+)?(?:worked|working|spent|did|coded|coding|debugged|debugging|fixed|fixing|built|building|designed|designing|reviewed|reviewing|wrote|writing|tested|testing|deployed|deploying|researched|researching|studied|studying|attended|implemented|implementing|refactored|refactoring|prepared|preparing|finished|completed|in\s+a)\b/i;

/**
 * A sentence is a work log when it is marked as one ("log work: …"), when it says
 * "worked on …" / "today I fixed …", or when it says what was done AND for how long.
 * The time is optional — the log is first of all the list of what got done.
 */
export function looksLikeWorkLog(raw = '') {
  const t = String(raw).trim();
  if (!t || /\?$/.test(t)) return false;
  const timed = !!(parseDuration(t) || parseRange(t));
  if (/^(?:please\s+)?(?:log\s+(?:my\s+)?work|work\s*log|worklog|time\s*log|track(?:ed)?)\s*[:-]/i.test(t)) return true;
  if (/^(?:please\s+)?(?:log(?:ged)?|track(?:ed)?)\s+\S/i.test(t) && timed) return true;
  if (/^(?:today\s+|yesterday\s+)?(?:i\s+)?(?:have\s+|also\s+)?(?:worked|working)\s+on\s+\S/i.test(t)) return true;
  if (/^(?:today|yesterday)\s+i\s+/i.test(t) && WORK_VERB.test(t)) return true;
  return WORK_VERB.test(t) && timed;
}

// where a piece of work stands — the Status column of the day sheet
export const WORK_STATUSES = {
  done: { label: 'Done', color: '#2b8a3e', tint: '#d5f1da' },
  progress: { label: 'In progress', color: '#1864ab', tint: '#d3e9fb' },
  review: { label: 'In review', color: '#5f3dc4', tint: '#e0dafb' },
  blocked: { label: 'Blocked', color: '#c92a2a', tint: '#ffe0e0' },
};
export const statusOf = (e) => (WORK_STATUSES[e?.status] ? e.status : 'done');
const STATUS_WORDS = [
  ['blocked', /\s*[-–(,]?\s*\b(?:is\s+)?(?:blocked|stuck)\b\)?/i],
  ['review', /\s*[-–(,]?\s*\b(?:in|under|for)\s+review\b\)?/i],
  ['progress', /\s*[-–(,]?\s*\b(?:(?:is\s+)?(?:still\s+)?in\s+progress|wip|ongoing|not\s+(?:yet\s+)?(?:done|finished)|half\s*-?\s*done)\b\)?/i],
  ['done', /\s*[-–(,]?\s*\b(?:is\s+|all\s+)?(?:done|finished|completed)\b\)?$/i],
];
/** "done" | "in progress" | "wip" | "blocked" | "review" → a status key (or null) */
export function toStatus(v = '') {
  const t = String(v).toLowerCase().trim();
  if (!t) return null;
  if (WORK_STATUSES[t]) return t;
  if (/block|stuck/.test(t)) return 'blocked';
  if (/review/.test(t)) return 'review';
  if (/progress|wip|ongoing|doing|working|started|pending/.test(t)) return 'progress';
  if (/done|finish|complete|closed|shipped/.test(t)) return 'done';
  return null;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tidy = (s) => s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/^[\s,.;:\-–]+|[\s,;:\-–]+$/g, '').trim();

/**
 * "worked on GHMC dashboard for 2h yesterday", "spent 45 min on code review",
 * "GHMC: fixed login bug 10am-11:30am", "log: client demo prep 1.5h #Acme"
 * → { title, minutes|null, start|null, end|null, date, projectId, project, category } (or null)
 */
export function parseWorkLog(raw, projects = [], now = new Date()) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  text = text.replace(PREFIX, '');

  const range = parseRange(text);
  if (range) text = text.replace(range.match, ' ');
  const dur = parseDuration(text);
  if (dur) text = text.replace(dur.match, ' ');

  // the day: only whole-day words count ("yesterday", "on monday", "sep 12") — never a stray hour
  let date = dayjs(now).format('YYYY-MM-DD');
  for (const res of chrono.parse(text, now)) {
    if (!(res.start.isCertain('day') || res.start.isCertain('weekday'))) continue;
    let d = dayjs(res.start.date());
    if (d.isAfter(dayjs(now), 'day')) d = d.subtract(res.start.isCertain('weekday') && !res.start.isCertain('day') ? 7 : 0, 'day');
    if (d.isAfter(dayjs(now), 'day')) continue; // work is logged after it happened
    date = d.format('YYYY-MM-DD');
    text = text.replace(new RegExp(`(?:\\b(?:on|from|since)\\s+)?${res.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' ');
    break;
  }
  text = tidy(text);

  // where it stands: "… — in progress", "… (blocked)", "still working on …"; work that was logged is done unless it says otherwise
  let status = /^(?:i\s+am\s+|i'm\s+|still\s+)?(?:still\s+)?working\s+on\b/i.test(text) ? 'progress' : 'done';
  for (const [key, rx] of STATUS_WORDS) {
    if (!rx.test(text)) continue;
    status = key;
    text = tidy(text.replace(rx, ' '));
    break;
  }

  // the project: "#Acme", "Acme: did x", or the name of an existing project anywhere in the sentence
  let projectId = null;
  let project = '';
  const hash = /(?:^|\s)#([\w][\w-]{1,40})/.exec(text);
  if (hash) { project = hash[1].replace(/[-_]/g, ' '); text = tidy(text.replace(hash[0], ' ')); }
  const lead = /^([\w][\w .&-]{1,30}?)\s*:\s+(?=\S)/.exec(text);
  if (!project && lead && lead[1].split(' ').length <= 3 && !/^(?:note|idea|todo|task|plan)$/i.test(lead[1])) { project = lead[1].trim(); text = text.slice(lead[0].length); }
  const lower = `${project} ${text}`.toLowerCase();
  const known = projects.find((p) => p.name && project && p.name.toLowerCase() === project.toLowerCase())
    ?? [...projects].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0)).find((p) => p.name && p.name.length > 1 && lower.includes(p.name.toLowerCase()));
  if (known) { projectId = known.id; project = known.name; }

  // the title: what was done, without the scaffolding words
  let title = text
    .replace(/^(?:today\s+)?(?:i\s+am\s+|i'm\s+)?(?:i\s+)?(?:have\s+|was\s+|also\s+|still\s+)*/i, '')
    .replace(/^(?:worked|working)\s+(?:on|at|with)?\s*/i, '')
    .replace(/^spent\s+(?:time\s+)?(?:on|in|at|with)?\s*/i, '')
    .replace(/^did\s+(?:of\s+)?/i, '')
    .replace(/^(?:of|on)\s+/i, '')
    .replace(/^(?:the|a|an|my|our)\s+(?=\S+\s)/i, '')
    .replace(/\s+(?:for|from|on|at|in|of)$/i, '');
  // "code review for GHMC" → "Code review" (the project has its own field)
  if (project) {
    const tail = new RegExp(`\\s+(?:for|on|in|of|at)\\s+(?:the\\s+)?(?:project\\s+)?${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+project)?$`, 'i');
    if (tail.test(title) && title.replace(tail, '').trim().length > 2) title = title.replace(tail, '');
  }
  title = cap(tidy(title));
  if (!title && project) title = `Work on ${project}`;
  if (!title) return null;

  return {
    title: title.slice(0, 140),
    minutes: range?.minutes ?? dur?.minutes ?? null,
    start: range?.start ?? null,
    end: range?.end ?? null,
    date, projectId, project, status,
    category: guessWorkCategory(`${title} ${raw}`),
  };
}

/**
 * Every project name Track knows: the real projects, then the free-text names
 * already used in the log (id null) — so "worked on Falcon api" finds "Falcon"
 * the second time without a "Falcon:" prefix.
 */
export function projectPool(projects = [], worklog = []) {
  const seen = new Set(projects.map((p) => (p.name ?? '').toLowerCase()));
  const extra = [];
  for (const e of worklog) {
    const name = (e.project ?? '').trim();
    if (!name || e.projectId || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    extra.push({ id: null, name });
  }
  return [...projects, ...extra];
}

/** The project a title mentions by name (whole words), or null. */
export function inferProject(title = '', pool = []) {
  const t = ` ${String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return [...pool]
    .filter((p) => p.name && p.name.length > 1)
    .sort((a, b) => b.name.length - a.name.length)
    .find((p) => t.includes(` ${p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `)) ?? null;
}

/**
 * Give an entry a slot on the day grid. A range is kept; a start gets its end;
 * a bare duration ends "now" when it is today, and otherwise queues up after the
 * day's last entry (from 09:00). `approx` marks a slot Myth chose.
 */
export function placeEntry({ date, minutes, start, end }, existing = [], now = new Date()) {
  const s = toMin(start);
  const e = toMin(end);
  if (s != null && e != null && e > s) return { start: fromMin(s), end: fromMin(e), minutes: e - s, approx: false };
  const len = Math.max(1, Math.min(16 * 60, Math.round(minutes || 30)));
  if (s != null) return { start: fromMin(s), end: fromMin(Math.min(1439, s + len)), minutes: Math.min(len, 1439 - s), approx: false };
  if (e != null) return { start: fromMin(Math.max(0, e - len)), end: fromMin(e), minutes: Math.min(len, e), approx: false };
  const n = dayjs(now);
  if (date === n.format('YYYY-MM-DD')) {
    const stop = Math.max(len, Math.round((n.hour() * 60 + n.minute()) / 5) * 5);
    return { start: fromMin(stop - len), end: fromMin(stop), minutes: len, approx: true };
  }
  const last = existing.filter((x) => x.date === date).reduce((mx, x) => Math.max(mx, toMin(x.end) ?? 0), 9 * 60);
  const begin = Math.min(last, 1439 - len);
  return { start: fromMin(begin), end: fromMin(begin + len), minutes: len, approx: true };
}

// ---------------------------------------------------------------------------
// reading the log
// ---------------------------------------------------------------------------
// the order things were logged in (older entries without a stamp fall back to their clock time)
const inOrder = (a, b) => (a.created && b.created && a.created !== b.created ? (a.created < b.created ? -1 : 1) : (toMin(a.start) ?? 0) - (toMin(b.start) ?? 0));
export const entriesOn = (worklog = [], date) => worklog.filter((e) => e.date === date).sort(inOrder);
export const entriesBetween = (worklog = [], from, to) =>
  worklog.filter((e) => e.date >= from && e.date <= to).sort((a, b) => (a.date === b.date ? inOrder(a, b) : a.date < b.date ? -1 : 1));
export const totalMinutes = (entries = []) => entries.reduce((a, e) => a + (e.minutes ?? 0), 0);

export const projectName = (entry, projects = []) =>
  (entry.projectId && projects.find((p) => p.id === entry.projectId)?.name) || entry.project || '';

export function byProject(entries = [], projects = []) {
  const map = new Map();
  for (const e of entries) {
    const name = projectName(e, projects) || 'No project';
    const key = name.toLowerCase();
    const row = map.get(key) ?? { key, name, minutes: 0, count: 0, color: (e.projectId && projects.find((p) => p.id === e.projectId)?.color) || null };
    row.minutes += e.minutes ?? 0; row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes || b.count - a.count);
}

export function byCategory(entries = []) {
  const map = new Map();
  for (const e of entries) {
    const key = WORK_CATEGORIES[e.category] ? e.category : 'dev';
    const row = map.get(key) ?? { key, ...WORK_CATEGORIES[key], minutes: 0, count: 0 };
    row.minutes += e.minutes ?? 0; row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

/** date → minutes, for the calendar dots and the month heatmap */
export function minutesByDate(worklog = []) {
  const out = {};
  for (const e of worklog) out[e.date] = (out[e.date] ?? 0) + (e.minutes ?? 0);
  return out;
}

/** Monday-first week containing `ref` → 7 dayjs */
export function weekDays(ref = dayjs()) {
  const d = dayjs(ref).startOf('day');
  const monday = d.subtract((d.day() + 6) % 7, 'day');
  return Array.from({ length: 7 }, (_, i) => monday.add(i, 'day'));
}

/** Monday-first month grid → weeks of dayjs (leading/trailing days included) */
export function monthGrid(ref = dayjs()) {
  const first = dayjs(ref).startOf('month');
  const start = first.subtract((first.day() + 6) % 7, 'day');
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = Array.from({ length: 7 }, (_, i) => start.add(w * 7 + i, 'day'));
    if (w > 3 && row[0].month() !== first.month()) break;
    weeks.push(row);
  }
  return weeks;
}

/** Days in a row with tracked work, counting back from today (or yesterday if today is still empty). */
export function trackStreak(worklog = [], now = dayjs()) {
  const days = new Set(worklog.map((e) => e.date));
  let d = dayjs(now).startOf('day');
  if (!days.has(d.format('YYYY-MM-DD'))) d = d.subtract(1, 'day');
  let n = 0;
  while (days.has(d.format('YYYY-MM-DD'))) { n += 1; d = d.subtract(1, 'day'); }
  return n;
}

// ---------------------------------------------------------------------------
// the daily summary
// ---------------------------------------------------------------------------
const items = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;
/** One line of the log: "GHMC — Dashboard filters [In progress] (2h) — what was done" */
export function entryLine(e, projects = []) {
  const p = projectName(e, projects);
  const st = statusOf(e);
  return `${p ? `${p} — ` : ''}${e.title}${st !== 'done' ? ` [${WORK_STATUSES[st].label}]` : ''}${e.minutes > 0 ? ` (${fmtMinutes(e.minutes)})` : ''}${e.note ? ` — ${e.note}` : ''}`;
}

export function byStatus(entries = []) {
  return Object.entries(WORK_STATUSES)
    .map(([key, st]) => ({ key, ...st, count: entries.filter((e) => statusOf(e) === key).length }))
    .filter((r) => r.count > 0);
}
/** "3 done · 1 in progress" */
export const statusLine = (entries = []) => byStatus(entries).map((r) => `${r.count} ${r.label.toLowerCase()}`).join(' · ');

/** date → number of logged items, for the calendar dots and the month view */
export function countByDate(worklog = []) {
  const out = {};
  for (const e of worklog) out[e.date] = (out[e.date] ?? 0) + 1;
  return out;
}

/** The summary Myth maintains on its own — rebuilt from the day's entries. Time is mentioned only when it was recorded. */
export function autoSummary(entries = [], projects = []) {
  if (!entries.length) return '';
  const total = totalMinutes(entries);
  const lines = [`${items(entries.length)} logged — ${statusLine(entries)}${total > 0 ? ` · ${fmtMinutes(total)} recorded` : ''}.`];
  const named = byProject(entries, projects).filter((p) => p.name !== 'No project');
  if (named.length) lines.push(`Projects: ${named.slice(0, 4).map((p) => `${p.name} (${p.count}${p.minutes > 0 ? `, ${fmtMinutes(p.minutes)}` : ''})`).join(', ')}.`);
  const open = entries.filter((e) => statusOf(e) !== 'done');
  if (open.length) lines.push(`Still open: ${open.map((e) => e.title).slice(0, 4).join(', ')}.`);
  lines.push('');
  entries.forEach((e) => lines.push(`• ${entryLine(e, projects)}`));
  return lines.join('\n');
}

/** The saved summary for a day if there is one, else the automatic one. */
export function summaryFor(state, date) {
  const saved = state.worklogSummaries?.[date];
  if (saved?.text) return { text: saved.text, source: saved.source ?? 'manual', updated: saved.updated ?? null };
  const text = autoSummary(entriesOn(state.worklog ?? [], date), state.projects ?? []);
  return { text, source: 'auto', updated: null };
}

/** Plain text to paste into a standup / status mail. */
export function standupText(state, date) {
  const entries = entriesOn(state.worklog ?? [], date);
  const total = totalMinutes(entries);
  const head = `Work log — ${dayjs(date).format('ddd, MMM D')} · ${items(entries.length)}${total > 0 ? ` · ${fmtMinutes(total)}` : ''}`;
  if (!entries.length) return `${head}\nNothing logged.`;
  return [head, ...entries.map((e) => `• ${entryLine(e, state.projects ?? [])}`)].join('\n');
}

// ---------------------------------------------------------------------------
// for the assistant
// ---------------------------------------------------------------------------
/** "today" | "yesterday" | "this week" | "last week" | "this month" | a date → { from, to, label } */
export function rangeFor(phrase = '', now = new Date()) {
  const t = String(phrase).toLowerCase();
  const n = dayjs(now);
  const f = (d) => d.format('YYYY-MM-DD');
  if (/last\s+week/.test(t)) { const w = weekDays(n.subtract(7, 'day')); return { from: f(w[0]), to: f(w[6]), label: 'last week' }; }
  if (/\bweek\b/.test(t)) { const w = weekDays(n); return { from: f(w[0]), to: f(w[6]), label: 'this week' }; }
  if (/last\s+month/.test(t)) { const m = n.subtract(1, 'month'); return { from: f(m.startOf('month')), to: f(m.endOf('month')), label: m.format('MMMM') }; }
  if (/\bmonth\b/.test(t)) return { from: f(n.startOf('month')), to: f(n.endOf('month')), label: 'this month' };
  if (/yesterday/.test(t)) return { from: f(n.subtract(1, 'day')), to: f(n.subtract(1, 'day')), label: 'yesterday' };
  if (/\d{4}-\d{2}-\d{2}/.test(t)) { const d = t.match(/\d{4}-\d{2}-\d{2}/)[0]; return { from: d, to: d, label: dayjs(d).format('ddd, MMM D') }; }
  if (t && !/today|now/.test(t)) {
    const res = chrono.parse(t, now).find((r) => r.start.isCertain('day') || r.start.isCertain('weekday'));
    if (res) {
      let d = dayjs(res.start.date());
      if (d.isAfter(n, 'day')) d = d.subtract(7, 'day');
      return { from: f(d), to: f(d), label: d.format('ddd, MMM D') };
    }
  }
  return { from: f(n), to: f(n), label: 'today' };
}

/** "What did I work on …" as text: the count, projects, then the entries (grouped by day for a range). */
export function workRundown(state, phrase = 'today', now = new Date()) {
  const { from, to, label } = rangeFor(phrase, now);
  const projects = state.projects ?? [];
  const entries = entriesBetween(state.worklog ?? [], from, to);
  const timer = state.worklogTimer;
  const running = timer ? `\n⏱ Timer running: "${timer.title}" — ${fmtMinutes(Math.max(1, dayjs(now).diff(dayjs(timer.startedAt), 'minute')))} so far.` : '';
  if (!entries.length) return `Nothing logged ${label}, Boss.${running}\nSay "worked on <what>" and I'll log it, or open Track.`;
  const total = totalMinutes(entries);
  const lines = [`Work logged ${label}: ${items(entries.length)} — ${statusLine(entries)}${total > 0 ? ` · ${fmtMinutes(total)} recorded` : ''}.`];
  const proj = byProject(entries, projects).filter((p) => p.name !== 'No project');
  if (proj.length) lines.push(`By project: ${proj.slice(0, 5).map((p) => `${p.name} ${p.minutes > 0 ? fmtMinutes(p.minutes) : items(p.count)}`).join(' · ')}`);
  if (from === to) {
    entries.forEach((e) => lines.push(`• ${entryLine(e, projects)}`));
    const saved = state.worklogSummaries?.[from];
    if (saved?.text) lines.push('', `Summary: ${saved.text}`);
  } else {
    const days = [...new Set(entries.map((e) => e.date))];
    days.forEach((d) => {
      const list = entries.filter((e) => e.date === d);
      const t = totalMinutes(list);
      lines.push(`${dayjs(d).format('ddd, MMM D')} — ${items(list.length)}${t > 0 ? `, ${fmtMinutes(t)}` : ''}: ${list.map((e) => e.title).slice(0, 5).join(', ')}${list.length > 5 ? '…' : ''}`);
    });
  }
  return lines.join('\n') + running;
}

/** "How much time did I spend on X (this week)?" / "what did I do on X" */
export function timeOnProject(state, name, phrase = 'this week', now = new Date()) {
  const q = String(name ?? '').trim().toLowerCase();
  if (!q) return null;
  const { from, to, label } = rangeFor(phrase, now);
  const projects = state.projects ?? [];
  const hits = entriesBetween(state.worklog ?? [], from, to).filter((e) => projectName(e, projects).toLowerCase().includes(q) || e.title.toLowerCase().includes(q));
  if (!hits.length) return `Nothing logged on "${name}" ${label}, Boss.`;
  const days = new Set(hits.map((e) => e.date)).size;
  const total = totalMinutes(hits);
  const timeless = hits.filter((e) => !(e.minutes > 0)).length;
  const head = total > 0
    ? `${fmtMinutes(total)} on "${name}" ${label} — ${items(hits.length)} over ${days} day${days === 1 ? '' : 's'}${timeless ? ` (${timeless} without a time)` : ''}.`
    : `${items(hits.length)} on "${name}" ${label} over ${days} day${days === 1 ? '' : 's'} — no time was recorded for them.`;
  return `${head}\n${hits.slice(-6).map((e) => `• ${dayjs(e.date).format('ddd D')}  ${e.title}${e.minutes > 0 ? ` (${fmtMinutes(e.minutes)})` : ''}`).join('\n')}`;
}

/** The compact snapshot the model sees as DATA.workLog. */
export function trackForAi(state, now = new Date()) {
  const n = dayjs(now);
  const today = n.format('YYYY-MM-DD');
  const projects = state.projects ?? [];
  const worklog = state.worklog ?? [];
  const week = weekDays(n);
  const weekEntries = entriesBetween(worklog, week[0].format('YYYY-MM-DD'), week[6].format('YYYY-MM-DD'));
  const pack = (e) => ({ date: e.date, title: e.title, description: e.note || undefined, project: projectName(e, projects) || undefined, status: WORK_STATUSES[statusOf(e)].label, minutes: e.minutes > 0 ? e.minutes : undefined });
  const todays = entriesOn(worklog, today);
  const timer = state.worklogTimer;
  return {
    timerRunning: timer ? { title: timer.title, project: timer.project || undefined, since: dayjs(timer.startedAt).format('HH:mm'), minutesSoFar: Math.max(0, n.diff(dayjs(timer.startedAt), 'minute')) } : null,
    today: { items: todays.length, minutes: totalMinutes(todays), entries: todays.map(pack), summary: summaryFor(state, today).text || undefined },
    yesterday: (() => { const d = n.subtract(1, 'day').format('YYYY-MM-DD'); const list = entriesOn(worklog, d); return { items: list.length, minutes: totalMinutes(list), entries: list.map(pack) }; })(),
    thisWeek: {
      items: weekEntries.length, minutes: totalMinutes(weekEntries),
      byStatus: byStatus(weekEntries).map((r) => ({ status: r.label, items: r.count })),
      stillOpen: weekEntries.filter((e) => statusOf(e) !== 'done').slice(-8).map((e) => ({ title: e.title, status: WORK_STATUSES[statusOf(e)].label, date: e.date })),
      perDay: week.map((d) => { const list = weekEntries.filter((e) => e.date === d.format('YYYY-MM-DD')); return { day: d.format('ddd'), items: list.length, minutes: totalMinutes(list) }; }),
      byProject: byProject(weekEntries, projects).slice(0, 8).map((p) => ({ project: p.name, items: p.count, minutes: p.minutes })),
      byCategory: byCategory(weekEntries).map((c) => ({ category: c.label, minutes: c.minutes })),
    },
    streakDays: trackStreak(worklog, n),
    totalEntries: worklog.length,
  };
}

// ---------------------------------------------------------------------------
// suggestions — work Myth already knows happened but is not in the log
// ---------------------------------------------------------------------------
export function suggestWorkLogs(state, date, now = new Date()) {
  const logged = entriesOn(state.worklog ?? [], date);
  const has = (title) => { const t = title.toLowerCase(); return logged.some((e) => e.title.toLowerCase() === t || e.title.toLowerCase().includes(t) || t.includes(e.title.toLowerCase())); };
  const out = [];
  const isPast = (hhmm) => date < dayjs(now).format('YYYY-MM-DD') || (toMin(hhmm) ?? 0) <= dayjs(now).hour() * 60 + dayjs(now).minute();
  for (const ev of state.events ?? []) {
    if (ev.date !== date || !ev.time || !['meeting', 'focus'].includes(ev.kind) || !isPast(ev.time) || has(ev.title)) continue;
    const s = toMin(ev.time);
    const e = toMin(ev.end) ?? s + (ev.kind === 'meeting' ? 30 : 60);
    if (e <= s) continue;
    out.push({ key: `e${ev.id}`, title: ev.title, start: fromMin(s), end: fromMin(e), minutes: e - s, projectId: ev.projectId ?? null, category: ev.kind === 'meeting' ? 'meeting' : guessWorkCategory(ev.title), why: ev.kind === 'meeting' ? 'Meeting on your calendar' : 'Focus block you ran' });
  }
  for (const t of state.tasks ?? []) {
    if (!t.completedAt || dayjs(t.completedAt).format('YYYY-MM-DD') !== date || has(t.title)) continue;
    const minutes = Math.max(15, Math.min(240, Number(t.estimate) || 30));
    const end = dayjs(t.completedAt).hour() * 60 + dayjs(t.completedAt).minute();
    out.push({ key: `t${t.id}`, title: t.title, start: fromMin(Math.max(0, end - minutes)), end: fromMin(Math.max(minutes, end)), minutes, projectId: t.projectId ?? null, category: guessWorkCategory(t.title), why: 'Task you completed' });
  }
  return out.slice(0, 5);
}
