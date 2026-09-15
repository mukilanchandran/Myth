// Unit tests for the reminders engine (src/ai/reminders.js). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  parseReminder, detectRepeat, nextDate, completePatch, statusOf, groupReminders, describeWhen,
  reminderNotifications, suggestReminders, reminderRundown, snoozeOptions,
} from '../src/ai/reminders.js';

const NOW = dayjs('2026-09-15T10:00:00'); // a Tuesday, 10 am
const D = (n) => NOW.add(n, 'day').format('YYYY-MM-DD');
let seq = 0;
const rem = (over = {}) => ({ id: `r${++seq}`, title: `Reminder ${seq}`, note: '', date: D(0), time: null, repeat: 'none', category: 'personal', done: false, doneAt: null, snoozedUntil: null, timesDone: 0, ...over });

test('parseReminder pulls the title, date, time and category out of a sentence', () => {
  const r = parseReminder('remind me to call Ravi tomorrow at 5pm', NOW.toDate());
  assert.equal(r.title, 'Call Ravi');
  assert.equal(r.date, D(1));
  assert.equal(r.time, '17:00');
  assert.equal(r.repeat, 'none');
  assert.equal(r.category, 'people');
});

test('parseReminder understands repeats: every day, weekdays, every monday, every 1st', () => {
  assert.equal(parseReminder('water the plants every evening', NOW.toDate()).repeat, 'daily');
  assert.equal(parseReminder('water the plants every evening', NOW.toDate()).time, '18:00');
  assert.equal(parseReminder('standup every weekday 9:30', NOW.toDate()).repeat, 'weekdays');
  const mon = parseReminder('team sync every monday 10am', NOW.toDate());
  assert.equal(mon.repeat, 'weekly');
  assert.equal(dayjs(mon.date).day(), 1);
  assert.ok(dayjs(mon.date).isAfter(NOW));
  const rent = parseReminder('pay rent every 1st', NOW.toDate());
  assert.equal(rent.repeat, 'monthly');
  assert.equal(rent.date, '2026-10-01');
  assert.equal(rent.category, 'money');
  assert.equal(rent.title, 'Pay rent');
});

test('a bare time that already passed today rolls to tomorrow; a repeat said after its hour starts tomorrow', () => {
  assert.equal(parseReminder('take meds at 8am', NOW.toDate()).date, D(1));
  assert.equal(parseReminder('take meds at 8pm', NOW.toDate()).date, D(0));
  assert.equal(parseReminder('stretch every morning', NOW.toDate()).date, D(1));
});

test('detectRepeat strips the phrase and keeps the rest', () => {
  const r = detectRepeat('call mom every sunday evening');
  assert.equal(r.repeat, 'weekly');
  assert.equal(r.weekday, 0);
  assert.equal(r.rest, 'call mom evening');
});

test('nextDate advances a repeat past now and completePatch closes a one-off', () => {
  assert.equal(nextDate(rem({ date: D(0), time: '09:00', repeat: 'daily' }), NOW), D(1));
  assert.equal(nextDate(rem({ date: D(-3), time: '09:00', repeat: 'daily' }), NOW), D(1));
  assert.equal(nextDate(rem({ date: '2026-09-11', time: '09:00', repeat: 'weekdays' }), NOW), '2026-09-16');
  assert.equal(nextDate(rem({ date: '2026-09-18', time: '09:00', repeat: 'weekdays' }), NOW), '2026-09-21'); // Fri → Mon
  assert.equal(nextDate(rem({ date: '2026-09-01', repeat: 'monthly' }), NOW), '2026-10-01');
  const once = completePatch(rem(), NOW);
  assert.equal(once.done, true);
  const rep = completePatch(rem({ date: D(0), time: '09:00', repeat: 'weekly', timesDone: 2 }), NOW);
  assert.equal(rep.done, undefined);
  assert.equal(rep.date, D(7));
  assert.equal(rep.timesDone, 3);
});

