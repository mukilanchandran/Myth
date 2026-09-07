// Life Context Graph — the layer underneath every module.
//
// Every project, task, note, meeting, event, file, drive item and person becomes a
// node. Explicit links (projectId, noteId), schedule matches, people mentions and
// keyword overlap become typed, weighted edges. contextFor() walks that graph so a
// single item — most usefully an upcoming meeting — can be explained in terms of
// everything connected to it, and the prep helpers at the bottom turn that
// understanding into actions (follow-up tasks, travel blocks, prep notes).
//
// Pure functions over a store snapshot: no React, no I/O, safe to call anywhere.
import dayjs from 'dayjs';

export const TRAVEL_MINUTES = 40;

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------
const STOP = new Set((
  'a an the and or of to in on at for with by from this that these those is are was were be been it its my our your their we you ' +
  'i me he she they them as about into over after before up down out off than then so if not no do does did have has had will would ' +
  'can could should may might must new old re vs via per quick check update meeting meet call sync standup tomorrow today tonight ' +
  'next this week month day morning evening afternoon'
).split(/\s+/));

export function tokens(text = '') {
  const out = new Set();
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').forEach((w) => {
    if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  });
  return [...out];
}

const ROLE = new Set(['me', 'myself', 'i', 'team', 'all', 'everyone', 'client', 'clients', 'pm', 'dev', 'lead', 'manager', 'hr', 'ceo', 'cto',
  'designer', 'developer', 'product', 'design', 'engineering', 'sales', 'marketing', 'support', 'staff', 'boss']);
const DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april',
  'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'today', 'tomorrow', 'yesterday']);

