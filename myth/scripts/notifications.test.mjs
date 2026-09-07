// Unit tests for the Notification Intelligence Engine (src/ai/notifications.js).
// Run: npm test — plain node:test, no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  smartNotifications, selectForDelivery, isMuted, visibleNotifications, composeDigest, inQuietHours,
  freeMinutesOn, streakOf, performAction,
} from '../src/ai/notifications.js';

const NOW = dayjs('2026-09-07T10:00:00'); // a Monday, 10 am
const D = (n) => NOW.add(n, 'day').format('YYYY-MM-DD');
const TODAY = D(0);
const TOMORROW = D(1);

let seq = 0;
const task = (over = {}) => ({ id: `t${++seq}`, title: `Task ${seq}`, status: 'todo', priority: 3, due: null, estimate: null, projectId: null, ...over });
const event = (over = {}) => ({ id: `e${++seq}`, title: `Event ${seq}`, date: TODAY, time: null, kind: 'event', yearly: false, ...over });
const base = (over = {}) => ({ tasks: [], events: [], notes: [], habits: [], plans: {}, projects: [], transactions: [], files: [], drive: [], notifyMuted: {}, settings: {}, ...over });
const fullTomorrow = () => [
  event({ title: 'Standup', date: TOMORROW, time: '08:00', end: '12:00', kind: 'meeting' }),
  event({ title: 'Workshop', date: TOMORROW, time: '12:00', end: '17:00', kind: 'meeting' }),
  event({ title: 'Client dinner', date: TOMORROW, time: '17:00', end: '21:00', kind: 'meeting' }),
];
const byKind = (list, kind) => list.filter((n) => n.kind === kind);

test('freeMinutesOn counts the working day minus events, from now when it is today', () => {
  assert.equal(freeMinutesOn(base(), TODAY, NOW), 11 * 60);
  assert.equal(freeMinutesOn(base(), TOMORROW, NOW), 13 * 60);
  assert.equal(freeMinutesOn(base({ events: fullTomorrow() }), TOMORROW, NOW), 0);
});

test('a task due tomorrow with no room tomorrow becomes "handle this today" with the reasoning', () => {
  const state = base({
    tasks: [task({ title: 'Proposal', due: TOMORROW, estimate: 120 })],
    events: fullTomorrow(),
  });
  const [n] = byKind(smartNotifications(state, NOW), 'room');
  assert.equal(n.level, 'act');
  assert.equal(n.headline, 'You should handle this today.');
  assert.deepEqual(n.lines, [
    'Proposal is due tomorrow and needs ~2 hours.',
    'Your calendar is already full tomorrow (3 meetings).',
    'You have 11 hours free today — the 10:00–12:00 slot fits it.',
  ]);
  assert.equal(n.action.type, 'block');
  assert.equal(n.action.start, '10:00');
});

test('when today has no room either, it becomes a decision instead of a block', () => {
  const state = base({
    tasks: [task({ title: 'Proposal', due: TOMORROW, estimate: 120 })],
    events: [...fullTomorrow(), event({ title: 'All-day offsite', time: '08:00', end: '21:00', kind: 'meeting' })],
  });
  const [n] = byKind(smartNotifications(state, NOW), 'room');
  assert.equal(n.level, 'plan');
  assert.equal(n.headline, 'Tomorrow can’t absorb this.');
  assert.match(n.lines[2], /Today only has 0 min left too/);
  assert.equal(n.action.type, 'open');
});

test('a task due tomorrow that fits tomorrow makes no noise at all', () => {
  const state = base({ tasks: [task({ title: 'Proposal', due: TOMORROW, estimate: 120 })] });
  assert.deepEqual(smartNotifications(state, NOW), []);
});

test('an overbooked day suggests exactly which tasks to move', () => {
  const state = base({
    tasks: [
      task({ title: 'Board deck', due: TODAY, priority: 5, estimate: 180 }),
      task({ title: 'Expense report', due: TODAY, priority: 2, estimate: 60 }),
      task({ title: 'Inbox zero', due: TODAY, priority: 1, estimate: 60 }),
    ],
    events: [event({ title: 'Reviews', time: '10:00', end: '18:00', kind: 'meeting' })], // 3h left today
  });
  const [n] = byKind(smartNotifications(state, NOW), 'overbooked');
  assert.equal(n.level, 'act');
  assert.equal(n.lines[0], '3 tasks due by today need ~5 hours; 3 hours of free time is left.');
  assert.match(n.lines[1], /^Move "Inbox zero" and "Expense report" to tomorrow — it has room\./);
  assert.deepEqual(n.action.taskIds.length, 2);
});

