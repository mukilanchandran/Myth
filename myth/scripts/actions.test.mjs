// Unit tests for the assistant's action layer (src/ai/actions.js), the
// document writer (src/ai/docgen.js) and the planner session helper. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { parseActions, visibleText, runActions, localActionIntent, toDate, ACTIONS } from '../src/ai/actions.js';
import { makePdf, makeDocument, fileNameFor, normalizeFormat } from '../src/ai/docgen.js';
import { startPlannerSession, conversePlanner } from '../src/ai/plannerSession.js';
import { transportOptions, linkGuideToMap, themesToVariants } from '../src/ai/tripGuide.js';

// A tiny in-memory store with the same actions the real zustand store exposes.
function fakeStore() {
  const s = {
    tasks: [], projects: [], notes: [], files: [], drive: [], habits: [], transactions: [], journal: [], learning: [], events: [], plannerSessions: [], plans: {},
    settings: { name: 'Mukil' },
    addTask: (t) => { s.tasks.unshift({ id: `t${s.tasks.length}`, status: 'todo', ...t }); },
    completeTask: (id) => { s.tasks = s.tasks.map((t) => (t.id === id ? { ...t, status: 'done' } : t)); },
    addProject: (p) => { const proj = { id: `p${s.projects.length}`, milestones: [], ...p }; s.projects.unshift(proj); return proj; },
    addNote: (n) => { const note = { id: `n${s.notes.length}`, ...n }; s.notes.unshift(note); return note; },
    addEvent: (e) => { s.events.unshift({ id: `e${s.events.length}`, ...e }); },
    addTransaction: (t) => { s.transactions.unshift({ id: `x${s.transactions.length}`, ...t }); },
    addHabit: (h) => { s.habits.push({ id: `h${s.habits.length}`, log: {}, ...h }); },
    addJournalEntry: (j) => { s.journal.unshift({ id: `j${s.journal.length}`, ...j }); },
    addPlanItems: (texts) => { const k = dayjs().format('YYYY-MM-DD'); s.plans[k] = [...(s.plans[k] ?? []), ...texts.map((t) => ({ id: t, text: t, done: false }))]; },
    addLearning: (item) => { const l = { id: `l${s.learning.length}`, stage: 0, notes: '', fileIds: [], links: [], ...(typeof item === 'string' ? { title: item } : item) }; s.learning.push(l); return l; },
    updateLearning: (id, patch) => { s.learning = s.learning.map((l) => (l.id === id ? { ...l, ...patch } : l)); },
    attachToLearning: (id, fileId) => { s.learning = s.learning.map((l) => (l.id === id ? { ...l, fileIds: [...l.fileIds, fileId] } : l)); },
    addFileMeta: (f) => { s.files.unshift({ id: `f${s.files.length}`, ...f }); },
    updateFileMeta: (id, patch) => { s.files = s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)); },
    addDriveItem: (d) => { const it = { id: `d${s.drive.length}`, ...d }; s.drive.unshift(it); return it; },
    addXp: () => {},
    addPlannerSession: (p) => { const sess = { id: `pl${s.plannerSessions.length}`, status: 'draft', chat: [], input: {}, result: null, ...p }; s.plannerSessions.unshift(sess); return sess; },
    updatePlannerSession: (id, patch) => { s.plannerSessions = s.plannerSessions.map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)); },
  };
  return { getState: () => s, state: s };
}

const ctxFor = (store, extra = {}) => ({ store, files: [], putBlob: async () => {}, getBlob: async () => null, ui: {}, ...extra });

test('parseActions splits the answer from the action block', () => {
  const raw = 'Done, Boss — added it.\n```myth\n[{"action":"add_task","title":"Pay rent","due":"tomorrow"}]\n```';
  const { text, actions } = parseActions(raw);
  assert.equal(text, 'Done, Boss — added it.');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'add_task');
  // a whole-JSON reply and the tag form work too
  assert.equal(parseActions('{"actions":[{"action":"add_habit","name":"Read"}]}').actions[0].action, 'add_habit');
  assert.equal(parseActions('ok <actions>{"action":"open","panel":"tasks"}</actions>').actions[0].panel, 'tasks');
  assert.deepEqual(parseActions('just prose { not json').actions, []);
  assert.equal(visibleText('Sure thing.\n```myth\n[{"act'), 'Sure thing.');
});

test('toDate reads natural and ISO dates', () => {
  assert.equal(toDate('2026-10-02'), '2026-10-02');
  assert.equal(toDate('tomorrow'), dayjs().add(1, 'day').format('YYYY-MM-DD'));
  assert.equal(toDate(''), null);
});

