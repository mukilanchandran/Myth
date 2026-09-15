// Starting and steering a Myth Planner session from a sentence. Shared by the
// capture bar (Planner mode), the planner module and the assistant's
// "plan …" action, so one sentence behaves the same everywhere.
import dayjs from 'dayjs';
import { detectMode, parseTripInput, describeTripInput, modeReply, MODE_TEMPLATE } from './planner.js';
import { detectProjectIntent, extractDeadline, titleCase, TEMPLATES } from './projectPlanner.js';

const stateOf = (store) => (store.getState ? store.getState() : store);
const entry = (role, text) => ({ id: Math.random().toString(36).slice(2), role, text, ts: Date.now() });

/** Append a chat line to a session (kept to the last 40). */
export function sayInSession(store, sessionId, role, text) {
  stateOf(store).updatePlannerSession(sessionId, (s) => ({ chat: [...(s.chat ?? []), entry(role, text)].slice(-40) }));
}

/** Title shown for a trip session. */
export const tripTitle = (input) => (input.to ? `${input.from ? `${input.from} → ` : ''}${input.to}` : 'New trip');

/**
 * A sentence → a new session in the detected mode with the form pre-filled.
 * Returns { session, reply, mode }; session is null when no mode was found.
 */
export function startPlannerSession(raw, store) {
  const s = stateOf(store);
  const text = String(raw ?? '').trim();
  const { mode } = detectMode(text);
  if (!mode) return { session: null, reply: modeReply(null), mode: null };

  if (mode === 'trip') {
    const input = parseTripInput(text);
    const { summary, missing } = describeTripInput(input);
    const session = s.addPlannerSession({ mode, title: tripTitle(input), input, chat: [] });
    sayInSession(store, session.id, 'user', text);
    const reply = `Trip mode — ${summary}.${missing.length ? ` I still need the ${missing.join(' and ')}: fill it in, then press Plan.` : ' Looks complete — press Plan and I\'ll build routes, itineraries, weather, stays, food and fuel stops.'}`;
    sayInSession(store, session.id, 'ai', reply);
    return { session: stateOf(store).plannerSessions.find((x) => x.id === session.id) ?? session, reply, mode };
  }

  const intent = detectProjectIntent(text) ?? null;
  const { deadline } = extractDeadline(text);
  const tplKey = MODE_TEMPLATE[mode] ?? 'generic';
  const name = intent?.name ?? titleCase(text.replace(/^(?:plan|help me plan|i want to|i need to|let'?s)\s+/i, '').replace(/[.!?]+$/, '').slice(0, 60));
  const session = s.addPlannerSession({ mode, title: name, input: { text, name, deadline: intent?.deadline && !intent.deadlineGuessed ? intent.deadline : deadline ?? null }, chat: [] });
  sayInSession(store, session.id, 'user', text);
  const reply = `${modeReply(mode)} I've set it up as "${name}"${deadline ? ` for ${dayjs(deadline).format('MMM D')}` : ` with a ${TEMPLATES[tplKey].horizonWeeks}-week horizon`} — adjust the name or date, then press Plan.`;
  sayInSession(store, session.id, 'ai', reply);
  return { session: stateOf(store).plannerSessions.find((x) => x.id === session.id) ?? session, reply, mode };
}

/** A filled trip form (from the quick composer) → a trip session. */
export function startTripSession(input, store) {
  const s = stateOf(store);
  const clean = { from: '', to: '', start: null, end: null, travellers: 2, budget: null, style: 'balanced', transport: 'car', ...input };
  if (clean.start && !clean.end) clean.end = clean.start;
  const session = s.addPlannerSession({ mode: 'trip', title: tripTitle(clean), input: clean, chat: [] });
  const { summary } = describeTripInput(clean);
  sayInSession(store, session.id, 'ai', `Trip set up — ${summary}. Press Plan and I'll build it.`);
  return stateOf(store).plannerSessions.find((x) => x.id === session.id) ?? session;
}

// One readable sentence from a composer's fields — what the model plans from.
export function describeModeInput(mode, input) {
  const bits = [];
  const add = (label, v) => { if (v != null && v !== '' && v !== false) bits.push(!label ? String(v) : label === 'by' ? `by ${v}` : `${label}: ${v}`); };
  add('', input.name);
  add('by', input.deadline ? dayjs(input.deadline).format('MMM D, YYYY') : null);
  add('guests', input.guests);
  add('budget', input.budget ? `₹${Number(input.budget).toLocaleString('en-IN')}` : null);
  add('hours a day', input.hoursPerDay);
  add('sessions a week', input.sessionsPerWeek);
  add('level', input.level);
  add('goal', input.goal);
  add('diet', input.diet);
  add('days', input.days);
  add('calories a day', input.calories);
  add('target', input.amount ? `₹${Number(input.amount).toLocaleString('en-IN')}` : null);
  add('monthly income', input.monthlyIncome ? `₹${Number(input.monthlyIncome).toLocaleString('en-IN')}` : null);
  add('type', input.kind);
  add('words', input.words);
  add('current role', input.current);
  add('wake', input.wake);
  add('sleep', input.sleep);
  add('must include', input.focus);
  return bits.join(' · ');
}

/** A filled composer (event, study, fitness, food, money…) → a session in that mode. */
export function startModeSession(mode, input, store) {
  const s = stateOf(store);
  const tplKey = MODE_TEMPLATE[mode] ?? 'generic';
  const name = titleCase(String(input.name ?? '').trim() || `${TEMPLATES[tplKey].label} plan`);
  const deadline = input.deadline ?? dayjs().add(TEMPLATES[tplKey].horizonWeeks, 'week').format('YYYY-MM-DD');
  const clean = { ...input, name, deadline };
  const text = `${TEMPLATES[tplKey].label} — ${describeModeInput(mode, clean)}`;
  const session = s.addPlannerSession({ mode, title: name, input: { ...clean, text }, chat: [] });
  sayInSession(store, session.id, 'ai', `${modeReply(mode)} Set up as "${name}" for ${dayjs(deadline).format('MMM D')} — press Plan and I'll build the schedule and the playbook.`);
  return stateOf(store).plannerSessions.find((x) => x.id === session.id) ?? session;
}

/**
 * Inside a session the chat edits the plan. Returns { reply, reset } —
 * reset means "start a fresh sheet".
 */
export function conversePlanner(session, raw, store) {
  const s = stateOf(store);
  const update = s.updatePlannerSession;
  const t = String(raw ?? '').trim();
  sayInSession(store, session.id, 'user', t);
  const answer = (reply, extra = {}) => { sayInSession(store, session.id, 'ai', reply); return { reply, ...extra }; };

  if (/^(?:new|another|fresh)\s+(?:plan|trip|session)\b/i.test(t)) return { reply: 'Fresh sheet. What are we planning?', reset: true };

  if (session.mode === 'trip') {
    if (/\b(?:start|begin)\s+(?:the\s+)?trip\b|\bgo\s+live\b|\bi'?m\s+(?:leaving|off|starting)\b/i.test(t)) {
      if (session.status === 'confirmed' || session.status === 'planned') {
        update(session.id, { status: 'live', live: { startedAt: new Date().toISOString(), log: [], done: [] } });
        return answer('Live mode on. Share your location or type where you are and I\'ll keep an eye on weather, fuel, food and the plan.');
      }
      return answer('Plan and confirm the trip first, then say "start trip".');
    }
    if (/\b(?:end|finish|stop)\s+(?:the\s+)?trip\b|\bi'?m\s+(?:home|back)\b/i.test(t)) {
      update(session.id, { status: 'done' });
      return answer('Trip closed. Settle the shared expenses and back up the photos — both are tasks in the project.');
    }
    const pick = /\b(?:cheaper|budget)\b/i.test(t) ? 'budget' : /\brelax/i.test(t) ? 'relaxed' : /\b(?:adventure|explore|pack)/i.test(t) ? 'adventure' : /\b(?:classic|balanced|highlights)/i.test(t) ? 'balanced' : /\bluxury|premium\b/i.test(t) ? 'luxury' : /\bfood/i.test(t) ? 'foodie' : /\bfamily\b/i.test(t) ? 'family' : null;
    if (pick && session.result?.variants.some((v) => v.id === pick)) {
      update(session.id, { chosen: pick });
      return answer(`Switched to "${session.result.variants.find((v) => v.id === pick).name}".`);
    }
    const merged = parseTripInput(t);
    const patch = {};
    ['from', 'to', 'start', 'end', 'travellers', 'budget'].forEach((k) => { if (merged[k]) patch[k] = merged[k]; });
    if (/\b(?:relax|adventure|budget|luxury|foodie|family)/i.test(t)) patch.style = merged.style;
    if (/\b(?:car|bike|train|flight|fly|bus)\b/i.test(t)) patch.transport = merged.transport;
    if (Object.keys(patch).length) {
      const input = { ...session.input, ...patch };
      update(session.id, { input, title: tripTitle(input) });
      return answer(`Updated — ${describeTripInput(input).summary}. Press ${session.result ? 'Re-plan' : 'Plan'} to rebuild the days.`);
    }
    return answer(session.status === 'live'
      ? 'While live: "I\'m at Tindivanam" sets your position; the tabs show fuel, food, stays and help nearby.'
      : 'I can change dates, people, budget or style from here ("make it 3 people", "budget 40k", "relaxed"), or say "start trip" once it\'s confirmed.');
  }

  if (/\b(?:go\s+live|start)\b/i.test(t) && session.status === 'confirmed') {
    update(session.id, { status: 'live', live: { startedAt: new Date().toISOString() } });
    return answer('Live — I\'ll show what the plan asks of you each day.');
  }
  const { deadline } = extractDeadline(t);
  if (deadline) {
    update(session.id, { input: { ...session.input, deadline } });
    return answer(`Target date moved to ${dayjs(deadline).format('MMM D')}. Press Re-plan to reschedule.`);
  }
  return answer('Change the name or date above and press Plan; confirm turns it into a project with dated tasks, and "go live" shows what\'s due each day.');
}
