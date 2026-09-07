// Unit tests for the Life Context Graph (src/ai/context.js) and the meeting
// capture that feeds it. Run: npm test — plain node:test, no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  tokens, extractPeople, buildGraph, contextFor, actionItems, setActionItemDone, upcomingMeetingContexts,
  followUpsNeeded, nextBriefing, briefingText, contextSummary, createFollowUpTask, actionItemsToTasks, addTravelPlan,
} from '../src/ai/context.js';
import { parseCapture } from '../src/ai/parser.js';

const D = (n) => dayjs().add(n, 'day').format('YYYY-MM-DD');
const base = (over = {}) => ({ projects: [], tasks: [], notes: [], events: [], files: [], drive: [], plans: {}, ...over });

// A client thread: an old meeting with open action items, the next one tomorrow,
// project tasks, a related note and a Drive link tagged with the project name.
function scenario(over = {}) {
  return base({
    projects: [{ id: 'p1', name: 'Client Dashboard Redesign', desc: 'SaaS analytics dashboard UX revamp', status: 'active' }],
    tasks: [
      { id: 't1', title: 'Competitor analysis — 3 dashboards', status: 'todo', priority: 3, due: D(3), projectId: 'p1' },
      { id: 't2', title: 'Prepare design review deck', status: 'todo', priority: 4, due: D(1), projectId: 'p1' },
      { id: 't3', title: 'Kickoff slides', status: 'done', priority: 2, due: D(-5), projectId: 'p1', completedAt: new Date().toISOString() },
      { id: 't4', title: 'Renew bike insurance', status: 'todo', priority: 5, due: D(6), projectId: null },
    ],
    notes: [
      { id: 'n1', title: 'Client review — dashboard v1', type: 'meeting', projectId: 'p1', body: '',
        meeting: { date: D(-9), time: '11:00', participants: 'Ravi (Acme), Priya (PM), Me', location: 'Acme office', agenda: '', actions: '[x] Send recap\nShare moodboard\nCollect KPI list' } },
      { id: 'n2', title: 'Client meeting — dashboard v2 walkthrough', type: 'meeting', projectId: 'p1', body: '',
        meeting: { date: D(1), time: '10:00', participants: 'Ravi (Acme), Me', location: 'Acme office, Guindy', agenda: '', actions: '' } },
      { id: 'n3', title: 'Acme dashboard — export options', type: 'note', projectId: 'p1', body: 'PDF vs CSV' },
      { id: 'n4', title: 'Weekend trip — Ooty?', type: 'idea', projectId: null, body: '' },
    ],
    events: [{ id: 'e1', title: 'Client meeting — dashboard v2 walkthrough', date: D(1), time: '10:00', kind: 'meeting' }],
    drive: [{ id: 'd1', kind: 'link', title: 'Client dashboard — Figma v2', url: 'https://example.com/figma', tags: ['client dashboard redesign'] }],
    ...over,
  });
}

// A minimal store double: records what the prep actions write.
function fakeStore(state) {
  const s = {
    ...state,
    added: [], plansAdded: [],
    addTask: (t) => { s.added.push(t); s.tasks = [...s.tasks, { id: `new${s.added.length}`, status: 'todo', ...t }]; },
    addNote: (n) => { const note = { id: `note${s.added.length}`, ...n }; s.notes = [...s.notes, note]; return note; },
    addPlanItems: (texts, date) => s.plansAdded.push({ texts, date }),
    updateNote: (id, patch) => { s.notes = s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)); },
  };
  return { getState: () => s };
}

test('tokens keeps the words that carry meaning', () => {
  assert.deepEqual(tokens('Client meeting with the product team tomorrow'), ['client', 'product', 'team']);
  assert.deepEqual(tokens('v2 walkthrough at 10'), ['walkthrough']);
});

test('extractPeople reads participants and "with <Name>" phrasing, skipping roles', () => {
  const names = (list) => list.map((p) => p.name);
  assert.deepEqual(names(extractPeople('', 'Ravi (Acme), Priya (PM), Me')), ['Ravi', 'Priya']);
  assert.deepEqual(names(extractPeople('Coffee with Arun about the launch')), ['Arun']);
  assert.deepEqual(names(extractPeople("Amma's birthday")), ['Amma']);
  assert.deepEqual(names(extractPeople('Sprint kickoff with product team', 'PM, Dev lead, Me')), []);
});

test('buildGraph links project members, people, schedule and tagged documents', () => {
  const g = buildGraph(scenario());
  const edge = (a, b) => g.adj.get(a)?.get(b)?.type;
  assert.equal(edge('task:t1', 'project:p1'), 'in_project');
  assert.equal(edge('note:n2', 'person:ravi'), 'mentions');
  assert.equal(edge('note:n1', 'person:ravi'), 'mentions');
  assert.equal(edge('note:n2', 'event:e1'), 'scheduled');
  assert.equal(edge('drive:d1', 'project:p1'), 'about');
  assert.ok(g.stats.people >= 2);
});