test('runActions writes to the store and reports each step', async () => {
  const store = fakeStore();
  const lines = await runActions([
    { action: 'add_task', title: 'Pay rent', due: 'tomorrow', priority: 5 },
    { action: 'add_learning', title: 'React hooks', notes: 'start with useEffect' },
    { action: 'move_learning', title: 'react', stage: 'learning' },
    { action: 'add_expense', amount: '250', note: 'lunch', category: 'Food' },
    { action: 'save_link', title: 'Docs', url: 'react.dev', to: 'learning', learning: 'React hooks' },
    { action: 'create_project', name: 'portfolio website', plan: true, deadline: dayjs().add(6, 'week').format('YYYY-MM-DD') },
    { action: 'nope' },
  ], ctxFor(store));
  const s = store.state;
  assert.equal(s.tasks.some((t) => t.title === 'Pay rent' && t.priority === 5), true);
  assert.equal(s.learning[0].stage, 1);
  assert.equal(s.learning[0].links[0].url, 'https://react.dev');
  assert.equal(s.transactions[0].amount, 250);
  assert.equal(s.projects[0].name, 'Portfolio Website');
  assert.ok(s.tasks.filter((t) => t.projectId === s.projects[0].id).length >= 10, 'a planned project comes with tasks');
  assert.equal(lines.filter((l) => l.startsWith('✅')).length, 6);
  assert.match(lines.at(-1), /don't know how to "nope"/);
});

test('create_file makes a real document and files it under learning', async () => {
  const store = fakeStore();
  const blobs = {};
  const ctx = ctxFor(store, { putBlob: async (id, blob) => { blobs[id] = blob; } });
  const [line] = await runActions([{ action: 'create_file', title: 'SQL joins', format: 'pdf', content: '## Inner join\n- rows in both\n\n## Left join\n- all left rows', to: 'learning' }], ctx);
  assert.match(line, /PDF "SQL joins.pdf" created/);
  const s = store.state;
  assert.equal(s.learning[0].title, 'SQL joins');
  assert.equal(s.learning[0].fileIds.length, 1);
  assert.equal(s.files[0].learningId, s.learning[0].id);
  assert.equal(s.files[0].type, 'application/pdf');
  const blob = blobs[s.files[0].id];
  assert.ok(blob && blob.size > 300);
  assert.equal(s.drive.length, 0, 'a learning file is not duplicated into Drive');
});

test('attach_file and the plain-English shortcut put a chat file where it belongs', async () => {
  const store = fakeStore();
  store.state.files.unshift({ id: 'fileA', name: 'hooks.pdf', type: 'application/pdf', size: 1000 });
  const file = { id: 'fileA', name: 'hooks.pdf', type: 'application/pdf', size: 1000, text: 'Hooks let you use state in function components.' };
  const ctx = ctxFor(store, { files: [file] });
  const reply = await localActionIntent('add this pdf to learning', ctx);
  assert.match(reply, /hooks\.pdf.*attached to "hooks" in Learning/);
  assert.equal(store.state.learning[0].fileIds[0], 'fileA');
  assert.equal(store.state.learning[0].notes, file.text);
  // a second file, this time into a named project
  store.state.projects.push({ id: 'p9', name: 'Acme redesign' });
  const [line] = await runActions([{ action: 'attach_file', file: 'last', to: 'project', project: 'acme' }], ctx);
  assert.match(line, /filed under project "Acme redesign"/);
  assert.equal(store.state.files.find((f) => f.id === 'fileA').projectId, 'p9');
  assert.equal(await localActionIntent('what is overdue?', ctx), null);
});

test('the generate shortcut writes a document through ctx.write', async () => {
  const store = fakeStore();
  const ctx = ctxFor(store, { write: async (p) => (/react hooks/i.test(p) ? '## Why\n- state in functions' : '') });
  const reply = await localActionIntent('make me a cheat sheet on React hooks and add it to learning', ctx);
  assert.match(reply, /Markdown "React Hooks.md" created/);
  assert.equal(store.state.learning[0].title, 'React Hooks');
  assert.equal(store.state.learning[0].fileIds.length, 1);
});

test('the PDF writer emits a valid multi-page PDF', async () => {
  const long = Array.from({ length: 120 }, (_, i) => `- Line ${i + 1}: ${'word '.repeat(12)}`).join('\n');
  const blob = makePdf('A study sheet', `# Heading\n${long}`);
  const text = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trim().endsWith('%%EOF'));
  assert.match(text, /\/Type \/Pages \/Kids \[(\d+ 0 R ?){2,}\] \/Count [2-9]/, 'more than one page');
  // every xref offset points at "N 0 obj"
  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 4), 'xref');
  const offsets = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.match(text.slice(o, o + 12), new RegExp(`^${i + 1} 0 obj`)));
  assert.equal(fileNameFor('SQL joins', 'pdf'), 'SQL joins.pdf');
  assert.equal(normalizeFormat('cheat sheet'), 'md');
  assert.equal(makeDocument({ title: 'T', body: 'b', format: 'html' }).mime, 'text/html');
});

test('startPlannerSession and conversePlanner drive a trip from sentences', () => {
  const store = fakeStore();
  const { session, mode } = startPlannerSession('Trip from Chennai to Goa 20-24 Dec for 2, budget 30k, relaxed', store);
  assert.equal(mode, 'trip');
  assert.equal(session.input.to, 'Goa');
  assert.equal(session.chat.length, 2);
  const { reply } = conversePlanner(session, 'budget 40k', store);
  assert.match(reply, /40,000/);
  assert.equal(store.state.plannerSessions[0].input.budget, 40000);
  assert.equal(startPlannerSession('hello there', store).session, null);
  const ev = startPlannerSession("Plan my sister's wedding in December", store);
  assert.equal(ev.mode, 'event');
});

