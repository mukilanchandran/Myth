#!/usr/bin/env node
// Myth MCP server — exposes the Myth bridge to Claude Desktop / Claude Code / Cursor
// over stdio (JSON-RPC 2.0, newline-delimited, protocol 2024-11-05). Zero dependencies.
//
// Env: MYTH_BRIDGE_URL (http://127.0.0.1:8787)  MYTH_BRIDGE_KEY (optional)
// Logs go to stderr — stdout is reserved for the protocol.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.MYTH_BRIDGE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const KEY = process.env.MYTH_BRIDGE_KEY || '';
const PROTOCOL = '2024-11-05';
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version || '1.0.0'; }
  catch { return '1.0.0'; }
})();
const log = (...a) => console.error('[myth-mcp]', ...a);

// ---------------------------------------------------------------------------
// bridge HTTP client
// ---------------------------------------------------------------------------
async function api(method, route, body) {
  const headers = { Accept: 'application/json' };
  if (KEY) headers['X-Myth-Key'] = KEY;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new Error(`Cannot reach the Myth bridge at ${BASE} (${e.cause?.message || e.message}). Start it with "npm run bridge" in the Myth folder.`);
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText} from ${route}`);
  return json;
}
const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------
// formatting helpers (readable summary + JSON)
// ---------------------------------------------------------------------------
const MAX_JSON = 60000;
function text(summary, data) {
  let json = JSON.stringify(data, null, 2);
  if (json.length > MAX_JSON) json = `${json.slice(0, MAX_JSON)}\n… (truncated, ${json.length} chars total)`;
  return `${summary}\n\n${json}`;
}
const hint = (r) => (r.hint ? `\n${r.hint}` : '');
const prio = (p) => (p >= 5 ? ' !!' : p === 4 ? ' !' : '');
const taskLine = (t) => `- ${t.title}${t.project ? ` (${t.project})` : ''}${t.due ? ` · due ${t.due}${t.overdue ? ' OVERDUE' : ''}` : ''}${prio(t.priority)} [${t.status}]`;

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'myth_capture',
    description: 'Send free text to Myth\'s Life Inbox. Myth parses it (task / idea / note / meeting / expense / event …) and the user approves it in the app. Use this for anything that does not fit a more specific tool.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The thing to capture, in natural language (e.g. "Call Ravi about the invoice tomorrow").' }, source: { type: 'string', description: 'Where this came from, e.g. "claude", "github", "slack".' } }, required: ['text'] },
    run: async ({ text: t, source }) => {
      const r = await api('POST', '/capture', { text: t, source: source || 'mcp' });
      return text(`Captured into Myth's inbox (queued for approval, ${r.queued} item(s) waiting): "${r.item.text}"`, r.item);
    },
  },
  {
    name: 'myth_add_task',
    description: 'Propose a task in Myth. It lands in the Life Inbox with the given due date / priority / project and the user approves it there (nothing is created silently).',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'Due date, YYYY-MM-DD.' }, priority: { type: 'integer', minimum: 1, maximum: 5, description: '1 (lowest) – 5 (urgent). Default 3.' }, project: { type: 'string', description: 'Project name (matched against existing Myth projects).' } }, required: ['title'] },
    run: async ({ title, due, priority, project }) => {
      const r = await api('POST', '/tasks', { title, due, priority, project, source: 'mcp' });
      const t = r.item.task;
      return text(`Task proposed: "${t.title}"${t.due ? ` due ${t.due}` : ''}${t.priority !== 3 ? ` priority ${t.priority}` : ''}${t.project ? ` in project "${t.project}"${t.projectKnown ? '' : ' (not an existing project — Myth will keep the name in the title)'}` : ''}. Waiting in the inbox for approval.`, r.item);
    },
  },
  {
    name: 'myth_list_tasks',
    description: 'List tasks from Myth\'s latest snapshot. Filter by status (open | done | all | todo | doing | review | blocked) and/or project name.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'all', 'todo', 'doing', 'review', 'blocked'] }, project: { type: 'string' } } },
    run: async ({ status, project }) => {
      const r = await api('GET', `/tasks${qs({ status, project })}`);
      const lines = r.tasks.slice(0, 50).map(taskLine).join('\n');
      return text(`${r.tasks.length} ${r.status} task(s)${r.project ? ` in "${r.project}"` : ''}${hint(r)}\n${lines}`, r.tasks);
    },
  },
  {
    name: 'myth_list_projects',
    description: 'List Myth projects with open/overdue task counts, milestones and completion %. Use it to answer "what projects are at risk?" (look at overdue counts, deadlines and stale milestones).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await api('GET', '/projects');
      const lines = r.projects.map((p) => `- ${p.name} [${p.status}] ${p.pct}% · ${p.tasks.open} open / ${p.tasks.overdue} overdue${p.deadline ? ` · deadline ${p.deadline}` : ''}${p.milestones.next ? ` · next milestone: ${p.milestones.next.title}${p.milestones.next.due ? ` (${p.milestones.next.due})` : ''}` : ''}`).join('\n');
      return text(`${r.projects.length} project(s)${hint(r)}\n${lines}`, r.projects);
    },
  },
  {
    name: 'myth_calendar',
    description: 'Events, meetings (with notes), planned schedule blocks and due tasks between two dates (default: today → +14 days).',
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
    run: async ({ from, to }) => {
      const r = await api('GET', `/calendar${qs({ from, to })}`);
      const lines = r.agenda.slice(0, 80).map((a) => `- ${a.date}${a.time ? ` ${a.time}` : ''}${a.end ? `–${a.end}` : ''} · ${a.title} (${a.type})`).join('\n');
      return text(`${r.from} → ${r.to}: ${r.events.length} event(s), ${r.meetings.length} meeting note(s), ${r.blocks.length} planned block(s), ${r.dueTasks.length} task(s) due${hint(r)}\n${lines}`, r);
    },
  },
  {
    name: 'myth_people',
    description: 'The people graph: everyone Myth knows with category, last contact, open commitments and linked projects.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await api('GET', '/people');
      const lines = r.people.map((p) => `- ${p.name} (${p.category})${p.lastContact ? ` · last contact ${p.lastContact}` : ''}${p.openCommitments ? ` · ${p.openCommitments} open commitment(s)` : ''}${p.projects.length ? ` · ${p.projects.join(', ')}` : ''}`).join('\n');
      return text(`${r.people.length} people${hint(r)}\n${lines}`, r.people);
    },
  },
  {
    name: 'myth_commitments',
    description: 'Promises made (mine) and owed (theirs), with due dates. status: open (default) | done | dropped | all.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'dropped', 'all'] } } },
    run: async ({ status }) => {
      const r = await api('GET', `/commitments${qs({ status })}`);
      const lines = r.commitments.map((c) => `- ${c.direction === 'theirs' ? `${c.person ?? 'Someone'} owes:` : `I owe${c.person ? ` ${c.person}` : ''}:`} ${c.text}${c.due ? ` · due ${c.due}${c.overdue ? ' OVERDUE' : ''}` : ''} [${c.status}]`).join('\n');
      return text(`${r.commitments.length} ${r.status} commitment(s)${hint(r)}\n${lines}`, r.commitments);
    },
  },
  {
    name: 'myth_goals',
    description: 'Goals with key results, linked projects and progress.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await api('GET', '/goals');
      const lines = r.goals.map((g) => `- ${g.title} [${g.status}]${g.pct != null ? ` ${g.pct}%` : ''}${g.targetDate ? ` · by ${g.targetDate}` : ''} · ${g.projects.length} project(s), ${g.tasks.open} open task(s)`).join('\n');
      return text(`${r.goals.length} goal(s)${hint(r)}\n${lines}`, r.goals);
    },
  },
  {
    name: 'myth_context',
    description: 'Search everything Myth knows about a topic, project or person: tasks, notes, meetings, people, events, goals, commitments, memories. If the query matches a project or person you also get their full context (open tasks, notes, commitments).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: async ({ query }) => {
      const r = await api('GET', `/context${qs({ q: query })}`);
      const counts = Object.entries(r.results).filter(([, l]) => l.length).map(([k, l]) => `${l.length} ${k}`).join(', ') || 'nothing';
      let summary = `"${r.q}": ${counts}${hint(r)}`;
      if (r.project) summary += `\nProject "${r.project.name}": ${r.project.pct}% done, ${r.project.openTasks.length} open task(s), ${r.project.notes.length} note(s), people: ${r.project.people.join(', ') || '—'}`;
      if (r.person) summary += `\nPerson "${r.person.name}" (${r.person.category}): ${r.person.openCommitments.length} open commitment(s), ${r.person.openTasks.length} open task(s), last contact ${r.person.lastContact ?? 'unknown'}`;
      return text(summary, r);
    },
  },
  {
    name: 'myth_remember',
    description: 'Store a long-term memory in Myth (a preference, fact, person detail, procedure or episode). Example: "Boss prefers deep work before 11 AM".',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['preference', 'fact', 'person', 'procedure', 'episode'] } }, required: ['text'] },
    run: async ({ text: t, kind }) => {
      const r = await api('POST', '/memory', { text: t, kind, source: 'mcp' });
      return text(`Remembered (${r.item.kind}): "${r.item.text}" — the app will pick it up on its next pull.`, r.item);
    },
  },
  {
    name: 'myth_health',
    description: 'Check that the Myth bridge is reachable, when the app last synced, and how many items wait in the queue.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await api('GET', '/health');
      return text(`Bridge v${r.version} OK · snapshot ${r.snapshotAt ? `from ${r.snapshotAt}` : 'not synced yet'} · ${r.queue} queued item(s) · ${r.webhooks} webhook(s)`, r);
    },
  },
];
const toolByName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const publicTools = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------
function write(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => write({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && msg.id !== undefined) fail(msg.id, -32600, 'Invalid Request');
    return;
  }
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;
  if (isNotification) {
    if (method === 'notifications/initialized') log('client initialised');
    else if (!method.startsWith('notifications/')) log(`ignoring notification ${method}`);
    return;
  }
  try {
    switch (method) {
      case 'initialize':
        reply(id, { protocolVersion: params.protocolVersion && /^\d{4}-\d{2}-\d{2}$/.test(params.protocolVersion) && params.protocolVersion < PROTOCOL ? params.protocolVersion : PROTOCOL, serverInfo: { name: 'myth', version: VERSION }, capabilities: { tools: {} }, instructions: 'Myth is the user\'s personal data layer (tasks, projects, calendar, people, commitments, goals, memory). Reading tools return the app\'s last synced snapshot. Writing tools (myth_capture, myth_add_task, myth_remember) only PROPOSE — the user approves items in Myth\'s Life Inbox.' });
        return;
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: publicTools });
        return;
      case 'tools/call': {
        const tool = toolByName[params?.name];
        if (!tool) { fail(id, -32602, `Unknown tool: ${params?.name}`); return; }
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        try {
          const out = await tool.run(args);
          reply(id, { content: [{ type: 'text', text: out }], isError: false });
        } catch (e) {
          log(`${tool.name} failed: ${e.message}`);
          reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
        }
        return;
      }
      default:
        fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    log(`internal error on ${method}: ${e.stack || e.message}`);
    fail(id, -32603, e.message || 'Internal error');
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let parsed;
    try { parsed = JSON.parse(line); }
    catch { fail(null, -32700, 'Parse error'); continue; }
    if (Array.isArray(parsed)) parsed.forEach((m) => { handle(m); });
    else handle(parsed);
  }
});
process.stdin.on('end', () => {
  const rest = buffer.trim();
  if (rest) { try { handle(JSON.parse(rest)); } catch { /* partial trailing line — ignore */ } }
  setTimeout(() => process.exit(0), 50);
});
process.stdin.on('error', (e) => { log(`stdin error: ${e.message}`); process.exit(1); });
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });
log(`Myth MCP server v${VERSION} ready (bridge ${BASE}, ${TOOLS.length} tools)`);
