// What the assistant can DO, not just say. Every feature of Myth is an
// action here: the model (or a plain-English shortcut) names one, Myth runs
// it against the store and reports back. The model asks for actions with a
// fenced block at the end of its answer:
//
//   ```myth
//   [{"action":"add_learning","title":"React hooks","file":"last"}]
//   ```
//
// The block never reaches the screen — the ✅ lines do. Everything here is
// framework-free so it runs in node tests too; the browser-only bits
// (IndexedDB blobs, panels) are reached through the ctx the caller builds.
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import { parseCapture, executeCapture } from './parser.js';
import { buildPlan, createProjectFromPlan, detectProjectIntent, titleCase } from './projectPlanner.js';
import { startPlannerSession } from './plannerSession.js';
import { makeDocument, normalizeFormat, FORMATS } from './docgen.js';
import { parseReminder, describeWhen, reminderRundown, REPEATS, activeReminders } from './reminders.js';
import { parseWorkLog, parseDuration, guessWorkCategory, workRundown, projectName, fmtMinutes, toStatus, statusOf, WORK_CATEGORIES, WORK_STATUSES } from './worklog.js';

const stateOf = (store) => (store.getState ? store.getState() : store);
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clean = (v, n = 200) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));

// "tomorrow", "next friday", "2026-10-02" → YYYY-MM-DD (or null)
// `forward: false` is for things that already happened (work logs): "monday" means the last one
export function toDate(v, now = new Date(), forward = true) {
  const s = clean(v, 60);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = chrono.parseDate(s, now, { forwardDate: forward });
  if (!d) return null;
  const day = !forward && dayjs(d).isAfter(dayjs(now), 'day') ? dayjs(d).subtract(7, 'day') : dayjs(d);
  return day.format('YYYY-MM-DD');
}
const toTime = (v) => { const m = clean(v, 20).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i); if (!m) return null; let h = +m[1]; if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; } return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`; };

const findByName = (list, name, key = 'name') => {
  const n = clean(name, 80).toLowerCase();
  if (!n) return null;
  return list.find((x) => (x[key] ?? '').toLowerCase() === n) ?? list.find((x) => (x[key] ?? '').toLowerCase().includes(n) || n.includes((x[key] ?? '').toLowerCase())) ?? null;
};
const STAGES = { want: 0, 'want to learn': 0, queue: 0, learning: 1, 'in progress': 1, applied: 2, done: 2, taught: 3, shared: 3, 'taught/shared': 3 };

// ---------- files ----------
// A file the chat knows about: { id, name, type, size, text? } — `id` is also its IndexedDB blob key.
function pickFile(ref, ctx) {
  const files = ctx.files ?? [];
  if (!files.length) return null;
  const r = clean(ref, 80).toLowerCase();
  if (!r || r === 'last' || r === 'latest' || r === 'this' || r === 'it') return files[0];
  return files.find((f) => f.id === ref) ?? files.find((f) => (f.name ?? '').toLowerCase().includes(r)) ?? files[0];
}

async function saveBlobFile(ctx, { blob, name, type, title, projectId = null, learningId = null, source = 'assistant' }) {
  const id = newId();
  if (ctx.putBlob) await ctx.putBlob(id, blob);
  stateOf(ctx.store).addFileMeta({ id, name, size: blob.size, type: type || blob.type || 'application/octet-stream', projectId, learningId, source, title: title ?? name });
  return { id, name, size: blob.size, type: type || blob.type };
}

// Put an existing file (already in `files`) where the user wants it.
async function placeFile(ctx, file, { to, learning, project, title }) {
  const s = stateOf(ctx.store);
  const target = clean(to, 20).toLowerCase() || 'drive';
  if (/^learn/.test(target)) {
    let item = learning ? findByName(s.learning, learning, 'title') : null;
    if (!item) item = s.addLearning({ title: clean(learning || title || file.name.replace(/\.[a-z0-9]+$/i, ''), 80) });
    s.attachToLearning(item.id, file.id);
    if (file.text && !item.notes) s.updateLearning(item.id, { notes: clean(file.text, 600) });
    return `"${file.name}" attached to "${item.title}" in Learning`;
  }
  if (/^proj/.test(target)) {
    const p = project ? findByName(s.projects, project) : s.projects[0];
    if (!p) return `No project called "${project}" — say "create project ${project}" first`;
    s.updateFileMeta(file.id, { projectId: p.id });
    return `"${file.name}" filed under project "${p.name}"`;
  }
  const blob = ctx.getBlob ? await ctx.getBlob(file.id) : null;
  s.addDriveItem({ kind: /^image\//.test(file.type ?? '') ? 'image' : 'file', title: clean(title || file.name.replace(/\.[a-z0-9]+$/i, ''), 80), name: file.name, size: file.size, type: file.type, blobId: blob ? await (async () => { const id = newId(); await ctx.putBlob?.(id, blob); return id; })() : file.id });
  return `"${file.name}" saved to Drive`;
}

// ---------- the registry ----------
export const ACTIONS = {
  add_task: { desc: 'add_task {title, due?, priority?(1-5), project?}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const p = a.project ? findByName(s.projects, a.project) : null;
    const due = toDate(a.due);
    s.addTask({ title: clean(a.title, 120), due, priority: Math.min(5, Math.max(1, Number(a.priority) || 3)), projectId: p?.id ?? null });
    if (due && dayjs(due).isSame(dayjs(), 'day')) s.addPlanItems([clean(a.title, 120)]);
    return `Task "${clean(a.title, 120)}"${due ? ` · due ${dayjs(due).format('ddd, MMM D')}` : ''}${p ? ` · ${p.name}` : ''}`;
  } },
  complete_task: { desc: 'complete_task {title}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const t = findByName(s.tasks.filter((x) => x.status !== 'done'), a.title, 'title');
    if (!t) return `No open task matches "${clean(a.title)}"`;
    s.completeTask(t.id);
    return `"${t.title}" marked done`;
  } },
  add_meeting: { desc: 'add_meeting {title, date, time?, participants?, location?} — a calendar entry', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const date = toDate(a.date) ?? dayjs().format('YYYY-MM-DD');
    const time = toTime(a.time);
    s.addEvent({ title: clean(a.title, 120), date, time, kind: 'meeting', location: clean(a.location, 120) || null, participants: clean(a.participants, 200) || null });
    return `Meeting "${clean(a.title, 120)}" on the calendar for ${dayjs(date).format('ddd, MMM D')}${time ? ` at ${time}` : ''}`;
  } },
  add_event: { desc: 'add_event {title, date, time?}', run: (a, ctx) => { const date = toDate(a.date) ?? dayjs().format('YYYY-MM-DD'); stateOf(ctx.store).addEvent({ title: clean(a.title, 120), date, time: toTime(a.time), kind: 'event' }); return `"${clean(a.title, 120)}" on the calendar for ${dayjs(date).format('ddd, MMM D')}`; } },
  add_birthday: { desc: 'add_birthday {title, date}', run: (a, ctx) => { const date = toDate(a.date) ?? dayjs().format('YYYY-MM-DD'); stateOf(ctx.store).addEvent({ title: clean(a.title, 120), date, kind: 'birthday', yearly: true }); return `Birthday "${clean(a.title, 120)}" saved for ${dayjs(date).format('MMM D')} (every year)`; } },
  add_expense: { desc: 'add_expense {amount, note?, category?, date?}', run: (a, ctx) => { const amount = Number(String(a.amount).replace(/[^\d.]/g, '')); if (!amount) return 'Expense needs an amount'; stateOf(ctx.store).addTransaction({ type: 'expense', amount, category: clean(a.category, 40) || 'Other', note: clean(a.note, 120), date: toDate(a.date) ?? dayjs().format('YYYY-MM-DD') }); return `Expense ₹${amount.toLocaleString('en-IN')} recorded${a.note ? ` — ${clean(a.note, 60)}` : ''}`; } },
  add_income: { desc: 'add_income {amount, note?, category?, date?}', run: (a, ctx) => { const amount = Number(String(a.amount).replace(/[^\d.]/g, '')); if (!amount) return 'Income needs an amount'; stateOf(ctx.store).addTransaction({ type: 'income', amount, category: clean(a.category, 40) || 'Salary', note: clean(a.note, 120), date: toDate(a.date) ?? dayjs().format('YYYY-MM-DD') }); return `Income ₹${amount.toLocaleString('en-IN')} recorded`; } },
  add_habit: { desc: 'add_habit {name}', run: (a, ctx) => { stateOf(ctx.store).addHabit({ name: clean(a.name ?? a.title, 80) }); return `Habit "${clean(a.name ?? a.title, 80)}" — tracking starts today`; } },
  add_journal: { desc: 'add_journal {text, mood?(1-5)}', run: (a, ctx) => { stateOf(ctx.store).addJournalEntry({ text: clean(a.text, 4000), mood: Math.min(5, Math.max(1, Number(a.mood) || 3)) }); return 'Journal entry saved'; } },
  add_plan_item: { desc: "add_plan_item {text} — today's plan pill", run: (a, ctx) => { stateOf(ctx.store).addPlanItems([clean(a.text ?? a.title, 120)]); return `"${clean(a.text ?? a.title, 120)}" added to today's plan`; } },
  add_reminder: { desc: 'add_reminder {title, when? (natural: "tomorrow 5pm", "every monday 9am", "every 1st"), note?} — a nudge at a time, once or on repeat', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const parsed = parseReminder(`${clean(a.title, 160)} ${clean(a.when, 80)}`.trim());
    if (!parsed) return 'A reminder needs a title';
    s.addReminder({ ...parsed, note: clean(a.note, 300), source: 'ai' });
    return `Reminder "${parsed.title}" — ${describeWhen(parsed)}${parsed.repeat !== 'none' ? ` · ${REPEATS[parsed.repeat].toLowerCase()}` : ''}`;
  } },
  complete_reminder: { desc: 'complete_reminder {title} — done (a repeat rolls to its next date)', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const r = findByName(activeReminders(s.reminders ?? []), a.title, 'title');
    if (!r) return `No open reminder matches "${clean(a.title)}"`;
    s.completeReminder(r.id);
    return `Reminder "${r.title}" done`;
  } },
  snooze_reminder: { desc: 'snooze_reminder {title, until?("1 hour", "tomorrow 9am"; default 1 hour)}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const r = findByName(activeReminders(s.reminders ?? []), a.title, 'title');
    if (!r) return `No open reminder matches "${clean(a.title)}"`;
    const when = a.until ? chrono.parseDate(String(a.until), new Date(), { forwardDate: true }) : null;
    const until = dayjs(when ?? dayjs().add(1, 'hour').toDate());
    s.snoozeReminder(r.id, until.toISOString());
    return `"${r.title}" snoozed until ${until.isSame(dayjs(), 'day') ? until.format('HH:mm') : until.format('ddd, MMM D HH:mm')}`;
  } },
  delete_reminder: { desc: 'delete_reminder {title}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const r = findByName(s.reminders ?? [], a.title, 'title');
    if (!r) return `No reminder matches "${clean(a.title)}"`;
    s.deleteReminder(r.id);
    return `Reminder "${r.title}" deleted`;
  } },
  list_reminders: { desc: 'list_reminders {} — overdue, today, tomorrow and this week', run: (a, ctx) => reminderRundown(stateOf(ctx.store)) },
  log_work: { desc: 'log_work {title, description?, project?, status?(done|in progress|in review|blocked; default done), date?, duration?("2h", "45 min" — only when the user says how long)} — Track: one thing that was worked on', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const title = clean(a.title ?? a.text, 140);
    if (!title) return 'A work log needs a title';
    const parsed = parseWorkLog(`${title} ${clean(a.duration, 40)}`.trim(), s.projects ?? []);
    const known = a.project ? findByName(s.projects ?? [], a.project) : null;
    const date = toDate(a.date, new Date(), false) ?? parsed?.date ?? dayjs().format('YYYY-MM-DD');
    const minutes = Number(a.minutes) > 0 ? Math.round(Number(a.minutes)) : parseDuration(clean(a.duration, 40))?.minutes ?? parsed?.minutes ?? null;
    const entry = s.addWorkLog({
      title: parsed?.title || title, note: clean(a.description ?? a.note, 600), date, minutes,
      status: toStatus(a.status) ?? parsed?.status ?? 'done',
      start: toTime(a.start) ?? parsed?.start ?? null, end: toTime(a.end) ?? parsed?.end ?? null,
      projectId: known?.id ?? parsed?.projectId ?? null, project: known?.name ?? (clean(a.project, 60) || parsed?.project || ''),
      category: WORK_CATEGORIES[clean(a.category, 20).toLowerCase()] ? clean(a.category, 20).toLowerCase() : parsed?.category ?? guessWorkCategory(title), source: 'ai',
    });
    const p = projectName(entry, s.projects ?? []);
    return `Logged "${entry.title}"${p ? ` · ${p}` : ''} · ${WORK_STATUSES[statusOf(entry)].label}${entry.minutes > 0 ? ` · ${fmtMinutes(entry.minutes)}` : ''} · ${dayjs(entry.date).isSame(dayjs(), 'day') ? 'today' : dayjs(entry.date).format('ddd, MMM D')}${entry.start && entry.end ? ` ${entry.start}–${entry.end}` : ''}`;
  } },
  start_timer: { desc: 'start_timer {title, project?} — Track: start the live work timer', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const title = clean(a.title ?? a.text, 140);
    if (!title) return 'The timer needs to know what you are working on';
    const known = a.project ? findByName(s.projects ?? [], a.project) : (s.projects ?? []).find((p) => p.name && title.toLowerCase().includes(p.name.toLowerCase())) ?? null;
    s.startWorkTimer({ title, projectId: known?.id ?? null, project: known?.name ?? clean(a.project, 60), category: guessWorkCategory(title) });
    return `Timer started — "${title}"${known ? ` · ${known.name}` : ''}. Say "stop timer" when you are done`;
  } },
  stop_timer: { desc: 'stop_timer {} — Track: stop the running timer and file it as a work log', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    if (!s.worklogTimer) return 'No timer is running';
    const title = s.worklogTimer.title;
    const entry = s.stopWorkTimer();
    return entry ? `Timer stopped — "${entry.title}" logged, ${fmtMinutes(entry.minutes)} (${entry.start}–${entry.end})` : `Timer stopped — "${title}" ran under a minute, nothing logged`;
  } },
  work_summary: { desc: 'work_summary {range?: today|yesterday|this week|last week|this month|YYYY-MM-DD} — Track: what was worked on, with status', run: (a, ctx) => workRundown(stateOf(ctx.store), clean(a.range ?? a.date, 40) || 'today') },
  save_work_summary: { desc: 'save_work_summary {text, date?} — Track: save the written daily summary for a day', run: (a, ctx) => {
    const text = String(a.text ?? '').trim().slice(0, 2000);
    if (!text) return 'The summary needs text';
    const date = toDate(a.date, new Date(), false) ?? dayjs().format('YYYY-MM-DD');
    stateOf(ctx.store).setWorkSummary(date, text, 'ai');
    return `Daily summary saved for ${dayjs(date).format('ddd, MMM D')}`;
  } },
  update_work: { desc: 'update_work {title, status?(done|in progress|in review|blocked), description?, project?, date?} — Track: change a logged item (e.g. mark it done)', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const date = toDate(a.date, new Date(), false);
    const w = findByName((s.worklog ?? []).filter((x) => !date || x.date === date), a.title, 'title');
    if (!w) return `No work log matches "${clean(a.title)}"`;
    const patch = {};
    const status = toStatus(a.status);
    if (status) patch.status = status;
    if (a.description != null) patch.note = clean(a.description, 600);
    if (a.project) { const known = findByName(s.projects ?? [], a.project); patch.projectId = known?.id ?? null; patch.project = known?.name ?? clean(a.project, 60); }
    if (!Object.keys(patch).length) return 'Nothing to change — give a status, a description or a project';
    s.updateWorkLog(w.id, patch);
    return `"${w.title}" updated${status ? ` — ${WORK_STATUSES[status].label}` : ''}`;
  } },
  delete_work: { desc: 'delete_work {title, date?} — Track: remove a work log entry', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const date = toDate(a.date, new Date(), false);
    const w = findByName((s.worklog ?? []).filter((x) => !date || x.date === date), a.title, 'title');
    if (!w) return `No work log matches "${clean(a.title)}"`;
    s.deleteWorkLog(w.id);
    return `Work log "${w.title}" deleted`;
  } },
  add_learning: { desc: 'add_learning {title, notes?, file?("last" or id), url?}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const title = clean(a.title, 100);
    let item = findByName(s.learning, title, 'title');
    if (!item) item = s.addLearning({ title, notes: clean(a.notes, 2000), links: a.url ? [{ title, url: clean(a.url, 300) }] : [] });
    else s.updateLearning(item.id, { notes: [item.notes, clean(a.notes, 2000)].filter(Boolean).join('\n'), links: a.url ? [...(item.links ?? []), { title, url: clean(a.url, 300) }] : item.links });
    const f = a.file ? pickFile(a.file, ctx) : null;
    if (f) s.attachToLearning(item.id, f.id);
    return `"${item.title}" in the learning pipeline${f ? ` with ${f.name} attached` : ''}`;
  } },
  move_learning: { desc: 'move_learning {title, stage: want|learning|applied|taught}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const item = findByName(s.learning, a.title, 'title');
    if (!item) return `Nothing in Learning matches "${clean(a.title)}"`;
    const stage = STAGES[clean(a.stage, 20).toLowerCase()];
    if (stage == null) return 'Stage must be want, learning, applied or taught';
    s.updateLearning(item.id, { stage });
    return `"${item.title}" moved to ${['Want to learn', 'Learning', 'Applied', 'Taught / shared'][stage]}`;
  } },
  create_project: { desc: 'create_project {name, deadline?, desc?, plan?:true to draft milestones & tasks}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const name = titleCase(clean(a.name ?? a.title, 80));
    const deadline = toDate(a.deadline);
    if (a.plan === true || a.plan === 'true') {
      const intent = detectProjectIntent(`launch ${name}${deadline ? ` by ${deadline}` : ''}`) ?? { text: name, name, template: 'generic', deadline: deadline ?? dayjs().add(6, 'week').format('YYYY-MM-DD') };
      const plan = buildPlan({ ...intent, name, deadline: deadline ?? intent.deadline }, dayjs(), { name, desc: clean(a.desc, 500) || undefined });
      const res = createProjectFromPlan(plan, s);
      return `Project "${name}" created with ${res.milestoneCount} milestones and ${res.taskCount} tasks`;
    }
    s.addProject({ name, desc: clean(a.desc, 500), deadline });
    return `Project "${name}" created${deadline ? ` · deadline ${dayjs(deadline).format('MMM D')}` : ''}`;
  } },
  create_file: { desc: 'create_file {title, format: pdf|md|txt|csv|json|html, content, to: drive|learning|project|files, project?, learning?}', run: async (a, ctx) => {
    const s = stateOf(ctx.store);
    const title = clean(a.title ?? a.name, 90) || 'Document';
    const format = normalizeFormat(a.format);
    const body = String(a.content ?? a.body ?? '').trim();
    if (!body) return 'The file needs content';
    const to = clean(a.to ?? a.destination, 20).toLowerCase() || 'drive';
    const { blob, name, mime } = makeDocument({ title, body, format });
    let projectId = null;
    let learningId = null;
    let where = 'Drive';
    if (/^proj/.test(to)) { const p = a.project ? findByName(s.projects, a.project) : null; if (!p) return `No project called "${a.project}"`; projectId = p.id; where = `project "${p.name}"`; }
    if (/^learn/.test(to)) {
      let item = a.learning ? findByName(s.learning, a.learning, 'title') : null;
      if (!item) item = s.addLearning({ title: clean(a.learning || title, 80), notes: clean(body, 400) });
      learningId = item.id; where = `Learning → "${item.title}"`;
    }
    const meta = await saveBlobFile(ctx, { blob, name, type: mime, title, projectId, learningId });
    if (learningId) s.attachToLearning(learningId, meta.id);
    if (/^drive/.test(to) || !/^(proj|learn|file)/.test(to)) s.addDriveItem({ kind: 'file', title, name, size: blob.size, type: mime, blobId: meta.id });
    ctx.onFile?.(meta);
    return `${FORMATS[format].label} "${name}" created and saved to ${where}`;
  } },
  attach_file: { desc: 'attach_file {file: "last"|id, to: learning|project|drive, learning?, project?, title?}', run: async (a, ctx) => {
    const f = pickFile(a.file, ctx);
    if (!f) return 'No file in this chat to attach — use the paperclip to add one';
    return placeFile(ctx, f, a);
  } },
  save_link: { desc: 'save_link {title, url, to?: drive|learning, learning?}', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const url = /^https?:\/\//i.test(clean(a.url, 300)) ? clean(a.url, 300) : `https://${clean(a.url, 300)}`;
    if (/^learn/.test(clean(a.to, 20).toLowerCase())) {
      let item = a.learning ? findByName(s.learning, a.learning, 'title') : null;
      if (!item) item = s.addLearning({ title: clean(a.learning || a.title, 80) });
      s.updateLearning(item.id, { links: [...(item.links ?? []), { title: clean(a.title, 80) || url, url }] });
      return `Link saved under "${item.title}" in Learning`;
    }
    s.addDriveItem({ kind: 'link', title: clean(a.title, 80) || url, url });
    return `Link "${clean(a.title, 80) || url}" saved to Drive`;
  } },
  save_text: { desc: 'save_text {title, body} — a text note in Drive', run: (a, ctx) => { stateOf(ctx.store).addDriveItem({ kind: 'text', title: clean(a.title, 80) || 'Text', body: String(a.body ?? '').slice(0, 20000) }); return `Text "${clean(a.title, 80) || 'Text'}" saved to Drive`; } },
  save_password: { desc: 'save_password {title, username?, secret}', run: (a, ctx) => { if (!a.secret) return 'A password needs the secret'; stateOf(ctx.store).addDriveItem({ kind: 'password', title: clean(a.title, 80), username: clean(a.username, 120), secret: String(a.secret) }); return `Password for "${clean(a.title, 80)}" saved to Drive (this device only)`; } },
  plan: { desc: 'plan {text} — open Myth Planner for a trip / event / exam / fitness / launch described in text', run: (a, ctx) => {
    const { session, reply } = startPlannerSession(clean(a.text ?? a.title, 300), ctx.store);
    if (!session) return reply;
    ctx.ui?.setPlannerFocus?.(session.id);
    ctx.ui?.showPlannerInline?.(true);
    ctx.ui?.setPanel?.(null);
    return `Planner opened — ${reply}`;
  } },
  open: { desc: 'open {panel: tasks|projects|drive|learning|habits|finance|calendar|today|reminders|track|reports|settings|planner}', run: (a, ctx) => {
    const key = clean(a.panel ?? a.name, 20).toLowerCase();
    const ok = ['tasks', 'projects', 'drive', 'learning', 'habits', 'finance', 'calendar', 'today', 'reminders', 'track', 'reports', 'settings', 'planner'];
    if (!ok.includes(key)) return `Unknown panel "${key}"`;
    if (key === 'planner') { ctx.ui?.showPlannerInline?.(true); ctx.ui?.setPanel?.(null); } else ctx.ui?.setPanel?.(key);
    return `Opened ${key}`;
  } },
  capture: { desc: 'capture {text} — free-text capture through the same engine as the Myth AI bar', run: (a, ctx) => {
    const s = stateOf(ctx.store);
    const parsed = parseCapture(clean(a.text, 300), s.projects);
    return parsed ? executeCapture(parsed, ctx.store) : 'Nothing to capture';
  } },
};

