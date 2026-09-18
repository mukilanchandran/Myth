// Unit tests for Track — the work-log engine (src/ai/worklog.js), its routing
// through the capture parser and the assistant's actions. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  parseDuration, parseRange, parseWorkLog, looksLikeWorkLog, placeEntry, fmtMinutes, fmtClock, entriesOn, totalMinutes, byProject,
  byCategory, weekDays, monthGrid, trackStreak, autoSummary, summaryFor, workRundown, timeOnProject, trackForAi, suggestWorkLogs,
  rangeFor, projectPool, inferProject, toStatus, statusLine, byStatus, countByDate, entryLine, standupText,
} from '../src/ai/worklog.js';
import { parseCapture, parseMulti, executeCapture } from '../src/ai/parser.js';
import { runActions } from '../src/ai/actions.js';

const NOW = new Date('2026-09-18T15:00:00'); // a Friday
const PROJECTS = [{ id: 'p1', name: 'GHMC', color: '#1971c2' }, { id: 'p2', name: 'Acme Portal' }];

function fakeStore(extra = {}) {
  const s = {
    worklog: [], worklogSummaries: {}, worklogTimer: null, projects: PROJECTS, tasks: [], events: [], settings: { name: 'Mukil' },
    addXp: () => {},
    addWorkLog: (e) => { const slot = e.start || e.end ? placeEntry(e, s.worklog) : { start: null, end: null, minutes: Math.max(0, Math.round(Number(e.minutes) || 0)) }; const entry = { id: `w${s.worklog.length}`, note: '', project: '', projectId: null, status: 'done', ...e, ...slot }; s.worklog.unshift(entry); return entry; },
    updateWorkLog: (id, patch) => { s.worklog = s.worklog.map((w) => (w.id === id ? { ...w, ...patch } : w)); },
    deleteWorkLog: (id) => { s.worklog = s.worklog.filter((w) => w.id !== id); },
    startWorkTimer: (t) => { s.worklogTimer = { ...t, startedAt: new Date(Date.now() - 25 * 60000).toISOString() }; },
    stopWorkTimer: () => { const t = s.worklogTimer; s.worklogTimer = null; return t ? s.addWorkLog({ title: t.title, date: dayjs().format('YYYY-MM-DD'), minutes: 25, projectId: t.projectId, project: t.project }) : null; },
    setWorkSummary: (date, text, source) => { s.worklogSummaries[date] = { text, source }; },
    ...extra,
  };
  return { getState: () => s, state: s };
}
const ctxFor = (store) => ({ store, files: [], ui: {} });

test('parseDuration reads hours, minutes and words', () => {
  assert.equal(parseDuration('for 2 hours').minutes, 120);
  assert.equal(parseDuration('1.5h').minutes, 90);
  assert.equal(parseDuration('1h 30m').minutes, 90);
  assert.equal(parseDuration('2 hrs and 15 mins').minutes, 135);
  assert.equal(parseDuration('about 45 min').minutes, 45);
  assert.equal(parseDuration('half an hour').minutes, 30);
  assert.equal(parseDuration('an hour and a half').minutes, 90);
  assert.equal(parseDuration('for 2 hours').match, 'for 2 hours');
  assert.equal(parseDuration('attended 5 meetings'), null);
  assert.equal(parseDuration('spent 250 on lunch'), null);
});

test('parseRange reads clock ranges and ignores plain numbers', () => {
  assert.deepEqual({ ...parseRange('10am-11:30am'), match: undefined }, { start: '10:00', end: '11:30', minutes: 90, match: undefined });
  assert.equal(parseRange('from 9 to 11am').start, '09:00');
  assert.equal(parseRange('11-1pm').start, '11:00');
  assert.equal(parseRange('11-1pm').end, '13:00');
  assert.equal(parseRange('14:00 to 15:30').minutes, 90);
  assert.equal(parseRange('9:30-1:00').end, '13:00');
  assert.equal(parseRange('3pm-4pm').minutes, 60);
  assert.equal(parseRange('fixed 2-3 bugs'), null);
});

