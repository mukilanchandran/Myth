// Myth AI capture engine — turns any free text (typed or spoken) into
// structured items routed to every feature of the platform: tasks, ideas,
// notes, meetings, expenses, income, habits, birthdays, events, learning,
// journal entries, projects and today's-plan items.
// Works fully offline; no external calls.
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import { contextFor, contextSummary, extractPeople } from './context.js';

const RX = {
  expense: /(?:spent|paid|bought|purchase[d]?|bill)\s+(?:₹|rs\.?\s*|\$)?\s*(\d[\d,]*(?:\.\d+)?)|(?:₹|rs\.?\s*)\s*(\d[\d,]*(?:\.\d+)?)/i,
  income: /(?:received|salary|credited|earned|income)\s+(?:₹|rs\.?\s*|\$)?\s*(\d[\d,]*(?:\.\d+)?)/i,
  idea: /^(?:idea[:\-\s]|💡)|(?:\b(?:app|startup|feature|product)\s+idea\b)/i,
  note: /^(?:note[:\-\s]|nb[:\-\s])|^remember\s+(?!me\b|to\b)/i,
  meeting: /\b(?:meeting|meet with|call with|standup|sync|1:1|one on one|review call|discussion|demo|presentation|interview)\b/i,
  habit: /^habit[:\-\s]/i,
  habitDaily: /\b(?:every\s*day|everyday|daily|every (?:morning|night|evening))\b/i,
  birthday: /\b(?:birthday|b'?day|anniversary)\b/i,
  event: /\b(?:wedding|marriage|party|function|festival|ceremony|reception|appointment|checkup|exam|flight|train to|trip to|travel to|vacation|holiday|concert|movie night|get.?together)\b/i,
  learning: /^(?:learn|study|practice)\b|\b(?:want to learn|start learning|learn about|take (?:a )?course|complete (?:the )?course|watch (?:the )?tutorial|study)\b/i,
  journal: /^(?:journal|diary|dear diary)[:\-\s]|^(?:today was|feeling|i feel|i am feeling|grateful for)\b/i,
  plan: /^(?:plan|today'?s? plan|my plan)[:\-\s]|^today i(?:'ll| will| am going to| want to)\b/i,
  newProject: /^(?:new|start|create)(?:\s+a)?\s+project\b[:\-\s]*/i,
  // clause starts with a doing-verb → it's a to-do, even if it mentions an event word
  actionVerb: /^(?:book|buy|pay|renew|call|email|send|fix|finish|complete|prepare|submit|update|clean|order|arrange|apply|cancel|design|build|create|write|review)\b/i,
  reminder: /^remind me (?:to|about|of)\s+/i,
  urgent: /\b(?:urgent|asap|critical|important|p1|high priority)\b/i,
  low: /\b(?:low priority|someday|later|whenever|p4|p5)\b/i,
  project: /\bproject\s+["']?([\w][\w\s-]{1,40}?)["']?(?:\s*[,.]|$)/i,
};

// Everyday shorthand chrono doesn't understand → words it does.
const SLANG = [
  [/\bday after tmrw?\b/gi, 'day after tomorrow'],
  [/\btmrw?\b/gi, 'tomorrow'],
  [/\btmw\b/gi, 'tomorrow'],
  [/\b2moro\b/gi, 'tomorrow'],
  [/\b2day\b/gi, 'today'],
  [/\btonite\b/gi, 'tonight'],
  [/\bcomm?ing\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b/gi, 'next $1'],
  [/\bnxt\b/gi, 'next'],
  [/\bevng\b/gi, 'evening'],
  [/\bmrng\b/gi, 'morning'],
];

export function normalizeText(raw) {
  let t = raw;
  for (const [rx, rep] of SLANG) t = t.replace(rx, rep);
  return t;
}

// Split one free-form sentence into independent capture clauses:
// "tomorrow I have meeting, coming sunday my sister birthday" → 2 items.
export function parseMulti(raw, projects = []) {
  const normalized = normalizeText(raw);
  const parts = normalized
    .split(/\n|;|,(?!\d)|\band\s+(?=(?:i\s|my\s|on\s|next\s|this\s|tomorrow|today|tonight|meeting|call|buy|pay|renew|book|spent|paid|habit|idea|note|learn|study|remind|plan)\b)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
  const clauses = parts.length ? parts : [normalized.trim()];
  return clauses
    .map((c) => c.replace(/^(?:also\s+|then\s+|and\s+|plus\s+)/i, '').trim())
    .filter((c) => c.length > 1)
    .map((c) => parseCapture(c, projects))
    .filter(Boolean);
}

export function parseCapture(raw, projects = []) {
  let text = normalizeText(raw.trim());
  if (!text) return null;

  // --- date/time extraction (remove EVERY date/time fragment from the title) ---
  const chronoResults = chrono.parse(text, new Date(), { forwardDate: true });
  let due = null;
  let time = null;
  let cleanText = text;
  if (chronoResults.length) {
    const r = chronoResults[0];
    due = dayjs(r.start.date()).format('YYYY-MM-DD');
    for (const res of chronoResults) {
      if (res.start.isCertain('hour') && !time) time = dayjs(res.start.date()).format('HH:mm');
      cleanText = cleanText.replace(res.text, ' ');
    }
    cleanText = cleanText.replace(/\s{2,}/g, ' ').trim();
    cleanText = cleanText.replace(/\s*\b(?:by|on|at|before|due|until|for)\s*$/i, '').trim();
  }

  // --- priority (keywords become metadata, not title text) ---
  let priority = 3;
  if (RX.urgent.test(text)) priority = 5;
  else if (RX.low.test(text)) priority = 2;
  cleanText = cleanText.replace(RX.urgent, '').replace(RX.low, '').replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();

  // --- project matching (existing project name mentioned) ---
  let projectId = null;
  const lower = text.toLowerCase();
  for (const p of projects) {
    if (p.name && lower.includes(p.name.toLowerCase())) { projectId = p.id; break; }
  }

  const normalize = (str) =>
    str
      .replace(/^(?:idea|note|remember|habit|nb|journal|diary|plan)[:\-\s]+/i, '')
      .replace(/^(?:i\s+(?:have|hav|got|need to|want to|will|am going to)\s+(?:a\s+|an\s+)?|next\s+|this\s+|on\s+|also\s+|then\s+)+/i, '')
      .replace(/\s+(?:urgent|asap|important|high priority)\s*$/i, '')
      .replace(/\s*\b(?:by|on|at|before|due|until|for)\s*$/i, '')
      .trim();
  const title = normalize(cleanText || text);
  // habits/ideas/notes keep their full wording — date words are part of the name
  const rawTitle = normalize(text);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const base = { raw, title: cap(title) };
  const baseRaw = { raw, title: cap(rawTitle) };

  // --- classification (ordered by specificity) ---
  const expMatch = text.match(RX.expense);
  const incMatch = text.match(RX.income);
  if (incMatch) {
    return { kind: 'income', ...base, amount: parseFloat(incMatch[1].replace(/,/g, '')), category: guessCategory(text), date: due ?? dayjs().format('YYYY-MM-DD') };
  }
  if (expMatch && !RX.meeting.test(text)) {
    const amount = parseFloat((expMatch[1] ?? expMatch[2]).replace(/,/g, ''));
    return { kind: 'expense', ...base, amount, category: guessCategory(text), date: due ?? dayjs().format('YYYY-MM-DD') };
  }
  // "habit: read" or recurring phrasing → habit ("drink water daily")
  if (RX.habit.test(raw.trim()) || RX.habitDaily.test(text)) {
    const name = cap(normalize(text.replace(RX.habitDaily, ' ').replace(/\s{2,}/g, ' ').trim()));
    return { kind: 'habit', ...baseRaw, title: name || baseRaw.title };
  }
  if (RX.birthday.test(text)) return { kind: 'birthday', ...base, date: due ?? dayjs().format('YYYY-MM-DD') };
  if (RX.idea.test(raw.trim())) return { kind: 'idea', ...baseRaw, projectId };
  if (RX.note.test(raw.trim())) return { kind: 'note', ...baseRaw, projectId };
  if (RX.newProject.test(text)) {
    const name = cap(text.replace(RX.newProject, '').trim());
    if (name) return { kind: 'project', ...base, title: name };
  }
  if (RX.plan.test(raw.trim())) {
    const item = cap(text.replace(RX.plan, '').trim());
    if (item) return { kind: 'plan', ...base, title: item };
  }
  if (RX.journal.test(raw.trim())) return { kind: 'journal', ...baseRaw };
  if (RX.learning.test(text)) {
    const name = cap(rawTitle.replace(/^(?:learn|study|practice|want to learn|start learning|learn about|take (?:a )?course (?:on|about)?|watch (?:the )?tutorial (?:on|about)?)\s*/i, '').trim());
    if (name) return { kind: 'learning', ...base, title: name };
  }
  // "book flight", "finish LMS demo" are to-dos, not calendar entries
  const actionable = (cleanText || text).replace(/^(?:i\s+(?:have|need to|want to|will|am going to)\s+)/i, '');
  const startsWithAction = RX.actionVerb.test(actionable) && !/^(?:meet|call)\s+with\b/i.test(actionable);
  if (RX.meeting.test(text) && !startsWithAction) {
    // "client meeting tomorrow 10am at Acme office with Ravi" — the place and the people feed the Context Engine
    const src = cleanText || text;
    const locMatch = src.match(/\b(?:at|in|@)\s+([A-Z][\w&'.-]*(?:\s+(?!with\b)[\w&'.-]+){0,4})(?=\s+with\b|\s*$)/);
    const location = locMatch ? locMatch[1].trim() : '';
    const participants = extractPeople(text).map((p) => p.name).join(', ');
    const mTitle = locMatch ? cap(normalize(src.replace(locMatch[0], ' ').replace(/\s{2,}/g, ' ').trim()) || base.title) : base.title;
    return { kind: 'meeting', ...base, title: mTitle, date: due ?? dayjs().format('YYYY-MM-DD'), time, projectId, location, participants };
  }
  if (RX.event.test(text) && !startsWithAction) return { kind: 'event', ...base, date: due ?? dayjs().format('YYYY-MM-DD'), time };
  if (RX.reminder.test(raw.trim())) {
    const t = cap(normalize(cleanText.replace(RX.reminder, '').trim()) || title);
    return { kind: 'task', ...base, title: t, due, priority, projectId };
  }

  return { kind: 'task', ...base, due, priority, projectId };
}

function guessCategory(text) {
  const t = text.toLowerCase();
  if (/food|lunch|dinner|breakfast|snack|restaurant|swiggy|zomato|coffee|tea/.test(t)) return 'Food';
  if (/uber|ola|petrol|fuel|bus|train|flight|cab|auto/.test(t)) return 'Transport';
  if (/rent|emi|electricity|water bill|internet|gas|maintenance/.test(t)) return 'Home & Bills';
  if (/movie|game|netflix|spotify|subscription|prime/.test(t)) return 'Entertainment';
  if (/grocery|groceries|vegetables|market/.test(t)) return 'Groceries';
  if (/doctor|medicine|pharmacy|hospital|gym/.test(t)) return 'Health';
  if (/amazon|flipkart|shopping|clothes|shoes|dress/.test(t)) return 'Shopping';
  if (/course|book|udemy|learning/.test(t)) return 'Learning';
  if (/salary/.test(t)) return 'Salary';
  return 'Other';
}

const isToday = (d) => d && dayjs(d).isSame(dayjs(), 'day');
const stateOf = (store) => (store.getState ? store.getState() : store);

// Executes a parsed capture against the store. Returns human confirmation text.
export function executeCapture(parsed, store) {
  const s = store.getState ? store.getState() : store;
  switch (parsed.kind) {
    case 'task': {
      s.addTask({ title: parsed.title, due: parsed.due, priority: parsed.priority, projectId: parsed.projectId });
      s.addXp('capture');
      // anything committed for today also lands on Today's plan
      if (isToday(parsed.due)) s.addPlanItems([parsed.title]);
      return `Task added${parsed.due ? ` · due ${dayjs(parsed.due).format('ddd, MMM D')}` : ''}${parsed.priority === 5 ? ' · high priority' : ''}${isToday(parsed.due) ? " · on today's plan" : ''}`;
    }
    case 'idea':
      s.addNote({ title: parsed.title, type: 'idea', projectId: parsed.projectId });
      s.addXp('capture');
      return 'Idea saved to your vault';
    case 'note':
      s.addNote({ title: parsed.title, type: 'note', projectId: parsed.projectId });
      s.addXp('capture');
      return 'Note saved';
    case 'meeting': {
      const note = s.addNote({
        title: parsed.title, type: 'meeting', projectId: parsed.projectId,
        meeting: { date: parsed.date, time: parsed.time, participants: parsed.participants ?? '', location: parsed.location ?? '', agenda: '', actions: '' },
      });
      s.addEvent({ title: parsed.title, date: parsed.date, time: parsed.time, kind: 'meeting' });
      s.addTask({ title: parsed.title, due: parsed.date, priority: 4, projectId: parsed.projectId, tags: ['meeting'] });
      if (isToday(parsed.date)) s.addPlanItems([parsed.title]);
      s.addXp('meeting');
      // the Context Engine links the new meeting to its project, open tasks, notes, documents and people;
      // when the project was only implied by the wording, make the link explicit
      let ctx = contextFor(stateOf(store), `note:${note.id}`);
      if (ctx?.project && !parsed.projectId) {
        s.updateNote(note.id, { projectId: ctx.project.id });
        ctx = contextFor(stateOf(store), `note:${note.id}`);
      }
      const linked = ctx ? contextSummary(ctx) : '';
      return `Meeting on calendar + task list for ${dayjs(parsed.date).format('ddd, MMM D')}${parsed.time ? ` at ${parsed.time}` : ''}${isToday(parsed.date) ? " · on today's plan" : ''}${linked ? ` · ${linked}` : ''}`;
    }
    case 'event':
      s.addEvent({ title: parsed.title, date: parsed.date, time: parsed.time, kind: 'event' });
      if (isToday(parsed.date)) s.addPlanItems([parsed.title]);
      return `Added to calendar — ${dayjs(parsed.date).format('ddd, MMM D')}${parsed.time ? ` at ${parsed.time}` : ''}`;
    case 'expense':
      s.addTransaction({ type: 'expense', amount: parsed.amount, category: parsed.category, note: parsed.title, date: parsed.date });
      return `Expense ₹${parsed.amount.toLocaleString('en-IN')} recorded under ${parsed.category}`;
    case 'income':
      s.addTransaction({ type: 'income', amount: parsed.amount, category: parsed.category, note: parsed.title, date: parsed.date });
      return `Income ₹${parsed.amount.toLocaleString('en-IN')} recorded`;
    case 'habit':
      s.addHabit({ name: parsed.title });
      return `New habit "${parsed.title}" — tracking starts today`;
    case 'birthday':
      s.addEvent({ title: parsed.title, date: parsed.date, kind: 'birthday', yearly: true });
      return `Birthday saved for ${dayjs(parsed.date).format('ddd, MMM D')} — I'll remind you every year`;
    case 'learning':
      s.addLearning(parsed.title);
      s.addXp('capture');
      return `"${parsed.title}" added to your learning pipeline`;
    case 'journal':
      s.addJournalEntry({ text: parsed.title });
      return `Journal entry saved for today`;
    case 'plan':
      s.addPlanItems([parsed.title]);
      return `Added to today's plan`;
    case 'project': {
      s.addProject({ name: parsed.title });
      return `Project "${parsed.title}" created`;
    }
    default:
      return 'Captured.';
  }
}