/** One-line catalogue for the system prompt. */
export const actionCatalogue = () => Object.values(ACTIONS).map((a) => `• ${a.desc}`).join('\n');

// ---------- parsing the model's answer ----------
const BLOCK = /```(?:myth(?:-actions)?|actions)\s*([\s\S]*?)```/gi;
const TAG = /<actions>\s*([\s\S]*?)<\/actions>/gi;

function coerce(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.actions)) return json.actions;
  if (json && typeof json === 'object' && json.action) return [json];
  return [];
}

/** Split a reply into the text to show and the actions to run. */
export function parseActions(text) {
  const actions = [];
  let cleanText = String(text ?? '');
  const eat = (rx) => {
    cleanText = cleanText.replace(rx, (_, body) => { try { actions.push(...coerce(JSON.parse(body))); } catch { /* junk block — dropped */ } return ''; });
  };
  eat(BLOCK);
  eat(TAG);
  // the whole reply is one JSON object/array of actions
  const t = cleanText.trim();
  if (!actions.length && /^[[{]/.test(t) && /[\]}]$/.test(t)) {
    try { const list = coerce(JSON.parse(t)); if (list.length) { actions.push(...list); cleanText = ''; } } catch { /* prose that happens to start with { */ }
  }
  return { text: cleanText.replace(/\n{3,}/g, '\n\n').trim(), actions: actions.filter((a) => a && typeof a === 'object' && typeof a.action === 'string') };
}