test('overdue tasks collapse into one notification, never one per task', () => {
  const state = base({ tasks: [task({ title: 'A', due: D(-4) }), task({ title: 'B', due: D(-1) }), task({ title: 'C', due: D(-2), priority: 5 })] });
  const list = byKind(smartNotifications(state, NOW), 'overdue');
  assert.equal(list.length, 1);
  assert.equal(list[0].headline, '3 tasks have slipped past their dates.');
  assert.equal(list[0].level, 'act');
  assert.equal(list[0].lines[0], '• A — 4 days late');
});

test('a project deadline the free time cannot cover is called out', () => {
  const state = base({
    projects: [{ id: 'p1', name: 'Launch', status: 'active', deadline: D(1) }],
    tasks: [task({ title: 'X', projectId: 'p1', estimate: 600 }), task({ title: 'Y', projectId: 'p1', estimate: 600 })],
    events: fullTomorrow(),
  });
  const [n] = byKind(smartNotifications(state, NOW), 'deadline');
  assert.equal(n.headline, '"Launch" won’t make tomorrow at this pace.');
  assert.equal(n.lines[0], '2 open tasks need ~20 hours; only 11 hours is free before then.');
  assert.equal(n.level, 'act');
});

test('an evening streak at risk is named; a one-day habit is not nagged about', () => {
  const evening = NOW.hour(20);
  const log = {};
  for (let i = 1; i <= 5; i++) log[D(-i)] = true;
  const state = base({ habits: [{ id: 'h1', name: 'Workout', log }, { id: 'h2', name: 'Read', log: { [D(-1)]: true } }] });
  const [n] = byKind(smartNotifications(state, evening), 'habit');
  assert.equal(n.headline, 'Your 5-day "Workout" streak ends at midnight.');
  assert.equal(streakOf(state.habits[0], evening), 5);
  assert.deepEqual(byKind(smartNotifications(state, NOW), 'habit'), []); // not in the morning
});

test('a birthday tomorrow with nothing planned offers a task; with a task it stays quiet', () => {
  const state = base({ events: [event({ title: "Amma's birthday", date: '2020-09-08', yearly: true, kind: 'birthday' })] });
  const [n] = byKind(smartNotifications(state, NOW), 'birthday');
  assert.equal(n.headline, "Amma's birthday is tomorrow.");
  assert.deepEqual(n.action, { type: 'task', title: 'Wish Amma — call or gift', due: TOMORROW, label: 'Add a reminder task' });
  state.tasks = [task({ title: 'Buy Amma flowers', due: TOMORROW })];
  assert.deepEqual(byKind(smartNotifications(state, NOW), 'birthday'), []);
});

test('bills quote what they cost last time', () => {
  const state = base({
    events: [event({ title: 'Electricity bill', date: TOMORROW, kind: 'bill' })],
    transactions: [{ id: 'x1', type: 'expense', amount: 1840, category: 'Home & Bills', note: 'Electricity', date: D(-30) }],
  });
  const [n] = byKind(smartNotifications(state, NOW), 'bill');
  assert.equal(n.headline, 'Electricity bill is due tomorrow.');
  assert.match(n.lines[0], /Last time it was ₹1,840/);
});

test('delivery policy: once per situation, re-sent only when it changes or escalates', () => {
  const state = base({ tasks: [task({ title: 'Proposal', due: TOMORROW, estimate: 120 })], events: fullTomorrow() });
  const at = NOW.hour(13); // inside a delivery window
  const first = selectForDelivery(smartNotifications(state, at), [], at);
  assert.equal(first.length, 1);
  const log = first.map((n) => ({ key: n.key, fp: n.fp, level: n.level, ts: at.valueOf() }));
  assert.deepEqual(selectForDelivery(smartNotifications(state, at.add(1, 'hour')), log, at.add(1, 'hour')), []);
  // the situation changes (the estimate grows) but it was said an hour ago → still quiet
  state.tasks[0].estimate = 240;
  assert.deepEqual(selectForDelivery(smartNotifications(state, at.add(1, 'hour')), log, at.add(1, 'hour')), []);
  // …and after six hours the changed situation is worth saying again
  assert.equal(selectForDelivery(smartNotifications(state, at.add(7, 'hour')), log, at.add(7, 'hour')).length, 1);
});

