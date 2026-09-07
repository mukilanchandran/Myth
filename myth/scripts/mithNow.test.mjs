// Unit tests for MITH NOW (src/ai/mithNow.js) — "What should I do now?"
// Run: npm test — plain node:test, no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  mithNow, currentWindow, nowText, estimateOf,
  emptyLearn, learnSkip, learnStart, learnFinish, learnSummary, BUFFER,
} from '../src/ai/mithNow.js';

const NOW = dayjs('2026-09-07T14:00:00'); // a Monday, 2 pm
const D = (n) => NOW.add(n, 'day').format('YYYY-MM-DD');
const TODAY = D(0);

let seq = 0;
const task = (over = {}) => ({
  id: `t${++seq}`, title: `Task ${seq}`, status: 'todo', priority: 3, due: null,
  estimate: null, completedAt: null, projectId: null, ...over,
});
const event = (over = {}) => ({ id: `e${++seq}`, title: `Event ${seq}`, date: TODAY, time: null, kind: 'event', yearly: false, ...over });
const base = (over = {}) => ({ tasks: [], events: [], notes: [], habits: [], plans: {}, projects: [], drive: [], files: [], ...over });

test('the window is measured to the next timed event, minus a buffer', () => {
  const state = base({ events: [event({ title: 'Design review', time: '14:50', kind: 'meeting' })] });
  const w = currentWindow(state, NOW);
  assert.equal(w.kind, 'meeting');
  assert.equal(w.minutes, 50 - BUFFER);
  assert.equal(w.next.title, 'Design review');
  assert.equal(w.next.inMin, 50);
});

test('with nothing on the clock the window runs to the end of the working day', () => {
  const w = currentWindow(base(), NOW);
  assert.equal(w.kind, 'day');
  assert.equal(w.minutes, 7 * 60); // 14:00 → 21:00
  assert.equal(currentWindow(base(), NOW.hour(22)).kind, 'night');
});

test('inside an event the window starts when it ends', () => {
  const state = base({ events: [event({ title: 'Standup', time: '13:45', end: '14:15' }), event({ title: 'Client call', time: '15:00', kind: 'meeting' })] });
  const w = currentWindow(state, NOW);
  assert.equal(w.inside.title, 'Standup');
  assert.equal(w.inside.endsAt, '14:15');
  assert.equal(w.minutes, 45 - BUFFER);
  assert.match(mithNow(state, NOW).headline, /in "Standup" until 14:15/);
});

test('best use of the time: the most urgent task that fits, then quick wins for the rest', () => {
  const state = base({
    projects: [{ id: 'px', name: 'Project X' }],
    tasks: [
      task({ title: 'Finish Project X task', projectId: 'px', priority: 4, due: TODAY, estimate: 35 }),
      task({ title: 'Big research piece', priority: 5, estimate: 120 }),        // does not fit in 47 min
      task({ title: 'Reply to 2 pending messages', priority: 2, estimate: 10 }),
      task({ title: 'Book dentist', priority: 3, estimate: 15 }),
    ],
    events: [event({ title: 'Team sync', time: '14:50', kind: 'meeting' })],
  });
  const r = mithNow(state, NOW);
  assert.equal(r.window.minutes, 47);
  assert.equal(r.primary.title, 'Finish Project X task');
  assert.equal(r.primary.minutes, 35);
  assert.equal(r.primary.project, 'Project X');
  assert.equal(r.primary.partial, false);
  assert.equal(r.remaining, 12);
  assert.deepEqual(r.quick.map((q) => q.title), ['Reply to 2 pending messages']); // 15-min dentist no longer fits
  const text = nowText(r);
  assert.match(text, /You have 47 min before your next meeting/);
  assert.match(text, /→ Finish Project X task \(Project X\)/);
  assert.match(text, /Estimated: 35 min · due today/);
  assert.match(text, /12 minutes remaining/);
  assert.match(text, /Reply to 2 pending messages \(10 min\)/);
});

test('overdue beats priority; a task that is already in progress gets a boost', () => {
  const state = base({
    tasks: [
      task({ title: 'Shiny high priority', priority: 5, estimate: 30 }),
      task({ title: 'Late invoice', priority: 2, due: D(-2), estimate: 30 }),
    ],
  });
  const r = mithNow(state, NOW);
  assert.equal(r.primary.title, 'Late invoice');
  assert.equal(r.primary.why, '2 days overdue');

  const doing = base({ tasks: [task({ title: 'A', priority: 3, estimate: 30 }), task({ title: 'B (doing)', priority: 3, status: 'doing', estimate: 30 })] });
  assert.equal(mithNow(doing, NOW).primary.title, 'B (doing)');
});