/** While streaming: hide the action block as soon as it starts. */
export function visibleText(streaming) {
  const s = String(streaming ?? '');
  const cut = ['```myth', '```actions', '<actions>'].map((m) => s.indexOf(m)).filter((i) => i >= 0);
  return (cut.length ? s.slice(0, Math.min(...cut)) : s).replace(/\s+$/, '');
}

/** Run actions in order; returns one line per action. Never throws. */
export async function runActions(actions, ctx) {
  const lines = [];
  for (const a of actions.slice(0, 12)) {
    const def = ACTIONS[a.action];
    if (!def) { lines.push(`⚠️ I don't know how to "${a.action}"`); continue; }
    try {
      const res = await def.run(a, ctx);
      lines.push(`✅ ${res}`);
    } catch (e) {
      lines.push(`⚠️ ${a.action} failed: ${e.message}`);
    }
  }
  return lines;
}

// ---------- plain-English shortcuts (work without a model) ----------
const ATTACH = /^(?:please\s+|can you\s+|could you\s+)?(?:add|put|save|attach|move|upload|send|store|keep|file)\s+(?:this|that|the|it|these|those|my)?\s*(?:file|files|pdf|doc|document|docs|image|screenshot|attachment|it)?\s*(?:file)?\s*(?:to|into|in|under|on)\s+(?:my\s+|the\s+)?(learning|drive|vault|projects?)(?:\s*(?:pipeline|list|section|tab|folder))?\s*(?:(?:[:-]|called|named|as|under|for|in)\s*(.+))?$/i;
const GENERATE = /^(?:please\s+|can you\s+|could you\s+)?(?:create|generate|make|write|draft|prepare|build)\s+(?:me\s+)?(?:a|an|the)?\s*(?:short\s+|quick\s+|detailed\s+|simple\s+|one[- ]page\s+)?(pdf|markdown|md|text|txt|csv|html|json|doc|document|file|notes?|guide|cheat\s*sheet|summary|study\s+(?:sheet|notes|guide|plan)|report|checklist|outline|syllabus)\b\s*(?:file|document)?\s*(?:about|on|for|of|covering|explaining|summari[sz]ing|from)?\s*(.+?)(?:\s*(?:,|and|then|&)?\s*(?:add|save|put|attach|store|keep|file)\s+(?:it\s+|this\s+|that\s+)?(?:to|into|in|under)\s+(?:my\s+|the\s+)?(learning|drive|vault|projects?|files?)(?:\s+(?:called|named|as|under|for|in)?\s*(.+))?)?\s*[.!]?$/i;