test('delivery policy: quiet hours, daily budget, and fyi only in windows', () => {
  const state = base({ tasks: [task({ title: 'Proposal', due: TOMORROW, estimate: 120 })], events: fullTomorrow() });
  const notifs = smartNotifications(state, NOW);
  assert.deepEqual(selectForDelivery(notifs, [], NOW.hour(23)), []);
  assert.equal(inQuietHours(NOW.hour(6)), true);
  assert.equal(inQuietHours(NOW.hour(9)), false);
  const spent = Array.from({ length: 4 }, (_, i) => ({ key: `k${i}`, fp: '', level: 'act', ts: NOW.hour(8).valueOf() }));
  assert.deepEqual(selectForDelivery(notifs, spent, NOW.hour(13)), []);
  assert.equal(selectForDelivery(notifs, spent, NOW.hour(13), { notifyBudget: 6 }).length, 1);

  const fyi = [{ key: 'plan:x', fp: '1', level: 'fyi', kind: 'plan', headline: 'h', lines: [] }];
  assert.deepEqual(selectForDelivery(fyi, [], NOW.hour(11)), []);
  assert.equal(selectForDelivery(fyi, [], NOW.hour(13)).length, 1);
});

test('snooze hides regardless; dismiss is bound to the situation', () => {
  const n = { key: 'overdue', fp: 'a,b' };
  assert.equal(isMuted(n, { overdue: { until: NOW.add(1, 'day').toISOString(), fp: null } }, NOW), true);
  assert.equal(isMuted(n, { overdue: { until: NOW.add(1, 'day').toISOString(), fp: 'a,b' } }, NOW), true);
  assert.equal(isMuted(n, { overdue: { until: NOW.add(1, 'day').toISOString(), fp: 'a,b,c' } }, NOW), false);
  assert.equal(isMuted(n, { overdue: { until: NOW.subtract(1, 'hour').toISOString(), fp: null } }, NOW), false);
  const state = base({ tasks: [task({ title: 'A', due: D(-4) })], notifyMuted: { overdue: { until: NOW.add(1, 'day').toISOString(), fp: null } } });
  assert.deepEqual(visibleNotifications(state, NOW), []);
});

test('composeDigest leads with the top item and folds the rest into one line', () => {
  const d = composeDigest([
    { level: 'act', headline: 'You should handle this today.', lines: ['Proposal is due tomorrow and needs ~2 hours.', 'Your calendar is already full tomorrow.'] },
    { level: 'plan', headline: 'No follow-up after "Client review" yet.', lines: [] },
  ], 'morning');
  assert.equal(d.title, 'You should handle this today.');
  assert.equal(d.body, 'Proposal is due tomorrow and needs ~2 hours. Your calendar is already full tomorrow.\n+1 more in Myth: No follow-up after "Client review" yet');
  assert.equal(composeDigest([], 'morning'), null);
});

test('performAction writes through the store', () => {
  const calls = [];
  const store = { getState: () => ({
    applyPlan: (b) => calls.push(['applyPlan', b]),
    updateTask: (id, patch) => calls.push(['updateTask', id, patch]),
    addTask: (t) => calls.push(['addTask', t]),
  }) };
  const ui = { setPanel: (p) => calls.push(['panel', p]), openContext: (id) => calls.push(['context', id]) };
  assert.match(performAction({ type: 'block', taskId: 't1', title: 'Proposal', start: '10:00', end: '12:00', minutes: 120 }, store, ui), /Blocked 10:00–12:00/);
  assert.match(performAction({ type: 'move', taskIds: ['t1', 't2'], date: TOMORROW }, store, ui), /Moved 2 tasks to tomorrow/);
  performAction({ type: 'open', panel: 'tasks' }, store, ui);
  performAction({ type: 'context', id: 'note:n1' }, store, ui);
  assert.deepEqual(calls.map((c) => c[0]), ['applyPlan', 'updateTask', 'updateTask', 'panel', 'context']);
});