// People mentioned in a title ("with Ravi", "Amma's", "client Acme") or listed as participants.
export function extractPeople(text = '', participants = '') {
  const found = new Map();
  const add = (raw) => {
    const name = String(raw).replace(/\(.*?\)/g, '').replace(/[^\w' -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length < 3) return;
    const key = name.toLowerCase();
    if (DAYS.has(key) || key.split(' ').every((w) => ROLE.has(w))) return;
    if (!found.has(key)) found.set(key, name);
  };
  String(participants).split(/[,;&/]|\band\b|\bwith\b/i).forEach(add);
  const t = String(text);
  for (const m of t.matchAll(/\b(?:with|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g)) add(m[1]);
  for (const m of t.matchAll(/\b([A-Z][a-z]{2,})'s\b/g)) add(m[1]);
  for (const m of t.matchAll(/\bclient\s+([A-Z][a-z]+)/g)) add(m[1]);
  return [...found.entries()].map(([key, name]) => ({ key, name }));
}

export function relDay(date) {
  if (!date) return '';
  const d = dayjs(date);
  const diff = d.startOf('day').diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.format('dddd');
  return d.format('ddd, MMM D');
}

const nid = (type, id) => `${type}:${id}`;
const stamp = (n) => `${n.date ?? ''} ${n.time ?? ''}`;

// ---------------------------------------------------------------------------
// graph construction
// ---------------------------------------------------------------------------
export function buildGraph(state) {
  const nodes = new Map();
  const adj = new Map();
  const edges = [];
  const tokenIndex = new Map();

  const addNode = (n) => {
    n.people ??= [];
    nodes.set(n.id, n);
    adj.set(n.id, new Map());
    for (const t of n.tokens) {
      if (!tokenIndex.has(t)) tokenIndex.set(t, new Set());
      tokenIndex.get(t).add(n.id);
    }
    return n;
  };
  const link = (a, b, type, weight) => {
    if (a === b || !adj.has(a) || !adj.has(b)) return;
    const cur = adj.get(a).get(b);
    if (cur && cur.weight >= weight) return;
    adj.get(a).set(b, { type, weight });
    adj.get(b).set(a, { type, weight });
    edges.push({ from: a, to: b, type, weight });
  };
  const personNode = (p) => {
    const id = nid('person', p.key);
    if (!nodes.has(id)) addNode({ id, type: 'person', ref: p, label: p.name, tokens: [] });
    return id;
  };

  (state.projects ?? []).forEach((p) => addNode({
    id: nid('project', p.id), type: 'project', ref: p, label: p.name,
    tokens: tokens(`${p.name} ${p.desc ?? ''}`), date: p.deadline ?? null,
  }));
  (state.tasks ?? []).forEach((t) => addNode({
    id: nid('task', t.id), type: 'task', ref: t, label: t.title,
    tokens: tokens(`${t.title} ${t.desc ?? ''} ${(t.tags ?? []).join(' ')}`),
    projectId: t.projectId ?? null, date: t.due ?? null, done: t.status === 'done', people: extractPeople(t.title),
  }));
  (state.notes ?? []).forEach((n) => {
    const m = n.meeting ?? null;
    const isMeeting = n.type === 'meeting';
    addNode({
      id: nid('note', n.id), type: isMeeting ? 'meeting' : n.type === 'idea' ? 'idea' : 'note', ref: n, label: n.title,
      tokens: tokens(`${n.title} ${m?.agenda ?? ''} ${m?.location ?? ''} ${(n.body ?? '').slice(0, 400)}`),
      projectId: n.projectId ?? null, date: isMeeting ? m?.date ?? null : null, time: isMeeting ? m?.time || null : null,
      people: extractPeople(n.title, m?.participants),
    });
  });
  (state.events ?? []).forEach((e) => addNode({
    id: nid('event', e.id), type: 'event', ref: e, label: e.title, kind: e.kind ?? 'event',
    tokens: tokens(e.title), date: e.date ?? null, time: e.time || null, people: extractPeople(e.title),
  }));
  (state.files ?? []).forEach((f) => addNode({
    id: nid('file', f.id), type: 'file', ref: f, label: f.name ?? 'File', tokens: tokens(f.name), projectId: f.projectId ?? null,
  }));
  (state.drive ?? []).forEach((d) => addNode({
    id: nid('drive', d.id), type: 'drive', ref: d, kind: d.kind, label: d.title || d.name || d.url || 'Untitled',
    tokens: tokens(`${d.title ?? ''} ${d.name ?? ''} ${(d.tags ?? []).join(' ')} ${d.kind === 'text' ? (d.body ?? '').slice(0, 200) : ''}`),
  }));

  const all = [...nodes.values()];
  const projects = all.filter((n) => n.type === 'project');

  for (const n of all) {
    if (n.type === 'person' || n.type === 'project') continue;
    // explicit links
    if (n.projectId && nodes.has(nid('project', n.projectId))) link(n.id, nid('project', n.projectId), 'in_project', 1);
    if (n.type === 'task' && n.ref.noteId && nodes.has(nid('note', n.ref.noteId))) link(n.id, nid('note', n.ref.noteId), 'from_meeting', 1);
    // implied project: its name shows up in the label or tags
    if (!n.projectId) {
      const hay = `${n.label} ${(n.ref.tags ?? []).join(' ')}`.toLowerCase();
      for (const p of projects) {
        const name = p.label.trim().toLowerCase();
        if (name.length >= 4 && hay.includes(name)) { n.impliedProjectId = p.ref.id; link(n.id, p.id, 'about', 0.9); break; }
      }
    }
    for (const p of n.people) link(n.id, personNode(p), 'mentions', 0.9);
  }

  // a meeting note and the calendar entry / task the capture bar created for it
  const meetings = all.filter((n) => n.type === 'meeting' && n.date);
  const sameTitle = (a, b) => a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
  for (const m of meetings) {
    for (const o of all) {
      if (o.date !== m.date) continue;
      if (o.type === 'event' && (sameTitle(m, o) || m.tokens.filter((t) => o.tokens.includes(t)).length >= 2)) link(m.id, o.id, 'scheduled', 1);
      if (o.type === 'task' && sameTitle(m, o)) link(m.id, o.id, 'scheduled', 1);
    }
  }

  // keyword overlap: two shared significant words, or one rare & specific word
  for (const n of all) {
    if (n.type === 'person' || !n.tokens.length) continue;
    const counts = new Map();
    for (const t of n.tokens) for (const other of tokenIndex.get(t) ?? []) if (other !== n.id) counts.set(other, (counts.get(other) ?? 0) + 1);
    for (const [other, shared] of counts) {
      const o = nodes.get(other);
      if (o.type === 'project' && n.type === 'project') continue;
      const rare = shared === 1 && n.tokens.some((t) => o.tokens.includes(t) && t.length >= 5 && (tokenIndex.get(t)?.size ?? 9) <= 3);
      if (shared >= 2 || rare) link(n.id, other, 'relates', Math.min(0.8, 0.3 + shared * 0.2));
    }
  }

  // person nodes were created while linking, so count from the live map, not `all`
  const people = [...nodes.values()].filter((n) => n.type === 'person').length;
  return { nodes, adj, edges, stats: { nodes: nodes.size, edges: edges.length, people } };
}

// The graph is rebuilt only when one of the underlying collections changes.
let cache = null;
const KEYS = ['projects', 'tasks', 'notes', 'events', 'files', 'drive'];
export function getGraph(state) {
  if (cache && KEYS.every((k) => cache.refs[k] === state[k])) return cache.graph;
  const graph = buildGraph(state);
  cache = { refs: Object.fromEntries(KEYS.map((k) => [k, state[k]])), graph };
  return graph;
}

export function searchNodes(state, q, limit = 12) {
  const needle = String(q).trim().toLowerCase();
  if (!needle) return [];
  return [...getGraph(state).nodes.values()]
    .filter((n) => n.label.toLowerCase().includes(needle))
    .sort((a, b) => a.label.length - b.label.length)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// meeting action items — one per line in note.meeting.actions; "[x]" marks done
// ---------------------------------------------------------------------------
const DONE_RX = /^\s*(?:[-*•]\s*)?(?:\[\s*[xX✓✔]\s*\]|✓|✔|done\b[:-]?)\s*/;
const OPEN_RX = /^\s*(?:[-*•]\s*)?(?:\[\s*\]\s*)?/;

export function actionItems(note) {
  const raw = note?.meeting?.actions ?? '';
  return raw.split('\n')
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => line.trim())
    .map(({ line, idx }) => {
      const done = DONE_RX.test(line);
      return { idx, done, text: line.replace(done ? DONE_RX : OPEN_RX, '').trim() };
    });
}

export function setActionItemDone(store, noteId, idx, done) {
  const s = store.getState ? store.getState() : store;
  const note = s.notes.find((n) => n.id === noteId);
  if (!note) return;
  const lines = (note.meeting?.actions ?? '').split('\n');
  if (lines[idx] == null) return;
  const text = lines[idx].replace(DONE_RX, '').replace(OPEN_RX, '').trim();
  lines[idx] = done ? `[x] ${text}` : text;
  s.updateNote(noteId, { meeting: { ...note.meeting, actions: lines.join('\n') } });
}

// ---------------------------------------------------------------------------
// travel: is this meeting somewhere I have to get to?
// ---------------------------------------------------------------------------
const ONLINE_RX = /\b(?:zoom|google meet|gmeet|teams|webex|skype|call|virtual|online|remote|webinar|phone|video)\b/i;
const ONSITE_RX = /\b(?:client|office|on-?site|site visit|visit|campus|venue|hotel|cafe|restaurant|showroom|studio|clinic|hospital|bank|store|branch)\b/i;

function travelFor(node) {
  if (!node.time || !node.date) return null;
  const m = node.ref.meeting ?? {};
  const location = (m.location ?? node.ref.location ?? '').trim();
  const hay = `${node.label} ${m.agenda ?? ''}`;
  if (location ? ONLINE_RX.test(location) : ONLINE_RX.test(hay)) return { mode: 'online', leaveBy: null, location: location || null };
  if (!location && !ONSITE_RX.test(hay)) return null;
  const leaveBy = dayjs(`${node.date} ${node.time}`).subtract(TRAVEL_MINUTES, 'minute').format('HH:mm');
  return { mode: 'onsite', leaveBy, minutes: TRAVEL_MINUTES, location: location || null };
}

// ---------------------------------------------------------------------------
// contextFor — everything connected to one node, ranked
// ---------------------------------------------------------------------------
export function contextFor(state, nodeId) {
  const graph = getGraph(state);
  const node = graph.nodes.get(nodeId);
  if (!node) return null;
  const { nodes, adj } = graph;

  const related = new Map(); // id -> { node, score, via }
  const bump = (id, score, via) => {
    if (id === node.id) return;
    const n = nodes.get(id);
    if (!n) return;
    const cur = related.get(id);
    if (!cur) related.set(id, { node: n, score, via });
    else if (score > cur.score) { cur.score = score; cur.via = via; }
  };
  for (const [id, e] of adj.get(node.id)) bump(id, e.weight, e.type);

  // the project this belongs to (explicit, implied, or the strongest linked one)
  let projectId = node.type === 'project' ? node.ref.id : node.projectId ?? node.impliedProjectId ?? null;
  if (!projectId) {
    const best = [...adj.get(node.id)].filter(([id]) => nodes.get(id)?.type === 'project').sort((a, b) => b[1].weight - a[1].weight)[0];
    if (best) projectId = nodes.get(best[0]).ref.id;
  }
  const project = projectId ? (state.projects ?? []).find((p) => p.id === projectId) ?? null : null;
  if (project) for (const n of nodes.values()) if (n.projectId === project.id || n.impliedProjectId === project.id) bump(n.id, 0.6, 'project');

  // the same people, elsewhere
  const people = [...adj.get(node.id)].map(([id]) => nodes.get(id)).filter((n) => n?.type === 'person');
  for (const p of people) for (const [id] of adj.get(p.id)) bump(id, 0.5, `person:${p.label}`);

  const list = [...related.values()].filter((r) => r.node.type !== 'person');
  const byType = (...types) => list.filter((r) => types.includes(r.node.type)).sort((a, b) => b.score - a.score);

  const tasks = byType('task');
  const openTasks = tasks.filter((r) => !r.node.done)
    .sort((a, b) => (a.node.date ?? '9999').localeCompare(b.node.date ?? '9999') || (b.node.ref.priority ?? 3) - (a.node.ref.priority ?? 3));
  const doneTasks = tasks.filter((r) => r.node.done);
  const notes = byType('note', 'idea');
  const documents = byType('file', 'drive');
  const events = byType('event');

  const pivot = `${node.date ?? dayjs().format('YYYY-MM-DD')} ${node.time ?? '23:59'}`;
  const meetings = byType('meeting').filter((r) => r.node.date);
  const previousMeetings = meetings.filter((r) => stamp(r.node) < pivot).sort((a, b) => stamp(b.node).localeCompare(stamp(a.node)));
  const nextMeetings = meetings.filter((r) => stamp(r.node) >= pivot).sort((a, b) => stamp(a.node).localeCompare(stamp(b.node)));
  const unresolvedActions = previousMeetings.flatMap((r) =>
    actionItems(r.node.ref).filter((a) => !a.done).map((a) => ({ ...a, noteId: r.node.ref.id, noteTitle: r.node.label, date: r.node.date })));

  const isMeeting = node.type === 'meeting' || (node.type === 'event' && node.kind === 'meeting');
  const noteId = node.type === 'meeting' ? node.ref.id : null;
  const followUpTitle = `follow up: ${node.label}`.toLowerCase();
  const followUpTask = isMeeting
    ? (state.tasks ?? []).find((t) => (t.tags ?? []).includes('follow-up') && ((noteId && t.noteId === noteId) || t.title.trim().toLowerCase() === followUpTitle)) ?? null
    : null;
  const isPast = isMeeting && !!node.date && `${node.date} ${node.time ?? '23:59'}` < dayjs().format('YYYY-MM-DD HH:mm');
  const travel = isMeeting && !isPast ? travelFor(node) : null;
  const ownActions = node.type === 'meeting' ? actionItems(node.ref) : [];

  const ctx = {
    node, entity: node.ref, isMeeting, isPast,
    when: { date: node.date ?? null, time: node.time ?? null, rel: relDay(node.date) },
    project, people, openTasks, doneTasks, notes, documents, events,
    previousMeetings, nextMeetings, unresolvedActions, ownActions, followUpTask, travel,
    counts: {
      openTasks: openTasks.length, documents: documents.length, unresolvedActions: unresolvedActions.length,
      notes: notes.length, previousMeetings: previousMeetings.length,
    },
  };
  ctx.lines = briefingLines(ctx);
  return ctx;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function briefingLines(ctx) {
  const { counts: c, project } = ctx;
  const lines = [];
  if (ctx.isMeeting) {
    if (c.openTasks) lines.push(`You have ${plural(c.openTasks, 'open task')} related to ${project ? `"${project.name}"` : 'this meeting'}.`);
    else lines.push(project ? `No open tasks left on "${project.name}".` : 'No open tasks are linked to this meeting yet.');
    if (c.documents) lines.push(`${plural(c.documents, 'document')} ${c.documents === 1 ? 'was' : 'were'} referenced previously: ${ctx.documents.slice(0, 3).map((d) => d.node.label).join(', ')}.`);
    const last = ctx.previousMeetings[0];
    if (c.unresolvedActions) {
      const sources = new Set(ctx.unresolvedActions.map((a) => a.noteId)).size;
      lines.push(sources > 1
        ? `${plural(c.unresolvedActions, 'unresolved action item')} still open from ${sources} earlier meetings (last: ${relDay(last.node.date)}).`
        : `${last ? `Last meeting (${relDay(last.node.date)}) left` : 'Previous meetings left'} ${plural(c.unresolvedActions, 'unresolved action item')}.`);
    } else if (last) lines.push(`Last met ${relDay(last.node.date)}: "${last.node.label}" — nothing left open.`);
    if (c.notes) lines.push(`${plural(c.notes, 'related note')} in your vault.`);
    if (ctx.travel?.mode === 'onsite') lines.push(`Leave by ${ctx.travel.leaveBy} — allow ~${ctx.travel.minutes} min travel${ctx.travel.location ? ` to ${ctx.travel.location}` : ''}.`);
    if (ctx.isPast) lines.push(ctx.followUpTask ? `Follow-up: "${ctx.followUpTask.title}"${ctx.followUpTask.status === 'done' ? ' (done)' : ''}.` : 'No follow-up task yet.');
  } else {
    if (project && ctx.node.type !== 'project') lines.push(`Part of "${project.name}".`);
    if (c.openTasks) lines.push(`${plural(c.openTasks, 'open task')} connected${ctx.doneTasks.length ? `, ${ctx.doneTasks.length} done` : ''}.`);
    const meetingCount = c.previousMeetings + ctx.nextMeetings.length;
    if (meetingCount) lines.push(`${plural(meetingCount, 'meeting')} touch${meetingCount === 1 ? 'es' : ''} this${ctx.nextMeetings[0] ? ` — next: "${ctx.nextMeetings[0].node.label}" ${relDay(ctx.nextMeetings[0].node.date)}` : ''}.`);
    if (c.unresolvedActions) lines.push(`${plural(c.unresolvedActions, 'unresolved action item')} from those meetings.`);
    if (c.documents) lines.push(`${plural(c.documents, 'document')} attached or related.`);
    if (c.notes) lines.push(`${plural(c.notes, 'related note')}.`);
    if (ctx.people.length) lines.push(`People: ${ctx.people.map((p) => p.label).join(', ')}.`);
    if (!lines.length) lines.push('Nothing is linked to this yet — mention a project, a person or a topic and Myth will connect it.');
  }
  return lines;
}

export function briefingText(ctx) {
  const rel = ctx.when.rel;
  const head = ctx.isMeeting
    ? `${rel ? `${rel}${/^(Today|Tomorrow|Yesterday)$/.test(rel) ? "'s" : ':'} ` : ''}${ctx.node.label}${ctx.when.time ? ` (${ctx.when.time})` : ''}`
    : ctx.node.label;
  return [head, ...ctx.lines].join('\n');
}

// One-line " · " summary for capture confirmations and chips.
export function contextSummary(ctx) {
  const c = ctx.counts;
  const parts = [];
  if (ctx.project) parts.push(`linked to ${ctx.project.name}`);
  if (c.openTasks) parts.push(plural(c.openTasks, 'open task'));
  if (c.documents) parts.push(plural(c.documents, 'doc'));
  if (c.unresolvedActions) parts.push(plural(c.unresolvedActions, 'unresolved action'));
  if (ctx.travel?.leaveBy) parts.push(`leave by ${ctx.travel.leaveBy}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// what needs attention: upcoming meetings, meetings that still need a follow-up
// ---------------------------------------------------------------------------
export function upcomingMeetingContexts(state, days = 7) {
  const graph = getGraph(state);
  const start = dayjs().format('YYYY-MM-DD');
  const end = dayjs().add(days, 'day').format('YYYY-MM-DD');
  const now = dayjs().format('YYYY-MM-DD HH:mm');
  const inRange = (n) => n.date && n.date >= start && n.date <= end && !(n.date === start && n.time && `${n.date} ${n.time}` < now);
  const picked = [];
  const covered = new Set();
  for (const n of graph.nodes.values()) {
    if (n.type !== 'meeting' || !inRange(n)) continue;
    picked.push(n);
    for (const [id, e] of graph.adj.get(n.id)) if (e.type === 'scheduled') covered.add(id);
  }
  for (const n of graph.nodes.values()) {
    if (n.type === 'event' && n.kind === 'meeting' && !covered.has(n.id) && inRange(n)) picked.push(n);
  }
  return picked
    .sort((a, b) => `${a.date} ${a.time ?? '99'}`.localeCompare(`${b.date} ${b.time ?? '99'}`))
    .map((n) => ({ id: n.id, ctx: contextFor(state, n.id) }));
}

export function followUpsNeeded(state, days = 3) {
  const graph = getGraph(state);
  const now = dayjs();
  const start = now.subtract(days, 'day').format('YYYY-MM-DD');
  const current = now.format('YYYY-MM-DD HH:mm');
  return [...graph.nodes.values()]
    .filter((n) => n.type === 'meeting' && n.date && n.date >= start && `${n.date} ${n.time ?? '23:59'}` < current)
    .sort((a, b) => stamp(b).localeCompare(stamp(a)))
    .map((n) => ({ id: n.id, ctx: contextFor(state, n.id) }))
    .filter(({ ctx }) => !ctx.followUpTask);
}

// The single most useful thing to surface on the landing page right now.
export function nextBriefing(state) {
  const soon = upcomingMeetingContexts(state, 2)[0];
  if (soon) return { kind: 'upcoming', ...soon };
  const fu = followUpsNeeded(state, 3)[0];
  if (fu) return { kind: 'followup', ...fu };
  const later = upcomingMeetingContexts(state, 7)[0];
  return later ? { kind: 'upcoming', ...later } : null;
}

// ---------------------------------------------------------------------------
// prep actions — turn the briefing into real items in the store
// ---------------------------------------------------------------------------
const stateOf = (store) => (store.getState ? store.getState() : store);

export function createFollowUpTask(store, ctx) {
  const s = stateOf(store);
  const base = ctx.when.date ? dayjs(ctx.when.date) : dayjs();
  const due = (base.isBefore(dayjs(), 'day') ? dayjs() : base).add(1, 'day').format('YYYY-MM-DD');
  s.addTask({
    title: `Follow up: ${ctx.node.label}`, due, priority: 4, projectId: ctx.project?.id ?? null,
    noteId: ctx.node.type === 'meeting' ? ctx.node.ref.id : null, tags: ['follow-up'],
  });
  return due;
}

export function actionItemsToTasks(store, ctx) {
  const s = stateOf(store);
  const existing = new Set(s.tasks.map((t) => t.title.trim().toLowerCase()));
  let n = 0;
  for (const a of ctx.unresolvedActions) {
    const key = a.text.trim().toLowerCase();
    if (!key || existing.has(key)) continue;
    s.addTask({
      title: a.text, priority: 4, projectId: ctx.project?.id ?? null, noteId: a.noteId, tags: ['action-item'],
      due: ctx.isMeeting && !ctx.isPast && ctx.when.date ? ctx.when.date : null,
    });
    existing.add(key);
    n += 1;
  }
  return n;
}

export function travelPlanExists(state, ctx) {
  if (!ctx.when.date) return false;
  return (state.plans?.[ctx.when.date] ?? []).some((i) => /^leave by/i.test(i.text));
}

export function addTravelPlan(store, ctx) {
  const s = stateOf(store);
  if (!ctx.travel?.leaveBy || !ctx.when.date) return false;
  s.addPlanItems([`Leave by ${ctx.travel.leaveBy} → ${ctx.node.label}`], ctx.when.date);
  return true;
}

export function createPrepNote(store, ctx) {
  const s = stateOf(store);
  const bullet = (items) => items.map((x) => `• ${x}`).join('\n');
  const body = [
    briefingText(ctx),
    ctx.openTasks.length ? `Open tasks:\n${bullet(ctx.openTasks.map((r) => `${r.node.label}${r.node.date ? ` (due ${dayjs(r.node.date).format('MMM D')})` : ''}`))}` : null,
    ctx.unresolvedActions.length ? `Unresolved from earlier meetings:\n${bullet(ctx.unresolvedActions.map((a) => `${a.text} — ${a.noteTitle}`))}` : null,
    ctx.documents.length ? `Documents:\n${bullet(ctx.documents.map((d) => d.node.label))}` : null,
    ctx.notes.length ? `Notes:\n${bullet(ctx.notes.slice(0, 5).map((d) => d.node.label))}` : null,
    ctx.entity.meeting?.agenda ? `Agenda:\n${ctx.entity.meeting.agenda}` : null,
    'Talking points:\n• ',
  ].filter(Boolean).join('\n\n');
  return s.addNote({ title: `Prep: ${ctx.node.label}`, type: 'note', projectId: ctx.project?.id ?? null, body });
}