test('parseWorkLog pulls title, time, day, project and category', () => {
  const a = parseWorkLog('worked on GHMC dashboard filters for 2h yesterday', PROJECTS, NOW);
  assert.equal(a.title, 'GHMC dashboard filters');
  assert.equal(a.minutes, 120);
  assert.equal(a.date, '2026-09-17');
  assert.equal(a.projectId, 'p1');
  assert.equal(a.project, 'GHMC');

  const b = parseWorkLog('Acme Portal: fixed login bug 10am-11:30am', PROJECTS, NOW);
  assert.equal(b.title, 'Fixed login bug');
  assert.equal(b.start, '10:00');
  assert.equal(b.end, '11:30');
  assert.equal(b.minutes, 90);
  assert.equal(b.projectId, 'p2');
  assert.equal(b.category, 'dev');
  assert.equal(b.date, '2026-09-18');

  const c = parseWorkLog('spent 45 min on code review #Falcon', PROJECTS, NOW);
  assert.equal(c.title, 'Code review');
  assert.equal(c.minutes, 45);
  assert.equal(c.project, 'Falcon');
  assert.equal(c.projectId, null);

  const d = parseWorkLog('log work: client call 3pm-4pm on monday', PROJECTS, NOW);
  assert.equal(d.title, 'Client call');
  assert.equal(d.category, 'meeting');
  assert.equal(d.date, '2026-09-14'); // the Monday that already happened
  const e = parseWorkLog('spent 45 min on code review for GHMC', PROJECTS, NOW);
  assert.equal(e.title, 'Code review'); // the project moved to its own field
  assert.equal(e.projectId, 'p1');
  assert.equal(parseWorkLog('did 2h of wireframes', [], NOW).title, 'Wireframes');
  assert.equal(parseWorkLog('did 2h of wireframes', [], NOW).category, 'design');
  assert.equal(parseWorkLog('   ', [], NOW), null);
});

test('status: read from the sentence, done unless it says otherwise', () => {
  assert.equal(parseWorkLog('worked on the payment gateway', [], NOW).status, 'done');
  const a = parseWorkLog('worked on payment gateway - in progress', [], NOW);
  assert.deepEqual([a.title, a.status, a.minutes], ['Payment gateway', 'progress', null]);
  const b = parseWorkLog('still working on the export module', [], NOW);
  assert.deepEqual([b.title, b.status], ['Export module', 'progress']);
  assert.equal(parseWorkLog('log work: vendor API integration (blocked)', [], NOW).status, 'blocked');
  assert.equal(parseWorkLog('log work: vendor API integration (blocked)', [], NOW).title, 'Vendor API integration');
  assert.equal(parseWorkLog('worked on the pricing page, in review', [], NOW).status, 'review');
  assert.equal(toStatus('In Progress'), 'progress');
  assert.equal(toStatus('WIP'), 'progress');
  assert.equal(toStatus('completed'), 'done');
  assert.equal(toStatus('stuck'), 'blocked');
  assert.equal(toStatus(''), null);
});

test('looksLikeWorkLog separates time from money, tasks and questions', () => {
  assert.equal(looksLikeWorkLog('worked on the api for 2 hours'), true);
  assert.equal(looksLikeWorkLog('spent 2h on the dashboard'), true);
  assert.equal(looksLikeWorkLog('log work: demo prep'), true);
  assert.equal(looksLikeWorkLog('fixed login bug 10am-11am'), true);
  assert.equal(looksLikeWorkLog('spent 250 on lunch'), false);
  assert.equal(looksLikeWorkLog('fix the login bug tomorrow'), false);
  assert.equal(looksLikeWorkLog('worked on the api'), true); // the time is optional
  assert.equal(looksLikeWorkLog('today I fixed the login redirect'), true);
  assert.equal(looksLikeWorkLog('fixed the login redirect'), false); // could be anything — left to the model
  assert.equal(looksLikeWorkLog('how long did I work for 2 hours?'), false);
});

