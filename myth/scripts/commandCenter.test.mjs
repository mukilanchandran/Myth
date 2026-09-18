// Unit tests for the Life Command Center logic (src/ai/commandCenter.js).
// Run: npm test — plain node:test, no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  dayProgress, attentionItems, timeline, freeWindows, suggestPlan, activePlan, fmtDuration, greeting,
} from '../src/ai/commandCenter.js';

const NOW = dayjs('2026-09-07T14:00:00'); // a Monday, 2 pm
const D = (n) => NOW.add(n, 'day').format('YYYY-MM-DD');
const TODAY = D(0);

let seq = 0;
const task = (over = {}) => ({
  id: `t${++seq}`, title: `Task ${seq}`, status: 'todo', priority: 3, due: null,
  estimate: null, completedAt: null, projectId: null, ...over,
});
const event = (over = {}) => ({ id: `e${++seq}`, title: `Event ${seq}`, date: TODAY, time: null, kind: 'event', yearly: false, ...over });
const base = (over = {}) => ({ tasks: [], events: [], notes: [], habits: [], plans: {}, projects: [], ...over });

test('fmtDuration reads like a person would say it', () => {
  assert.equal(fmtDuration(150), '2.5 hours');
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtDuration(60), '1 hour');
  assert.equal(fmtDuration(95), '1h 35m');
  assert.equal(fmtDuration(0), '0 min');
});

test('greeting follows the clock', () => {
  assert.equal(greeting(NOW), 'Good afternoon');
  assert.equal(greeting(NOW.hour(8)), 'Good morning');
  assert.equal(greeting(NOW.hour(19)), 'Good evening');
});

test('dayProgress counts commitments and falls back to the time of day', () => {
  const state = base({
    tasks: [
      task({ due: TODAY, status: 'done', completedAt: NOW.subtract(1, 'hour').toISOString() }),
      task({ due: TODAY }),
    ],
    habits: [{ id: 'h1', name: 'Water', log: { [TODAY]: true } }, { id: 'h2', name: 'Read', log: {} }],
    events: [event({ time: '09:30' })], // already behind us
  });
  const p = dayProgress(state, NOW);
  assert.deepEqual({ done: p.done, total: p.total, pct: p.pct }, { done: 3, total: 5, pct: 60 });

  const empty = dayProgress(base(), NOW);
  assert.equal(empty.total, 0);
  assert.equal(empty.pct, 46); // 14:00 is 46% of the 08:00–21:00 day
});

test('a plan pill that mirrors a task is not counted twice', () => {
  const state = base({
    tasks: [task({ title: 'Submit proposal', due: TODAY })],
    plans: { [TODAY]: [{ id: 'p1', text: 'submit proposal', done: false }, { id: 'p2', text: 'Call vendor', done: true }] },
  });
  const p = dayProgress(state, NOW);
  assert.equal(p.total, 2);
  assert.equal(p.done, 1);
});

test('a followed plan counts each task once: focus block + mirrored pill = one commitment', () => {
  const t = task({ title: 'Wireframes', due: D(3), status: 'doing' }); // not due today — the block is its only mention
  const state = base({
    tasks: [t],
    events: [event({ title: 'Wireframes', time: '16:00', end: '17:00', kind: 'focus', taskId: t.id })],
    plans: { [TODAY]: [{ id: 'p1', text: 'Wireframes', done: false }] },
  });
  const p = dayProgress(state, NOW);
  assert.deepEqual({ done: p.done, total: p.total }, { done: 0, total: 1 });
  const finished = dayProgress({ ...state, tasks: [{ ...t, status: 'done', completedAt: NOW.toISOString() }] }, NOW);
  assert.deepEqual({ done: finished.done, total: finished.total }, { done: 1, total: 1 });
});

test('attentionItems ranks overdue first, then due today, then upcoming events', () => {
  const state = base({
    tasks: [
      task({ title: 'Expense report', due: D(-3) }),
      task({ title: 'Submit proposal', due: TODAY, priority: 5 }),
      task({ title: 'Later thing', due: D(4) }),
    ],
    events: [event({ title: 'Client meeting', time: '14:30', kind: 'meeting' })],
  });
  const items = attentionItems(state, NOW);
  assert.deepEqual(items.map((i) => i.title), ['Expense report', 'Submit proposal', 'Client meeting']);
  assert.equal(items[0].sub, '3 days overdue');
  assert.equal(items[2].sub, 'starts in 30 min');
});