test('statusOf and groupReminders sort reminders into the right sections', () => {
  const list = [
    rem({ title: 'Late', date: D(0), time: '08:00' }),
    rem({ title: 'Soon', date: D(0), time: '10:40' }),
    rem({ title: 'All day', date: D(0) }),
    rem({ title: 'Tmrw', date: D(1), time: '09:00' }),
    rem({ title: 'Week', date: D(4) }),
    rem({ title: 'Later', date: D(20) }),
    rem({ title: 'Snoozed', date: D(0), time: '08:00', snoozedUntil: NOW.add(2, 'hour').toISOString() }),
    rem({ title: 'Done', done: true, doneAt: NOW.subtract(1, 'day').toISOString() }),
    rem({ title: 'Yesterday all-day', date: D(-1) }),
  ];
  assert.equal(statusOf(list[0], NOW), 'overdue');
  assert.equal(statusOf(list[1], NOW), 'soon');
  assert.equal(statusOf(list[2], NOW), 'today');
  assert.equal(statusOf(list[6], NOW), 'snoozed');
  assert.equal(statusOf(list[8], NOW), 'overdue');
  const g = groupReminders(list, NOW);
  assert.deepEqual(g.overdue.map((r) => r.title), ['Yesterday all-day', 'Late']);
  assert.deepEqual(g.today.map((r) => r.title), ['All day', 'Soon', 'Snoozed']);
  assert.deepEqual(g.tomorrow.map((r) => r.title), ['Tmrw']);
  assert.deepEqual(g.week.map((r) => r.title), ['Week']);
  assert.deepEqual(g.later.map((r) => r.title), ['Later']);
  assert.deepEqual(g.done.map((r) => r.title), ['Done']);
  assert.equal(describeWhen(list[0], NOW), 'Overdue by 2h');
  assert.equal(describeWhen(list[1], NOW), 'In 40 min');
  assert.equal(describeWhen(list[3], NOW), 'Tomorrow 09:00');
});

test('reminderNotifications fires at the time (exempt from windows), warns 30 min before, and sums up the morning', () => {
  const state = { reminders: [
    rem({ title: 'Call Ravi', date: D(0), time: '10:00' }),
    rem({ title: 'Lunch order', date: D(0), time: '10:25' }),
    rem({ title: 'Evening walk', date: D(0), time: '18:00' }),
    rem({ title: 'Someday', date: D(9) }),
  ] };
  const out = reminderNotifications(state, NOW);
  const due = out.find((n) => n.key.startsWith('reminder:'));
  assert.equal(due.headline, '⏰ Call Ravi');
  assert.equal(due.level, 'act');
  assert.equal(due.exempt, true);
  assert.equal(due.action.type, 'reminderDone');
  const soon = out.find((n) => n.key.startsWith('reminder-soon:'));
  assert.equal(soon.headline, 'Lunch order in 25 min.');
  const morning = out.find((n) => n.key.startsWith('reminders-today:'));
  assert.equal(morning.headline, '2 reminders today.');
});

test('suggestReminders proposes heads-ups for meetings, due tasks, bills and birthdays, skipping what exists', () => {
  const state = {
    reminders: [rem({ title: 'Pay electricity bill', date: D(1) })],
    tasks: [{ id: 't1', title: 'Send proposal', status: 'todo', priority: 4, due: D(1) }],
    events: [
      { id: 'e1', title: 'Client review', kind: 'meeting', date: D(0), time: '15:00' },
      { id: 'e2', title: 'Electricity', kind: 'bill', date: D(1) },
      { id: 'e3', title: "Priya's birthday", kind: 'birthday', yearly: true, date: '2000-09-16' },
    ],
  };
  const s = suggestReminders(state, NOW);
  assert.deepEqual(s.map((x) => x.title), ['Client review — get ready', 'Send proposal', 'Wish Priya']);
  assert.equal(s[0].time, '14:30');
  assert.equal(s[2].date, D(1));
});

test('reminderRundown and snoozeOptions read naturally', () => {
  assert.match(reminderRundown({ reminders: [rem({ title: 'Call Ravi', date: D(0), time: '17:00' })] }, NOW), /Today \(1\):\n• Call Ravi — Today 17:00/);
  assert.equal(reminderRundown({ reminders: [] }, NOW), 'No reminders set. Say "remind me to …" and I will set one.');
  const opts = snoozeOptions(NOW);
  assert.equal(opts[0].label, '10 minutes');
  assert.equal(dayjs(opts.find((o) => o.key === 'nextweek').until).day(), 1);
});