test('the capture parser routes work logs — and still routes expenses', () => {
  assert.equal(parseCapture('spent 2h on GHMC reports', PROJECTS).kind, 'worklog');
  assert.equal(parseCapture('spent 250 on lunch', PROJECTS).kind, 'expense');
  assert.equal(parseCapture('remind me to log my work for 1 hour at 6pm', PROJECTS).kind, 'reminder');
  const many = parseMulti('worked on GHMC api for 2h, reviewed the PR for 30 min', PROJECTS);
  assert.deepEqual(many.map((m) => m.kind), ['worklog', 'worklog']);
  const store = fakeStore();
  const line = executeCapture(parseCapture('worked on GHMC api for 2h', PROJECTS), store);
  assert.match(line, /Work logged — "GHMC api" · GHMC · 2h/);
  // no time said → none recorded
  const plain = executeCapture(parseCapture('worked on the GHMC onboarding screens', PROJECTS), store);
  assert.match(plain, /Work logged — "GHMC onboarding screens" · GHMC$/);
  assert.equal(store.state.worklog[0].minutes, 0);
  assert.equal(store.state.worklog[0].start, null);
  assert.equal(store.state.worklog[0].status, 'done');
  assert.equal(store.state.worklog[1].minutes, 120);
});

test('placeEntry always lands an entry on the grid', () => {
  assert.deepEqual(placeEntry({ date: '2026-09-18', start: '10:00', end: '11:30' }, [], NOW), { start: '10:00', end: '11:30', minutes: 90, approx: false });
  assert.deepEqual(placeEntry({ date: '2026-09-18', start: '10:00', minutes: 45 }, [], NOW), { start: '10:00', end: '10:45', minutes: 45, approx: false });
  // today, duration only → it just ended
  assert.deepEqual(placeEntry({ date: '2026-09-18', minutes: 120 }, [], NOW), { start: '13:00', end: '15:00', minutes: 120, approx: true });
  // a past day → queued after that day's last entry, from 09:00
  assert.equal(placeEntry({ date: '2026-09-17', minutes: 60 }, [], NOW).start, '09:00');
  assert.equal(placeEntry({ date: '2026-09-17', minutes: 60 }, [{ date: '2026-09-17', end: '12:30' }], NOW).start, '12:30');
  assert.equal(placeEntry({ date: '2026-09-17' }, [], NOW).minutes, 30);
});

test('formatting', () => {
  assert.equal(fmtMinutes(135), '2h 15m');
  assert.equal(fmtMinutes(120), '2h');
  assert.equal(fmtMinutes(45), '45m');
  assert.equal(fmtClock('09:30'), '9:30 AM');
  assert.equal(fmtClock('13:05'), '1:05 PM');
  assert.equal(fmtClock('00:00'), '12:00 AM');
});

const LOG = [
  { id: 'a', date: '2026-09-18', start: '09:00', end: '11:00', minutes: 120, title: 'Dashboard filters', projectId: 'p1', category: 'dev' },
  { id: 'b', date: '2026-09-18', start: '11:30', end: '12:15', minutes: 45, title: 'Client call', project: 'Falcon', category: 'meeting', status: 'progress' },
  { id: 'c', date: '2026-09-17', start: '10:00', end: '13:00', minutes: 180, title: 'API integration', projectId: 'p1', category: 'dev', note: 'auth done' },
  { id: 'd', date: '2026-09-15', start: '10:00', end: '11:00', minutes: 60, title: 'Wireframes', projectId: 'p2', category: 'design' },
];

test('totals, breakdowns, calendar helpers and the streak', () => {
  assert.equal(totalMinutes(entriesOn(LOG, '2026-09-18')), 165);
  assert.deepEqual(byProject(LOG, PROJECTS).map((p) => [p.name, p.minutes]), [['GHMC', 300], ['Acme Portal', 60], ['Falcon', 45]]);
  assert.deepEqual(byCategory(LOG).map((c) => [c.key, c.minutes]), [['dev', 300], ['design', 60], ['meeting', 45]]);
  const week = weekDays(dayjs(NOW));
  assert.equal(week[0].format('YYYY-MM-DD ddd'), '2026-09-14 Mon');
  assert.equal(week[6].format('YYYY-MM-DD'), '2026-09-20');
  const grid = monthGrid(dayjs(NOW));
  assert.equal(grid[0][0].format('YYYY-MM-DD'), '2026-08-31');
  assert.ok(grid.every((w) => w.length === 7));
  assert.equal(trackStreak(LOG, dayjs(NOW)), 2);
  assert.equal(trackStreak(LOG.filter((e) => e.date !== '2026-09-18'), dayjs(NOW)), 1); // today still empty → yesterday counts
  assert.equal(trackStreak([], dayjs(NOW)), 0);
});