/**
 * Handle the everyday file sentences locally. Returns a reply string or null.
 * ctx.write(prompt) must return the model's text for document generation.
 */
export async function localActionIntent(q, ctx) {
  const t = String(q ?? '').trim();
  let m = t.match(ATTACH);
  if (m && (ctx.files?.length)) {
    const target = m[1].toLowerCase();
    const name = clean(m[2], 80);
    const to = /^proj/.test(target) ? 'project' : /^learn/.test(target) ? 'learning' : 'drive';
    const lines = [];
    for (const f of ctx.files.slice(0, 5)) lines.push(`✅ ${await placeFile(ctx, f, { to, learning: to === 'learning' ? name : null, project: to === 'project' ? name : null, title: to !== 'project' && to !== 'learning' ? name : null })}`);
    return lines.join('\n');
  }
  m = t.match(GENERATE);
  if (m) {
    const kind = m[1].toLowerCase();
    const format = /pdf/.test(kind) ? 'pdf' : /csv/.test(kind) ? 'csv' : /html/.test(kind) ? 'html' : /json/.test(kind) ? 'json' : /txt|text/.test(kind) ? 'txt' : 'md';
    const topic = clean(m[2], 200).replace(/^(?:about|on|for|of)\s+/i, '');
    const to = m[3] ? (/^proj/.test(m[3]) ? 'project' : /^learn/.test(m[3]) ? 'learning' : /^file/.test(m[3]) ? 'files' : 'drive') : 'drive';
    const targetName = clean(m[4], 80);
    if (!topic || !ctx.write) return null;
    const attached = (ctx.files ?? []).find((f) => f.text);
    const usesFile = attached && /\b(?:this|the|attached|uploaded)\s+(?:file|pdf|doc|document)\b|\bfrom (?:this|the) file\b/i.test(t);
    const body = await ctx.write(
      `Write the content of a ${kind} titled "${titleCase(topic)}". Use clean Markdown: a few "##" sections, short paragraphs and "-" bullet lists. Be concrete and useful, 250-600 words, no preamble, no closing remarks.${usesFile ? `\n\nBase it on this source text:\n${attached.text.slice(0, 12000)}` : ''}`,
    );
    if (!body) return '⚠️ I need the AI model to write that — check Settings → AI brain.';
    const res = await ACTIONS.create_file.run({ title: titleCase(topic), format, content: body, to, learning: to === 'learning' ? targetName || titleCase(topic) : null, project: to === 'project' ? targetName : null }, ctx);
    return `✅ ${res}`;
  }
  return null;
}