test('when nothing fits the top task is offered as a partial sprint', () => {
  const state = base({
    tasks: [task({ title: 'Long thing', priority: 5, estimate: 120 })],
    events: [event({ title: 'Call', time: '14:40', kind: 'meeting' })],
  });
  const r = mithNow(state, NOW);
  assert.equal(r.primary.partial, true);
  assert.equal(r.primary.minutes, 37);
  assert.match(nowText(r), /Make a dent: 37 of ~120 min/);
});

test('a tiny window offers quick wins only; the night offers rest', () => {
  const state = base({
    tasks: [task({ title: 'Big', estimate: 60 }), task({ title: 'Tiny', estimate: 5 })],
    events: [event({ title: 'Call', time: '14:10', kind: 'meeting' })],
  });
  const r = mithNow(state, NOW); // 7 minutes
  assert.equal(r.primary, null);
  assert.deepEqual(r.quick.map((q) => q.title), ['Tiny']);
  assert.equal(r.mood, 'quick');

  const night = mithNow(state, NOW.hour(22));
  assert.equal(night.mood, 'night');
  assert.equal(night.primary, null);
});

test('skipped suggestions are excluded for the sitting and demoted afterwards', () => {
  const t1 = task({ title: 'First', priority: 4, estimate: 30 });
  const t2 = task({ title: 'Second', priority: 3, estimate: 30 });
  const state = base({ tasks: [t1, t2] });
  assert.equal(mithNow(state, NOW).primary.title, 'First');
  assert.equal(mithNow(state, NOW, { exclude: new Set([t1.id]) }).primary.title, 'Second');

  // learned: skipped today → demoted below the alternative even without the exclude set
  const learned = { ...state, nowLearn: learnSkip(emptyLearn(), t1, NOW) };
  assert.equal(mithNow(learned, NOW).primary.title, 'Second');
  // starting it again forgives the skip
  const forgiven = { ...state, nowLearn: learnStart(learned.nowLearn, t1, NOW) };
  assert.equal(mithNow(forgiven, NOW).primary.title, 'First');
});

test('projects worked at this hour before get a boost at this hour', () => {
  const a = task({ title: 'Alpha work', projectId: 'pa', priority: 3, estimate: 30 });
  const b = task({ title: 'Beta work', projectId: 'pb', priority: 3, estimate: 30 });
  const state = base({ projects: [{ id: 'pa', name: 'Alpha' }, { id: 'pb', name: 'Beta' }], tasks: [a, b] });
  assert.equal(mithNow(state, NOW).primary.title, 'Alpha work'); // tie → first listed

  let learn = emptyLearn();
  learn = learnStart(learn, b, NOW);
  learn = learnStart(learn, b, NOW.subtract(1, 'hour'));
  const r = mithNow({ ...state, nowLearn: learn }, NOW);
  assert.equal(r.primary.title, 'Beta work');
  assert.ok(r.primary.reasons.some((x) => /usually work on this project/.test(x)));
  assert.equal(learnSummary(learn).accepted, 2);
});

test('real durations calibrate the estimate for that priority', () => {
  const t = task({ priority: 4 });
  assert.equal(estimateOf(t, emptyLearn()), 60);
  let learn = learnFinish(emptyLearn(), t, 20);
  assert.equal(estimateOf(t, learn), 20);
  learn = learnFinish(learn, t, 40);       // ema: 20*0.7 + 40*0.3 = 26 → rounded to 25
  assert.equal(estimateOf(t, learn), 25);
  assert.equal(estimateOf(task({ priority: 4, estimate: 45 }), learn), 45); // explicit wins
  assert.equal(learn.finished, 2);
});

test('a preferred task (the model or Boss swapping the pick) becomes the primary', () => {
  const t1 = task({ title: 'Engine pick', priority: 5, estimate: 30 });
  const t2 = task({ title: 'Model pick', priority: 2, estimate: 30 });
  const state = base({ tasks: [t1, t2] });
  const r = mithNow(state, NOW, { prefer: t2.id });
  assert.equal(r.primary.title, 'Model pick');
  assert.ok(r.alternatives.some((a) => a.id === t1.id));
});

test("today's plan pills and open habits fill the leftover minutes", () => {
  const state = base({
    tasks: [task({ title: 'Main', priority: 4, estimate: 30 })],
    plans: { [TODAY]: [{ id: 'p1', text: 'Water the plants', done: false }, { id: 'p2', text: 'Done thing', done: true }] },
    habits: [{ id: 'h1', name: 'Read 20 min', log: {} }],
    events: [event({ title: 'Call', time: '15:00', kind: 'meeting' })],
  });
  const r = mithNow(state, NOW); // 57 min: 30 main + 27 left
  assert.equal(r.primary.title, 'Main');
  assert.deepEqual(r.quick.map((q) => [q.kind, q.title]), [['plan', 'Water the plants'], ['habit', 'Read 20 min']]);
});