test('the daily summary is automatic until one is saved', () => {
  const state = { worklog: LOG, projects: PROJECTS, worklogSummaries: {}, settings: {} };
  const auto = summaryFor(state, '2026-09-18');
  assert.equal(auto.source, 'auto');
  assert.match(auto.text, /^2 items logged — 1 done · 1 in progress · 2h 45m recorded\./);
  assert.match(auto.text, /Projects: GHMC \(1, 2h\), Falcon \(1, 45m\)\./);
  assert.match(auto.text, /Still open: Client call\./);
  assert.match(auto.text, /• Falcon — Client call \[In progress\] \(45m\)/);
  // a day logged without any time reads just as well
  const bare = [{ id: 'x', date: '2026-09-16', title: 'Set up CI', note: 'GitHub Actions, lint + test', project: 'GHMC' }, { id: 'y', date: '2026-09-16', title: 'Review PR 42', status: 'review' }];
  assert.equal(autoSummary(bare, PROJECTS).split('\n')[0], '2 items logged — 1 done · 1 in review.');
  assert.equal(entryLine(bare[0], PROJECTS), 'GHMC — Set up CI — GitHub Actions, lint + test');
  assert.equal(statusLine(bare), '1 done · 1 in review');
  assert.deepEqual(byStatus(bare).map((r) => [r.key, r.count]), [['done', 1], ['review', 1]]);
  assert.deepEqual(countByDate(LOG), { '2026-09-18': 2, '2026-09-17': 1, '2026-09-15': 1 });
  assert.match(standupText({ worklog: bare, projects: PROJECTS }, '2026-09-16'), /^Work log — Wed, Sep 16 · 2 items\n• GHMC — Set up CI/);
  assert.equal(autoSummary([], PROJECTS), '');
  state.worklogSummaries['2026-09-18'] = { text: 'Shipped the filters.', source: 'ai' };
  assert.deepEqual(summaryFor(state, '2026-09-18'), { text: 'Shipped the filters.', source: 'ai', updated: null });
});

test('the assistant reads the log: rundowns, time on a project, the AI snapshot', () => {
  const state = { worklog: LOG, projects: PROJECTS, worklogSummaries: {}, worklogTimer: null, settings: {} };
  assert.deepEqual(rangeFor('this week', NOW), { from: '2026-09-14', to: '2026-09-20', label: 'this week' });
  assert.equal(rangeFor('yesterday', NOW).from, '2026-09-17');
  assert.match(workRundown(state, 'today', NOW), /Work logged today: 2 items — 1 done · 1 in progress · 2h 45m recorded\./);
  assert.match(workRundown(state, 'today', NOW), /• Falcon — Client call \[In progress\] \(45m\)/);
  assert.match(workRundown(state, 'this week', NOW), /4 items — 3 done · 1 in progress · 6h 45m recorded/);
  assert.match(workRundown(state, 'this week', NOW), /Thu, Sep 17 — 1 item, 3h: API integration/);
  assert.match(workRundown({ ...state, worklog: [] }, 'today', NOW), /Nothing logged today/);
  assert.match(timeOnProject(state, 'ghmc', 'this week', NOW), /^5h on "ghmc" this week — 2 items over 2 days\./);
  assert.match(timeOnProject(state, 'nothing', 'this week', NOW), /Nothing logged on/);
  const untimed = { ...state, worklog: [{ id: 'u', date: '2026-09-18', title: 'GHMC schema cleanup' }] };
  assert.match(timeOnProject(untimed, 'ghmc', 'this week', NOW), /^1 item on "ghmc" this week over 1 day — no time was recorded/);
  const ai = trackForAi(state, NOW);
  assert.equal(ai.today.minutes, 165);
  assert.equal(ai.yesterday.minutes, 180);
  assert.equal(ai.thisWeek.minutes, 405);
  assert.equal(ai.thisWeek.byProject[0].project, 'GHMC');
  assert.equal(ai.today.items, 2);
  assert.deepEqual(ai.thisWeek.stillOpen.map((w) => [w.title, w.status]), [['Client call', 'In progress']]);
  assert.equal(ai.today.entries[1].status, 'In progress');
  assert.equal(ai.thisWeek.perDay.find((d) => d.day === 'Fri').minutes, 165);
  assert.equal(ai.streakDays, 2);
});

