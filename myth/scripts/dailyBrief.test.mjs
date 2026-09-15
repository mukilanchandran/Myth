// Unit tests for the Myth Daily Brief (src/ai/dailyBrief.js). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { dailyBrief, briefText, todayCounts, projectsBehind, problemOf, personalOf, learningOf, scheduleOf } from '../src/ai/dailyBrief.js';
import { commandCenter } from '../src/ai/commandCenter.js';

const NOW = dayjs('2026-09-15T08:30:00'); // a Tuesday morning
const D = (n) => NOW.add(n, 'day').format('YYYY-MM-DD');
const TODAY = D(0);
let seq = 0;
const task = (over = {}) => ({ id: `t${++seq}`, title: `Task ${seq}`, status: 'todo', priority: 3, due: null, estimate: null, projectId: null, ...over });
const event = (over = {}) => ({ id: `e${++seq}`, title: `Event ${seq}`, date: TODAY, time: null, kind: 'event', yearly: false, ...over });
const base = (over = {}) => ({ tasks: [], events: [], notes: [], habits: [], plans: {}, projects: [], transactions: [], learning: [], reminders: [], settings: { name: 'Mukil' }, ...over });

test('todayCounts reads tasks, meetings and deadlines into one line', () => {
  const state = base({
    tasks: [task({ due: TODAY }), task({ due: D(-1) }), task({ due: D(3) }), task({ due: TODAY, priority: 5 })],
    events: [event({ kind: 'meeting', time: '11:00' }), event({ kind: 'meeting', time: '15:00' })],
    projects: [{ id: 'p1', name: 'Project X', status: 'active', deadline: D(1), milestones: [] }],
  });
  const c = todayCounts(state, NOW);
  assert.equal(c.tasks, 3);
  assert.equal(c.meetings, 2);
  assert.equal(c.deadlines, 2); // the project due tomorrow + the priority-5 task due today
  assert.equal(c.line, '3 tasks · 2 meetings · 2 deadlines');
  assert.equal(todayCounts(base(), NOW).line, 'A clear day — nothing due, nothing on the clock.');
});

test('projectsBehind measures progress against the calendar and slipped milestones', () => {
  const created = NOW.subtract(10, 'day').toISOString();
  const state = base({
    projects: [
      { id: 'p1', name: 'Project X', status: 'active', deadline: D(10), created, milestones: [] },
      { id: 'p2', name: 'Site', status: 'active', deadline: D(30), created, milestones: [{ id: 'm1', title: 'Wireframes', due: D(-3), done: false }] },
    ],
    tasks: [
      task({ projectId: 'p1', status: 'done' }), task({ projectId: 'p1' }), task({ projectId: 'p1' }), task({ projectId: 'p1' }), task({ projectId: 'p1' }),
    ],
  });
  const behind = projectsBehind(state, NOW);
  // p1: 10 of 20 days gone (50% expected), 1 of 5 tasks done (20%) → 6 days behind
  assert.deepEqual(behind.map((b) => [b.name, b.days]), [['Project X', 6], ['Site', 3]]);
  assert.equal(behind[1].text, 'Site is 3 days behind — "Wireframes" slipped.');
  const p = problemOf(state, commandCenter(state, NOW), NOW);
  assert.equal(p.text, 'Project X is 6 days behind.');
});

test('problemOf falls back to overdue tasks, then to "nothing is slipping"', () => {
  const state = base({ tasks: [task({ title: 'Send invoice', due: D(-2) }), task({ title: 'Call bank', due: D(-1) })] });
  const p = problemOf(state, commandCenter(state, NOW), NOW);
  assert.equal(p.text, '2 tasks overdue — the oldest is "Send invoice" (2 days overdue).');
  assert.equal(problemOf(base(), commandCenter(base(), NOW), NOW).text, 'Nothing is slipping.');
});

test('personalOf reads bills, birthdays and personal reminders; habits are the fallback', () => {
  const state = base({
    events: [event({ title: 'Electricity bill', kind: 'bill', date: D(1) }), event({ title: "Priya's birthday", kind: 'birthday', yearly: true, date: '2000-09-15' })],
  });
  assert.equal(personalOf(state, NOW).text, "Electricity bill due tomorrow. Priya's birthday today.");
  const withReminder = base({ reminders: [{ id: 'r1', title: 'Take the tablets', date: TODAY, time: '09:00', repeat: 'daily', category: 'health', done: false }] });
  assert.equal(personalOf(withReminder, NOW).text, 'Take the tablets at 09:00.');
  const habits = base({ habits: [{ id: 'h1', name: 'Read', log: {} }, { id: 'h2', name: 'Run', log: { [TODAY]: true } }] });
  assert.equal(personalOf(habits, NOW).text, '1 habit to tick — Read.');
  assert.equal(personalOf(base(), NOW).text, 'Nothing personal on the list.');
});

test('learningOf prefers what is being learned now', () => {
  assert.equal(learningOf(base({ learning: [{ id: 'l1', title: 'React', stage: 1 }, { id: 'l2', title: 'Spanish', stage: 0 }] })).text, '30 min React practice.');
  assert.equal(learningOf(base({ learning: [{ id: 'l2', title: 'Spanish', stage: 0 }] })).text, 'Start Spanish — 30 min to begin.');
  assert.match(learningOf(base()).text, /Nothing in the pipeline/);
});

test('scheduleOf merges meetings, focus blocks and anchors in clock order', () => {
  const state = base({
    tasks: [task({ title: 'Finish homepage design', due: TODAY, estimate: 90, priority: 4 })],
    events: [event({ title: 'Client sync', kind: 'meeting', time: '11:00', end: '11:45' })],
  });
  const cc = commandCenter(state, NOW);
  const focus = { text: 'Finish homepage design.', ref: { type: 'task', id: 't1' } };
  const s = scheduleOf(state, cc, focus, NOW);
  const times = s.map((x) => x.time);
  assert.ok(times.includes('11:00'), `meeting missing: ${times}`);
  assert.equal(s.find((x) => x.time === '11:00').label, 'Client sync');
  assert.ok(s.some((x) => /Deep work — Finish homepage design/.test(x.label)), `no deep-work block: ${s.map((x) => x.label)}`);
  assert.ok(s.some((x) => x.label === 'Admin & inbox'));
  assert.deepEqual(times, [...times].sort());
});

test('dailyBrief composes the card and briefText reads like the spec', () => {
  const state = base({
    tasks: [task({ title: 'Finish homepage design', due: TODAY, estimate: 90, priority: 5 })],
    events: [event({ title: 'Design review', kind: 'meeting', time: '11:00' }), event({ title: 'Electricity bill', kind: 'bill', date: D(1) })],
    learning: [{ id: 'l1', title: 'React', stage: 1 }],
  });
  const b = dailyBrief(state, NOW);
  assert.equal(b.greeting, 'Good morning, Mukil.');
  assert.equal(b.today.line, '1 task · 1 meeting · 1 deadline');
  assert.equal(b.focus.text, 'Finish homepage design.');
  assert.equal(b.personal.text, 'Electricity bill due tomorrow.');
  assert.equal(b.learning.text, '30 min React practice.');
  const text = briefText(b);
  assert.match(text, /^Good morning, Mukil\.\n\nToday — 1 task · 1 meeting · 1 deadline\nYour focus — Finish homepage design\./);
  assert.match(text, /Suggested schedule\n\d\d:\d\d → /);
});