test("contextFor explains tomorrow's client meeting through everything linked to it", () => {
  const ctx = contextFor(scenario(), 'note:n2');
  assert.equal(ctx.project.name, 'Client Dashboard Redesign');
  assert.deepEqual(ctx.openTasks.map((r) => r.node.label), ['Prepare design review deck', 'Competitor analysis — 3 dashboards']);
  assert.equal(ctx.doneTasks.length, 1);
  assert.deepEqual(ctx.documents.map((r) => r.node.label), ['Client dashboard — Figma v2']);
  assert.deepEqual(ctx.notes.map((r) => r.node.label), ['Acme dashboard — export options']);
  assert.deepEqual(ctx.previousMeetings.map((r) => r.node.label), ['Client review — dashboard v1']);
  assert.deepEqual(ctx.unresolvedActions.map((a) => a.text), ['Share moodboard', 'Collect KPI list']);
  assert.ok(ctx.people.some((p) => p.label === 'Ravi'));
  assert.equal(ctx.when.rel, 'Tomorrow');
  assert.deepEqual(ctx.travel, { mode: 'onsite', leaveBy: '09:20', minutes: 40, location: 'Acme office, Guindy' });
  assert.equal(ctx.followUpTask, null);

  const text = briefingText(ctx);
  assert.match(text, /^Tomorrow's Client meeting — dashboard v2 walkthrough \(10:00\)/);
  assert.match(text, /2 open tasks related to "Client Dashboard Redesign"/);
  assert.match(text, /1 document was referenced previously: Client dashboard — Figma v2/);
  assert.match(text, /left 2 unresolved action items/);
  assert.match(text, /Leave by 09:20/);
  assert.equal(contextSummary(ctx), 'linked to Client Dashboard Redesign · 2 open tasks · 1 doc · 2 unresolved actions · leave by 09:20');
});

test('a person node shows their history; an unrelated idea shows nothing', () => {
  const ravi = contextFor(scenario(), 'person:ravi');
  assert.deepEqual(ravi.previousMeetings.map((r) => r.node.label), ['Client review — dashboard v1']);
  assert.deepEqual(ravi.nextMeetings.map((r) => r.node.label), ['Client meeting — dashboard v2 walkthrough']);
  const idea = contextFor(scenario(), 'note:n4');
  assert.equal(idea.counts.openTasks, 0);
  assert.match(idea.lines[0], /Nothing is linked/);
});

test('online meetings get no travel block', () => {
  const st = scenario();
  st.notes[1].meeting.location = 'Google Meet';
  assert.equal(contextFor(st, 'note:n2').travel.mode, 'online');
});

test('upcomingMeetingContexts lists each meeting once even when a note and an event both exist', () => {
  const ups = upcomingMeetingContexts(scenario(), 7);
  assert.deepEqual(ups.map((u) => u.id), ['note:n2']);
  const brief = nextBriefing(scenario());
  assert.equal(brief.kind, 'upcoming');
  assert.equal(brief.ctx.node.label, 'Client meeting — dashboard v2 walkthrough');
});

test('followUpsNeeded flags a recent meeting until a follow-up task exists', () => {
  const st = scenario();
  st.notes[0].meeting.date = D(-1);
  assert.deepEqual(followUpsNeeded(st, 3).map((f) => f.id), ['note:n1']);
  st.tasks = [...st.tasks, { id: 'f1', title: 'Follow up: Client review — dashboard v1', status: 'todo', priority: 4, tags: ['follow-up'], noteId: 'n1' }];
  assert.deepEqual(followUpsNeeded(st, 3), []);
});

test('action items parse per line and can be resolved in place', () => {
  const st = fakeStore(scenario());
  const note = st.getState().notes[0];
  assert.deepEqual(actionItems(note).map((a) => [a.text, a.done]), [['Send recap', true], ['Share moodboard', false], ['Collect KPI list', false]]);
  setActionItemDone(st, 'n1', 1, true);
  assert.equal(st.getState().notes[0].meeting.actions, '[x] Send recap\n[x] Share moodboard\nCollect KPI list');
  setActionItemDone(st, 'n1', 0, false);
  assert.equal(st.getState().notes[0].meeting.actions, 'Send recap\n[x] Share moodboard\nCollect KPI list');
});

test('prep actions write real items: follow-up task, action-item tasks, travel plan', () => {
  const st = fakeStore(scenario());
  const ctx = contextFor(st.getState(), 'note:n2');
  const due = createFollowUpTask(st, ctx);
  assert.equal(due, D(2));
  assert.deepEqual(st.getState().added[0], { title: 'Follow up: Client meeting — dashboard v2 walkthrough', due: D(2), priority: 4, projectId: 'p1', noteId: 'n2', tags: ['follow-up'] });

  assert.equal(actionItemsToTasks(st, ctx), 2);
  assert.equal(actionItemsToTasks(st, contextFor(st.getState(), 'note:n2')), 0); // idempotent
  assert.ok(st.getState().added.some((t) => t.title === 'Share moodboard' && t.noteId === 'n1' && t.due === D(1)));

  assert.equal(addTravelPlan(st, ctx), true);
  assert.deepEqual(st.getState().plansAdded, [{ texts: ['Leave by 09:20 → Client meeting — dashboard v2 walkthrough'], date: D(1) }]);
});

test('capturing "client meeting tomorrow 10am at Acme office with Ravi" keeps the place and the person', () => {
  const p = parseCapture('Client meeting tomorrow 10am at Acme office with Ravi', []);
  assert.equal(p.kind, 'meeting');
  assert.equal(p.date, D(1));
  assert.equal(p.time, '10:00');
  assert.equal(p.location, 'Acme office');
  assert.equal(p.participants, 'Ravi');
  assert.equal(p.title, 'Client meeting with Ravi');
});