test('suggestions: finished tasks and past meetings that are not logged', () => {
  const state = {
    worklog: LOG,
    tasks: [{ id: 't1', title: 'Write release notes', completedAt: '2026-09-18T14:00:00', estimate: 45 }, { id: 't2', title: 'Dashboard filters', completedAt: '2026-09-18T11:00:00' }],
    events: [{ id: 'e1', title: 'Sprint review', date: '2026-09-18', time: '13:00', end: '13:45', kind: 'meeting' }, { id: 'e2', title: 'Evening sync', date: '2026-09-18', time: '18:00', kind: 'meeting' }],
  };
  const out = suggestWorkLogs(state, '2026-09-18', NOW);
  assert.deepEqual(out.map((s) => s.title), ['Sprint review', 'Write release notes']); // logged + future ones are left out
  assert.equal(out[0].minutes, 45);
  assert.equal(out[1].start, '13:15');
});

test('a project named once is recognised the next time without a prefix', () => {
  const pool = projectPool(PROJECTS, LOG);
  assert.deepEqual(pool.map((p) => p.name), ['GHMC', 'Acme Portal', 'Falcon']);
  assert.equal(inferProject('Falcon api integration', pool).name, 'Falcon');
  assert.equal(inferProject('ghmc: export bug', pool).id, 'p1');
  assert.equal(inferProject('Falconry club notes', pool), null); // whole words only
  assert.equal(parseWorkLog('worked on falcon onboarding for 1h', pool, NOW).project, 'Falcon');
});

test('actions: log_work, update_work, the timer, the summary and delete', async () => {
  const store = fakeStore();
  const lines = await runActions([
    { action: 'log_work', title: 'Fixed the export bug', duration: '1h 30m', project: 'ghmc' },
    { action: 'log_work', title: 'Design review', start: '10:00', end: '10:45', project: 'Nova', category: 'meeting', date: 'yesterday' },
    { action: 'start_timer', title: 'Acme Portal onboarding flow' },
    { action: 'stop_timer' },
    { action: 'save_work_summary', text: 'Closed the export bug and reviewed designs.' },
    { action: 'work_summary', range: 'today' },
    { action: 'delete_work', title: 'design review' },
    { action: 'log_work', title: 'Vendor API integration', description: 'waiting for sandbox keys', status: 'blocked', project: 'Acme Portal' },
    { action: 'update_work', title: 'vendor api', status: 'done', description: 'keys arrived, integrated' },
  ], ctxFor(store));
  assert.match(lines[0], /Logged "Fixed the export bug" · GHMC · Done · 1h 30m · today$/);
  assert.match(lines[1], /Logged "Design review" · Nova · Done · 45m · .* 10:00–10:45/);
  assert.match(lines[2], /Timer started — "Acme Portal onboarding flow" · Acme Portal/);
  assert.match(lines[3], /Timer stopped — "Acme Portal onboarding flow" logged, 25m/);
  assert.match(lines[4], /Daily summary saved/);
  assert.match(lines[5], /Work logged today: 2 items — 2 done · 1h 55m recorded/);
  assert.match(lines[6], /Work log "Design review" deleted/);
  assert.match(lines[7], /Logged "Vendor API integration" · Acme Portal · Blocked · today$/);
  assert.match(lines[8], /"Vendor API integration" updated — Done/);
  const s = store.state;
  assert.equal(s.worklog.length, 3);
  const vendor = s.worklog.find((w) => w.title === 'Vendor API integration');
  assert.deepEqual([vendor.status, vendor.note, vendor.minutes, vendor.projectId], ['done', 'keys arrived, integrated', 0, 'p2']);
  assert.equal(s.worklog.find((w) => w.title === 'Fixed the export bug').projectId, 'p1');
  assert.equal(s.worklogSummaries[dayjs().format('YYYY-MM-DD')].source, 'ai');
  assert.match((await runActions([{ action: 'stop_timer' }], ctxFor(store)))[0], /No timer is running/);
});