test('the destination guide joins the map and becomes extra itineraries', () => {
  const pois = { attractions: [{ id: 'a1', name: 'Fort Aguada', kind: 'attraction', sub: 'fort', lat: 15.49, lon: 73.77 }], food: [], stays: [] };
  const guide = {
    mustSee: [{ name: 'Fort Aguada', why: 'sunset' }, { name: 'Dudhsagar Falls', why: 'monsoon' }], hiddenGems: [], food: [], stays: [], areas: [],
    themes: [{ id: 'nature', name: 'Nature', tagline: 'green', days: [{ day: 1, title: 'Falls', items: [{ time: '09:00', kind: 'sight', title: 'Fort Aguada', note: null }, { time: '13:00', kind: 'food', title: 'Lunch', note: null }] }] }],
    transport: [{ mode: 'train', how: 'Vasco express', cost: '₹1,200', hours: 18 }],
  };
  const linked = linkGuideToMap(guide, pois, 'Goa');
  assert.equal(linked.mustSee[0].poi, 'a1');
  assert.match(linked.mustSee[1].mapUrl, /maps\/search.*Dudhsagar/);
  const variants = themesToVariants(linked, { start: '2026-12-20', travellers: 2, transport: 'car', route: { km: 900 }, pois }, 2);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].id, 'theme-nature');
  assert.equal(variants[0].days.length, 2, 'every trip day exists even when the theme skipped one');
  assert.equal(variants[0].days[0].items[0].poi, 'a1');
  const t = transportOptions({ km: 900, minutes: 900, travellers: 2, from: 'Chennai', to: 'Goa', guide: linked });
  assert.ok(t.find((x) => x.mode === 'flight'), 'flights offered on a long trip');
  assert.equal(t.find((x) => x.mode === 'train').costLabel, '₹1,200');
  assert.equal(Object.keys(ACTIONS).includes('plan'), true);
});

test('every plan kind has a mode, a template and a composer path', async () => {
  const { detectMode, MODES, MODE_TEMPLATE } = await import('../src/ai/planner.js');
  const { TEMPLATES } = await import('../src/ai/projectPlanner.js');
  const { startModeSession, describeModeInput } = await import('../src/ai/plannerSession.js');
  assert.equal(detectMode('Vegetarian meal plan to lose weight, 1800 calories').mode, 'food');
  assert.equal(detectMode('Save 1 lakh for an emergency fund by March').mode, 'finance');
  assert.equal(detectMode('Pay off my credit card in 6 months').mode, 'finance');
  assert.equal(detectMode('Plan my weekday morning routine').mode, 'routine');
  assert.equal(detectMode('Open a bakery').mode, 'business', 'food words must not steal business sentences');
  assert.equal(detectMode('Renovate the kitchen').mode, 'home');
  for (const key of Object.keys(MODES)) assert.ok(TEMPLATES[MODE_TEMPLATE[key]], `template for ${key}`);
  const store = fakeStore();
  const s = startModeSession('finance', { name: 'emergency fund', amount: 120000, deadline: dayjs().add(6, 'month').format('YYYY-MM-DD'), monthlyIncome: 60000 }, store);
  assert.equal(s.mode, 'finance');
  assert.equal(s.title, 'Emergency Fund');
  assert.match(s.input.text, /Money goal — Emergency Fund · by \w{3} \d{1,2}, \d{4} · target: ₹1,20,000 · monthly income: ₹60,000/);
  assert.match(describeModeInput('food', { goal: 'Lose weight', diet: 'Vegetarian', days: 7 }), /goal: Lose weight · diet: Vegetarian · days: 7/);
  assert.equal(s.chat.length, 1);
});

test('a captured meeting is only a calendar entry, carrying the place and the people', async () => {
  const { parseCapture, executeCapture } = await import('../src/ai/parser.js');
  const store = fakeStore();
  const parsed = parseCapture('client meeting tomorrow 10am at Acme office with Ravi', []);
  assert.equal(parsed.kind, 'meeting');
  assert.equal(parsed.location, 'Acme office');
  assert.equal(parsed.participants, 'Ravi');
  const reply = executeCapture(parsed, store);
  assert.match(reply, /Meeting on the calendar — .* at 10:00 · Acme office · with Ravi/);
  assert.equal(store.state.events.length, 1);
  assert.equal(store.state.events[0].kind, 'meeting');
  assert.equal(store.state.events[0].location, 'Acme office');
  assert.equal(store.state.notes.length, 0, 'no meeting note');
  assert.equal(store.state.tasks.length, 0, 'no shadow task');
  const [line] = await runActions([{ action: 'add_meeting', title: 'Design review', date: 'tomorrow', time: '3pm', location: 'Zoom' }], ctxFor(store));
  assert.match(line, /Design review.*on the calendar/);
  assert.equal(store.state.events.length, 2);
  assert.equal(store.state.notes.length, 0);
});
