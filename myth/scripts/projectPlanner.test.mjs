// Unit tests for automatic project creation (src/ai/projectPlanner.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  detectProjectIntent, extractDeadline, buildPlan, createProjectFromPlan, normalizeAiPlan, TEMPLATES,
} from '../src/ai/projectPlanner.js';

const NOW = dayjs('2026-09-07T14:00:00'); // a Monday in September

test('extractDeadline reads project-style horizons the way people mean them', () => {
  assert.equal(extractDeadline('launch it next month', NOW).deadline, '2026-10-31');
  assert.equal(extractDeadline('finish the book by end of year', NOW).deadline, '2026-12-31');
  assert.equal(extractDeadline("organize my sister's wedding in December", NOW).deadline, '2026-12-31');
  assert.equal(extractDeadline('build a mobile app in 6 weeks', NOW).deadline, '2026-10-19');
  assert.equal(extractDeadline('launch the campaign by Oct 15', NOW).deadline, '2026-10-15');
  assert.equal(extractDeadline('start a bakery this year', NOW).deadline, '2026-12-31');
  assert.equal(extractDeadline('redesign the dashboard', NOW).deadline, null);
});

test('the example sentence becomes a Portfolio Website project due end of next month', () => {
  const intent = detectProjectIntent('I need to launch my portfolio website next month.', NOW);
  assert.ok(intent);
  assert.equal(intent.name, 'Portfolio Website');
  assert.equal(intent.template, 'website');
  assert.equal(intent.deadline, '2026-10-31');
  assert.equal(intent.deadlineGuessed, false);
  assert.ok(intent.confidence >= 0.9);
});

test('other undertakings pick the right template and name', () => {
  const cases = [
    ["Organize my sister's wedding in December", 'event', "Sister's Wedding"],
    ['I want to start a bakery this year', 'business', 'Bakery'],
    ['plan a trip to Goa in November', 'travel', 'Trip to Goa'],
    ['I need to renovate the kitchen by end of year', 'home', 'Kitchen'],
    ['I want to write a book about design systems', 'content', 'Book About Design Systems'],
    ['I need to get a new job by December', 'career', 'New Job'],
    ['I want to learn Spanish in 3 months', 'learning', 'Spanish'],
    ['run a half marathon in March', 'fitness', 'Half Marathon'],
    ['new project: Acme dashboard redesign', 'website', 'Acme Dashboard Redesign'],
    ['project: bakery', 'business', 'Bakery'],
  ];
  for (const [text, template, name] of cases) {
    const intent = detectProjectIntent(text, NOW);
    assert.ok(intent, `expected a project for: ${text}`);
    assert.equal(intent.template, template, text);
    assert.equal(intent.name, name, text);
  }
});

test('ordinary captures are left alone', () => {
  const notProjects = [
    'I need to buy milk tomorrow',
    'Renew insurance by friday urgent',
    'What should I do today?',
    'spent 250 on lunch',
    'habit: morning walk',
    'I want to build a habit of reading daily',
    'I need to finish the report by Friday',
    'I have to create a design review deck by Friday',
    'learn Spanish',
    'Design review with client tomorrow 3pm',
    'idea: dark mode for reports',
    'call the vendor about the quote',
  ];
  for (const text of notProjects) assert.equal(detectProjectIntent(text, NOW), null, `should not be a project: ${text}`);
});

test('without a date the template horizon is assumed and flagged', () => {
  const intent = detectProjectIntent('I need to launch my portfolio website', NOW);
  assert.equal(intent.deadlineGuessed, true);
  assert.equal(intent.deadline, NOW.add(TEMPLATES.website.horizonWeeks, 'week').format('YYYY-MM-DD'));
});