test('open habits only surface in the evening', () => {
  const state = base({ habits: [{ id: 'h1', name: 'Gym', log: {} }] });
  assert.equal(attentionItems(state, NOW).length, 0);
  const evening = attentionItems(state, NOW.hour(19));
  assert.equal(evening.length, 1);
  assert.equal(evening[0].kind, 'habits');
  assert.deepEqual(evening[0].ref.ids, ['h1']);
});

test('project deadlines with open tasks show up within three days', () => {
  const state = base({
    projects: [{ id: 'p1', name: 'GIS Project', status: 'active', deadline: D(2) }],
    tasks: [task({ projectId: 'p1' })],
  });
  const [item] = attentionItems(state, NOW);
  assert.equal(item.kind, 'deadline');
  assert.equal(item.sub, '1 open task · deadline in 2 days');
});

test('timeline marks past / now / next and drops a meeting note that duplicates its event', () => {
  const state = base({
    events: [
      event({ title: 'Standup', time: '09:30', kind: 'meeting' }),
      event({ title: 'Lunch', time: '13:30' }),
      event({ title: 'Review', time: '15:30', kind: 'meeting' }),
      event({ title: 'Gym', time: '18:30' }),
      event({ title: 'Pay rent', kind: 'bill' }),
    ],
  });
  const rows = timeline(state, NOW);
  assert.deepEqual(rows.map((r) => [r.title, r.status]), [
    ['Pay rent', 'allday'], ['Standup', 'past'], ['Lunch', 'now'], ['Review', 'next'], ['Gym', 'later'],
  ]);
});

test('freeWindows removes busy slots and stops at the end of the day', () => {
  const state = base({ events: [event({ time: '15:00', kind: 'meeting' }), event({ time: '18:30', end: '19:30' })] });
  assert.deepEqual(freeWindows(state, NOW), [[840, 900], [960, 1110], [1170, 1260]]);
  assert.deepEqual(freeWindows(state, NOW.hour(21).minute(30)), []);
});

test('suggestPlan clears the overdue task first and fits blocks around the meeting', () => {
  const state = base({
    tasks: [
      task({ title: 'Expense report', due: D(-3), priority: 4 }), // 60 min
      task({ title: 'Submit proposal', due: TODAY, priority: 3 }), // 45 min
      task({ title: 'Someday', priority: 1 }),
    ],
    events: [event({ title: 'Client meeting', time: '15:00', kind: 'meeting' })],
  });
  const plan = suggestPlan(state, NOW);
  assert.equal(plan.kind, 'overdue');
  assert.equal(plan.focusMinutes, 360);
  assert.deepEqual(plan.blocks.map((b) => [b.title, b.start, b.end]), [
    ['Expense report', '14:00', '15:00'],
    ['Submit proposal', '16:00', '16:45'],
    ['Someday', '16:50', '17:20'],
  ]);
  assert.match(plan.message, /6 hours of focused time/);
  assert.match(plan.message, /"Expense report" first — it's 3 days overdue — then move to "Submit proposal"/);
});

test('suggestPlan proposes a sprint before an imminent meeting', () => {
  const state = base({
    tasks: [task({ title: 'Submit proposal', due: TODAY })],
    events: [event({ title: 'Client meeting', time: '14:30', kind: 'meeting' })],
  });
  const plan = suggestPlan(state, NOW);
  assert.equal(plan.kind, 'meeting-first');
  assert.equal(plan.blocks[0].minutes, 30);
  assert.match(plan.message, /"Client meeting" starts in 30 min\. A 30-minute sprint on "Submit proposal" fits before it/);
});

test('suggestPlan explains a clear plate and a finished day', () => {
  assert.equal(suggestPlan(base(), NOW).kind, 'clear');
  const late = suggestPlan(base({ habits: [{ id: 'h', name: 'Read', log: {} }] }), NOW.hour(21).minute(30));
  assert.equal(late.kind, 'winddown');
  assert.match(late.message, /1 habit still open — Read/);
});

test('tasks with a focus block still ahead are not planned again; activePlan tracks them', () => {
  const t = task({ title: 'Proposal', due: TODAY, status: 'doing' });
  const state = base({
    tasks: [t, task({ title: 'Other', priority: 4 })],
    events: [event({ title: 'Proposal', time: '13:30', end: '14:30', kind: 'focus', taskId: t.id })],
  });
  const plan = suggestPlan(state, NOW);
  assert.deepEqual(plan.blocks.map((b) => b.title), ['Other']);
  assert.equal(plan.blocks[0].start, '14:30');

  const active = activePlan(state, NOW);
  assert.equal(active.total, 1);
  assert.equal(active.remaining, 1);
  assert.equal(active.current.title, 'Proposal');
  assert.equal(active.next, null);
});