test('buildPlan schedules milestones and tasks across the runway in order', () => {
  const intent = detectProjectIntent('I need to launch my portfolio website next month', NOW);
  const plan = buildPlan(intent, NOW);
  assert.equal(plan.name, 'Portfolio Website');
  assert.deepEqual(plan.milestones.map((m) => m.title), ['Research', 'Content', 'Design', 'Development', 'Testing', 'Launch']);
  assert.ok(plan.taskCount >= 18 && plan.taskCount <= 30, `task count ${plan.taskCount}`);
  assert.equal(plan.milestones.at(-1).due, '2026-10-31');
  const dues = plan.milestones.flatMap((m) => m.tasks.map((t) => t.due));
  for (let i = 1; i < dues.length; i++) assert.ok(dues[i] >= dues[i - 1], 'task due dates never go backwards');
  assert.ok(dues[0] > NOW.format('YYYY-MM-DD'));
  assert.ok(dues.at(-1) <= '2026-10-31');
  assert.match(plan.milestones[5].tasks[2].title, /Announce Portfolio Website/);
  assert.equal(plan.milestones[0].tasks[0].id, 't0.0');
});

test('a shorter deadline compresses the same plan; overrides rename and reschedule', () => {
  const intent = detectProjectIntent('I need to launch my portfolio website next month', NOW);
  const plan = buildPlan(intent, NOW, { name: 'Folio', deadline: NOW.add(10, 'day').format('YYYY-MM-DD') });
  assert.equal(plan.name, 'Folio');
  assert.equal(plan.milestones.at(-1).due, NOW.add(10, 'day').format('YYYY-MM-DD'));
  assert.match(plan.milestones[5].tasks[2].title, /Announce Folio/);
});

test('normalizeAiPlan accepts a sane model answer and rejects junk', () => {
  const good = normalizeAiPlan({
    milestones: [
      { title: 'Research', tasks: ['Look at 5 portfolios', 'List pages'] },
      { title: 'Build', tasks: ['Set up Astro', 'Write pages', 'Add projects'] },
      { title: 'Launch', tasks: ['Buy domain', 'Deploy'] },
    ],
  });
  assert.equal(good.length, 3);
  assert.equal(good.at(-1).weight, 0.5);
  assert.equal(normalizeAiPlan({ milestones: [{ title: 'Only one', tasks: ['a', 'b'] }] }), null);
  assert.equal(normalizeAiPlan({ milestones: [{ title: 'x', tasks: ['one'] }, { title: 'Two', tasks: ['a', 'b'] }, { title: 'Three', tasks: ['a', 'b'] }] }), null);
  assert.equal(normalizeAiPlan('nope'), null);
  const tooMany = { milestones: Array.from({ length: 6 }, (_, i) => ({ title: `M${i}`, tasks: ['t1', 't2', 't3', 't4', 't5', 't6'] })) };
  assert.equal(normalizeAiPlan(tooMany), null);
});

test('createProjectFromPlan writes the project, milestones and only the selected tasks', () => {
  const store = { projects: [], tasks: [], xp: 0 };
  store.addProject = (p) => { const proj = { id: `p${store.projects.length + 1}`, ...p }; store.projects.push(proj); return proj; };
  store.addTask = (t) => store.tasks.unshift({ id: `t${store.tasks.length + 1}`, status: 'todo', ...t });
  store.addXp = () => { store.xp += 1; };

  const intent = detectProjectIntent('I need to launch my portfolio website next month', NOW);
  const plan = buildPlan(intent, NOW);
  const skip = new Set([plan.milestones[0].tasks[0].id, plan.milestones[0].tasks[1].id]);
  const selected = new Set(plan.milestones.flatMap((m) => m.tasks.map((t) => t.id)).filter((id) => !skip.has(id)));
  const res = createProjectFromPlan(plan, store, selected);

  assert.equal(res.taskCount, plan.taskCount - 2);
  assert.equal(res.milestoneCount, 6);
  const project = store.projects[0];
  assert.equal(project.name, 'Portfolio Website');
  assert.equal(project.deadline, '2026-10-31');
  assert.equal(project.milestones.length, 6);
  assert.ok(project.milestones.every((m) => m.done === false && m.due));
  assert.ok(store.tasks.every((t) => t.projectId === project.id && t.tags.includes('plan')));
  const milestoneIds = new Set(project.milestones.map((m) => m.id));
  assert.ok(store.tasks.every((t) => milestoneIds.has(t.milestoneId)), 'every task points at a real milestone id');
  // addTask prepends, so the earliest task ends up first in the list
  assert.equal(store.tasks[0].title, plan.milestones[0].tasks[2].title);
  assert.equal(store.xp, 1);
});
