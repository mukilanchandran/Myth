// Myth Assistant — answers questions about your data.
// 1) A local intelligence layer works fully offline (pattern-matched intents over the dataset).
// 2) An LLM streams answers grounded in the user's live data. Works with free cloud
//    providers (Groq, OpenRouter, Gemini — pick one in Settings → AI brain) or a
//    local Ollama, via any OpenAI-compatible endpoint.
import dayjs from 'dayjs';
import { monthStats, narrative } from './insights';
import { parseCapture, executeCapture } from './parser';
import { upcomingMeetingContexts, followUpsNeeded, briefingText, createFollowUpTask, contextFor, getGraph, tokens } from './context.js';
import { visibleNotifications } from './notifications.js';
import { detectAI, pickModel, streamChat, warmUp, OLLAMA_DEFAULT } from './ollama';
import { providerFor, PROVIDERS } from './providers';
import { commandCenter, fmtDuration } from './commandCenter';
import { mithNow, nowText, nowBrief } from './mithNow';
import { detectProjectIntent, describePlan, normalizeAiPlan, TEMPLATES } from './projectPlanner';
import { APP_NAME } from '../config/env';

function fmtTask(t) {
  return `${t.title}${t.due ? ` — due ${dayjs(t.due).format('MMM D')}` : ''}${t.priority >= 5 ? ' (high priority)' : ''}`;
}

const LEARNING_STAGES = ['want to learn', 'learning', 'applied', 'taught/shared'];

// Today's-plan items (the pills under the capture bar).
function todayPlanItems(state) {
  return state.plans?.[dayjs().format('YYYY-MM-DD')] ?? [];
}

// Events in the next `days`, with yearly ones (birthdays/anniversaries) rolled
// forward to their next occurrence.
function upcomingEvents(state, days = 30) {
  const now = dayjs();
  return (state.events ?? [])
    .map((e) => {
      let d = dayjs(e.date);
      if (e.yearly) {
        d = d.year(now.year());
        if (d.isBefore(now, 'day')) d = d.add(1, 'year');
      }
      return { ...e, next: d };
    })
    .filter((e) => e.next.diff(now, 'day') >= 0 && e.next.diff(now, 'day') <= days)
    .sort((a, b) => a.next.valueOf() - b.next.valueOf());
}

export function localAnswer(q, state) {
  const text = q.toLowerCase();
  const tasks = state.tasks;
  const open = tasks.filter((t) => t.status !== 'done');

  // "what did I work on <day>" / "what did I do"
  const dayMatch = text.match(/what (?:did|have) i (?:work(?:ed)? on|do(?:ne)?)\s*(.*)/);
  if (dayMatch) {
    let ref = dayjs();
    if (dayMatch[1]) {
      const parsedDay = dayMatch[1].trim();
      if (parsedDay.includes('yesterday')) ref = dayjs().subtract(1, 'day');
      else if (parsedDay) {
        const d = new Date(dayjs().format('YYYY-MM-DD') + ' ' + parsedDay);
        if (!isNaN(d)) ref = dayjs(d);
      }
    }
    const done = tasks.filter((t) => t.completedAt && dayjs(t.completedAt).isSame(ref, 'day'));
    const notes = state.notes.filter((n) => dayjs(n.created).isSame(ref, 'day'));
    if (!done.length && !notes.length) return `Nothing recorded for ${ref.format('dddd, MMM D')}.`;
    return [
      `On ${ref.format('dddd, MMM D')}:`,
      ...done.map((t) => `• Completed: ${t.title}`),
      ...notes.map((n) => `• ${n.type[0].toUpperCase()}${n.type.slice(1)}: ${n.title}`),
    ].join('\n');
  }

  // "what should I do now?" — MITH NOW: the best use of the time until the next thing on the clock
  if (/what (?:should|do|can|could) i do (?:right )?now|what now\b|\bmith now\b|\bmyth now\b|do now\?|best use of (?:my|this) time|what to do now/.test(text)) {
    return nowText(mithNow(state)) + '\n\nTap "What should I do now?" on the home screen to start the sprint with a timer.';
  }

  // "what matters right now" / "what should I do next" — the Life Command Center
  if (/what matters|what should i (?:do|focus on|work on)|what(?:'s| is) next\b|right now|what now|command cent/.test(text)
      && !/next (?:week|month|year)/.test(text)) {
    const cc = commandCenter(state);
    const lines = [];
    if (cc.attention.length) {
      lines.push('Needs attention:');
      cc.attention.slice(0, 5).forEach((a) => lines.push(`• ${a.title} — ${a.sub}`));
    } else {
      lines.push('Nothing needs attention right now.');
    }
    lines.push('', cc.plan.message);
    if (cc.active?.remaining) {
      lines.push('', `Plan in motion — ${cc.active.done}/${cc.active.total} blocks done.`);
    } else if (cc.plan.blocks.length) {
      lines.push('', 'The plan:');
      cc.plan.blocks.forEach((b) => lines.push(`${b.start}–${b.end}  ${b.title}`));
      lines.push('', 'Say "follow the plan" and I\'ll put these on today\'s calendar.');
    }
    return lines.join('\n');
  }

  // Notification intelligence — "what should I handle today?", "anything urgent?", "why did I get that notification?"
  if (/\b(?:notifications?|alerts?|anything urgent|what'?s urgent|what should i (?:handle|do first|focus on)|what needs (?:my )?attention|why (?:did|am) i get(?:ting)?)\b/.test(text)) {
    const list = visibleNotifications(state);
    if (!list.length) return "Nothing needs an interruption right now, Boss — the day fits. I only speak up when something won't.";
    return list.slice(0, 5)
      .map((n) => `${n.level === 'act' ? '🔴' : n.level === 'plan' ? '🟠' : '⚪'} ${n.headline}\n${n.lines.map((l) => `   ${l}`).join('\n')}`)
      .join('\n\n');
  }

  // Context Engine — "prepare me for tomorrow's meeting", "what do I need for the client meeting", "context for <project>"
  if (/(?:\b(?:prep(?:are)?|preparation|brief(?:ing)?|get (?:me )?ready|what do i need)\b.*\b(?:meeting|call|client|tomorrow|today|next|review|demo)\b)|\bmeeting (?:prep|context|brief)|\bcontext (?:for|of|on)\b|^(?:prep|brief me|briefing)$/.test(text)) {
    const ups = upcomingMeetingContexts(state, 14);
    const tomorrowKey = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const todayKey = dayjs().format('YYYY-MM-DD');
    const tail = '\n\nOpen the Context engine (brain icon in the dock) to tick action items, block travel or create a prep note.';
    if (/tomorrow/.test(text)) { const pick = ups.find((u) => u.ctx.when.date === tomorrowKey); if (pick) return briefingText(pick.ctx) + tail; }
    else if (/today/.test(text)) { const pick = ups.find((u) => u.ctx.when.date === todayKey); if (pick) return briefingText(pick.ctx) + tail; }
    else {
      // a named project, person or note beats guessing a meeting
      const named = [...getGraph(state).nodes.values()]
        .filter((n) => n.type !== 'task' && n.label.length >= 4 && text.includes(n.label.toLowerCase()))
        .sort((a, b) => b.label.length - a.label.length)[0];
      if (named) return briefingText(contextFor(state, named.id)) + tail;
      const pick = ups.find((u) => tokens(u.ctx.node.label).some((t) => text.includes(t))) ?? ups[0];
      if (pick) return briefingText(pick.ctx) + tail;
    }
    const fu = followUpsNeeded(state, 5)[0];
    if (fu) return `${briefingText(fu.ctx)}\n\nSay "add follow-up task" and I'll create it.`;
    return 'Nothing coming up to prepare for, Boss. Capture one like "client meeting tomorrow 10am" and I\'ll link it to its project, tasks, notes and documents.';
  }

  // "what's on today's plan" / "my plan" / "plan progress" — the pill strip under the capture bar
  if (/(?:today'?s?|my|the)\s+plan|plan\s+(?:for\s+)?today|what(?:'s| is)\s+(?:on\s+)?(?:my\s+)?plan|plan\s+(?:progress|status|left|remaining)/.test(text)
      && !/plan (?:my )?(?:day|week|tomorrow)/.test(text)) {
    const items = todayPlanItems(state);
    if (!items.length) return `No plan set for today yet, Boss. Tell me "plan: <something>" or tap "Set today's plan" under the capture bar.`;
    const done = items.filter((i) => i.done);
    const pending = items.filter((i) => !i.done);
    return [
      `Today's plan — ${done.length}/${items.length} done:`,
      ...pending.map((i) => `○ ${i.text}`),
      ...done.map((i) => `✓ ${i.text}`),
      pending.length === 0 ? 'All done — great day, Boss! 🎉' : null,
    ].filter(Boolean).join('\n');
  }

  // calendar / upcoming events / birthdays
  if (/\b(?:calendar|events?|birthday|anniversar|upcoming|schedule[d]?|this week|next week)\b/.test(text)
      && !/\b(?:due|tasks?|overdue|deadline)\b/.test(text)) {
    const evs = upcomingEvents(state, /month/.test(text) ? 31 : 14);
    if (!evs.length) return 'Nothing on the calendar for the coming days. Capture one like "sister\'s birthday on Sep 2" or "team demo friday 4pm".';
    return [
      'Coming up:',
      ...evs.slice(0, 10).map((e) => `• ${e.next.format('ddd, MMM D')}${e.time ? ` ${e.time}` : ''} — ${e.title}${e.kind === 'birthday' ? ' 🎂' : e.kind === 'meeting' ? ' (meeting)' : ''}`),
    ].join('\n');
  }

  // learning pipeline
  if (/\blearn(?:ing)?\b|\bstud(?:y|ying)\b|course|pipeline/.test(text)) {
    if (!state.learning?.length) return 'Your learning pipeline is empty. Capture one like "learn Framer Motion" to start it.';
    return [
      'Learning pipeline:',
      ...state.learning.map((l) => `• ${l.title} — ${LEARNING_STAGES[l.stage] ?? 'want to learn'}`),
    ].join('\n');
  }

  // journal / mood
  if (/\bjournal\b|\bmood\b|\bdiary\b|how (?:was|is) my (?:day|week)/.test(text)) {
    const recent = state.journal.slice(0, 5);
    if (!recent.length) return 'No journal entries yet. Open Journal, or just tell me "journal: today was..."';
    return [
      'Recent journal entries:',
      ...recent.map((j) => `• ${dayjs(j.date).format('ddd, MMM D')} — mood ${j.mood}/5${j.energy ? `, energy ${j.energy}/5` : ''}${j.text ? ` — ${j.text.slice(0, 60)}` : ''}`),
    ].join('\n');
  }

  // XP / level / streak (gamification)
  if (/\bxp\b|\blevel\b|\bstreak\b|\bpoints?\b/.test(text)) {
    const { points, streakCount } = state.xp;
    const lvl = Math.floor(Math.sqrt(points / 40)) + 1;
    return `You're level ${lvl} with ${points} XP, Boss — current streak: ${streakCount} day${streakCount === 1 ? '' : 's'}. Completing tasks, habits and journaling all earn XP.`;
  }

  // "what can you do" / feature guide
  if (/what (?:can|do) you (?:do|know)|\bhelp\b$|your (?:features|capabilities)|how do (?:i|you) use/.test(text)) {
    return [
      'I have eyes on everything in Myth, Boss:',
      '• Today\'s plan — "what\'s my plan today?", "plan: review designs", "mark <item> done"',
      '• Tasks & priorities — "what\'s overdue?", "add task pay rent tomorrow"',
      '• Projects — "project progress?"',
      '• Notes, ideas & meetings — "recent ideas?", "add meeting with client friday 3pm"',
      '• Habits & streaks — "how are my habits?"',
      '• Money — "how much did I spend this month?", "spent 250 on lunch"',
      '• Journal & mood — "how was my week?"',
      '• Calendar & birthdays — "what\'s coming up?"',
      '• Learning pipeline — "what am I learning?"',
      '• Reports — "generate my monthly report"',
      '• XP & streak — "what level am I?"',
      'Plus anything else — general questions welcome too. ✨',
    ].join('\n');
  }

  if (/priorit|focus|today|plan (?:my )?(?:day|tomorrow)/.test(text)) {
    const overdue = open.filter((t) => t.due && dayjs(t.due).isBefore(dayjs(), 'day'));
    const todayDue = open.filter((t) => t.due && dayjs(t.due).isSame(dayjs(), 'day'));
    const high = open.filter((t) => t.priority >= 4 && !overdue.includes(t) && !todayDue.includes(t));
    const picks = [...overdue, ...todayDue, ...high].slice(0, 6);
    if (!picks.length) return `Your plate is clear — a good day to pull something from the backlog or capture new goals.`;
    let n = 0;
    return [
      'Suggested priorities:',
      ...overdue.map((t) => `${++n}. Overdue — ${fmtTask(t)}`),
      ...todayDue.map((t) => `${++n}. Today — ${fmtTask(t)}`),
      ...high.slice(0, 3).map((t) => `${++n}. ${fmtTask(t)}`),
    ].join('\n');
  }

  if (/monthly (?:review|report)|month in review|generate.*report/.test(text)) {
    const stats = monthStats(state, dayjs().format('YYYY-MM-DD'));
    return narrative(stats, 'Boss').join('\n');
  }

  if (/which project|most time|project.*progress|progress.*project/.test(text)) {
    const stats = monthStats(state, dayjs().format('YYYY-MM-DD'));
    const rows = stats.projectProgress.filter((p) => p.total > 0);
    if (!rows.length) return 'No project activity yet. Create a project and link tasks to it.';
    return ['Project progress:', ...rows.map((p) => `• ${p.name}: ${p.done}/${p.total} tasks (${p.pct}%)`)].join('\n');
  }

  if (/overdue|late|pending|deadline/.test(text)) {
    const overdue = open.filter((t) => t.due && dayjs(t.due).isBefore(dayjs(), 'day'));
    const soon = open.filter((t) => t.due && dayjs(t.due).diff(dayjs(), 'day') >= 0 && dayjs(t.due).diff(dayjs(), 'day') <= 7);
    if (!overdue.length && !soon.length) return 'No overdue tasks and nothing due this week. You are ahead of the curve.';
    return [
      overdue.length ? `Overdue (${overdue.length}):` : null,
      ...overdue.map((t) => `• ${fmtTask(t)}`),
      soon.length ? `Due within 7 days:` : null,
      ...soon.map((t) => `• ${fmtTask(t)}`),
    ].filter(Boolean).join('\n');
  }

  if (/how (?:am i doing|is my (?:progress|month))|productivity/.test(text)) {
    const stats = monthStats(state, dayjs().format('YYYY-MM-DD'));
    return `This month: ${stats.completed} done / ${stats.created} created (${stats.completionRate}%), ${stats.overdue} overdue, ${stats.meetings} meetings, ${stats.ideas} ideas. Ask "generate my monthly report" for the full story.`;
  }

  if (/idea/.test(text)) {
    const ideas = state.notes.filter((n) => n.type === 'idea').slice(0, 8);
    if (!ideas.length) return 'Your idea vault is empty. Type "idea: ..." in the capture bar to start filling it.';
    return ['Recent ideas:', ...ideas.map((n) => `• ${n.title}`)].join('\n');
  }

  if (/habit|streak/.test(text)) {
    if (!state.habits.length) return 'No habits tracked yet. Type "habit: drink water" to create one.';
    const t = dayjs().format('YYYY-MM-DD');
    return ['Today\'s habits:', ...state.habits.map((h) => `• ${h.name} — ${h.log[t] ? 'done' : 'pending'}`)].join('\n');
  }

  if (/spend|expense|money|budget|finance/.test(text)) {
    const stats = monthStats(state, dayjs().format('YYYY-MM-DD'));
    if (!stats.spent && !stats.earned) return 'No transactions this month. Capture one like: "spent 250 on lunch".';
    return `This month: spent ₹${stats.spent.toLocaleString('en-IN')}, earned ₹${stats.earned.toLocaleString('en-IN')} (net ${stats.savings >= 0 ? '+' : ''}₹${stats.savings.toLocaleString('en-IN')}).${stats.expenseByCategory[0] ? ` Top category: ${stats.expenseByCategory[0].name}.` : ''}`;
  }

  return null; // not understood locally
}

// Build a compact but rich snapshot of the user's data for the model.
function buildContext(state) {
  const { name } = state.settings;
  const today = dayjs().format('YYYY-MM-DD');
  const stats = monthStats(state, today);
  const open = state.tasks.filter((t) => t.status !== 'done').slice(0, 25);
  const recentDone = state.tasks
    .filter((t) => t.completedAt && dayjs(t.completedAt).isAfter(dayjs().subtract(7, 'day')))
    .slice(0, 15);
  const recentNotes = state.notes.slice(0, 10);
  const plan = todayPlanItems(state);
  const { points, streakCount } = state.xp;
  const cc = commandCenter(state);
  const rightNow = mithNow(state);
  return {
    user: name, today,
    // MITH NOW — the best use of the time until the next thing on the clock
    mithNow: {
      headline: rightNow.headline, minutesAvailable: rightNow.window.minutes,
      next: rightNow.window.next ? { title: rightNow.window.next.title, at: rightNow.window.next.at } : null,
      bestUse: rightNow.primary ? { task: rightNow.primary.title, minutes: rightNow.primary.minutes, why: rightNow.primary.why, partial: rightNow.primary.partial } : null,
      then: rightNow.quick.map((q) => ({ what: q.title, minutes: q.minutes })),
      remainingAfter: rightNow.remaining,
      sprintRunning: state.nowSession ? { task: state.nowSession.title, until: state.nowSession.until } : null,
    },
    todayPlan: {
      items: plan.map((i) => ({ text: i.text, done: i.done })),
      done: plan.filter((i) => i.done).length,
      total: plan.length,
    },
    commandCenter: {
      dayProgress: cc.progress,
      needsAttention: cc.attention.slice(0, 8).map((a) => ({ what: a.title, why: a.sub, kind: a.kind })),
      todayTimeline: cc.timeline.map((t) => ({ time: t.time, title: t.title, kind: t.kind, status: t.status })),
      focusTimeLeft: fmtDuration(cc.plan.focusMinutes),
      suggestedPlan: {
        message: cc.plan.message,
        blocks: cc.plan.blocks.map((b) => ({ start: b.start, end: b.end, task: b.title, why: b.why })),
      },
      activePlan: cc.active
        ? { done: cc.active.done, total: cc.active.total, current: cc.active.current?.title ?? null, next: cc.active.next?.title ?? null }
        : null,
    },
    proposal: state.pendingProposal
      ? {
          name: state.pendingProposal.plan.name,
          deadline: state.pendingProposal.plan.deadline,
          milestones: state.pendingProposal.plan.milestones.map((m) => ({ title: m.title, due: m.due, tasks: m.tasks.length })),
          taskCount: state.pendingProposal.plan.taskCount,
        }
      : null,
    monthStats: stats,
    openTasks: open.map((t) => ({ title: t.title, due: t.due, priority: t.priority, status: t.status })),
    completedLast7Days: recentDone.map((t) => ({ title: t.title, at: t.completedAt?.slice(0, 10) })),
    projects: state.projects.map((p) => ({ name: p.name, status: p.status, deadline: p.deadline })),
    recentNotes: recentNotes.map((n) => ({ type: n.type, title: n.title })),
    habitsToday: state.habits.map((h) => ({ name: h.name, done: !!h.log[today] })),
    upcomingEvents: upcomingEvents(state, 30).slice(0, 12).map((e) => ({ title: e.title, date: e.next.format('YYYY-MM-DD'), time: e.time, kind: e.kind })),
    learningPipeline: (state.learning ?? []).map((l) => ({ title: l.title, stage: LEARNING_STAGES[l.stage] ?? 'want to learn' })),
    recentTransactions: (state.transactions ?? []).slice(0, 12).map((t) => ({ type: t.type, amount: t.amount, category: t.category, note: t.note, date: t.date })),
    recentJournal: state.journal.slice(0, 5).map((j) => ({ date: j.date, mood: j.mood, energy: j.energy, text: (j.text || j.reflection || '').slice(0, 100) })),
    // Context Engine — each upcoming meeting explained through everything linked to it
    contextEngine: {
      upcomingMeetings: upcomingMeetingContexts(state, 7).slice(0, 4).map(({ ctx }) => ({
        title: ctx.node.label, when: `${ctx.when.date}${ctx.when.time ? ` ${ctx.when.time}` : ''}`, project: ctx.project?.name ?? null,
        people: ctx.people.map((p) => p.label), openTasks: ctx.openTasks.slice(0, 6).map((r) => r.node.label),
        documents: ctx.documents.slice(0, 5).map((r) => r.node.label), unresolvedActions: ctx.unresolvedActions.slice(0, 6).map((a) => a.text),
        previousMeetings: ctx.previousMeetings.slice(0, 3).map((r) => `${r.node.label} (${r.node.date})`),
        leaveBy: ctx.travel?.leaveBy ?? null, followUpExists: !!ctx.followUpTask,
      })),
      followUpsNeeded: followUpsNeeded(state, 5).map(({ ctx }) => ({ title: ctx.node.label, date: ctx.when.date, unresolvedActions: ctx.unresolvedActions.length })),
    },
    // Notification intelligence — what Myth would interrupt for right now, with the reasoning
    notifications: visibleNotifications(state).slice(0, 5).map((n) => ({ level: n.level, headline: n.headline, why: n.lines })),
    gamification: { xpPoints: points, level: Math.floor(Math.sqrt(points / 40)) + 1, streakDays: streakCount },
    counts: {
      driveItems: (state.drive ?? []).length,
      files: (state.files ?? []).length,
      notes: state.notes.length,
      habits: state.habits.length,
      journalEntries: state.journal.length,
    },
  };
}

function systemPrompt(state) {
  const { name } = state.settings;
  return [
    `You are Myth, the loyal personal assistant of ${name}. Right now it is ${dayjs().format('dddd, MMMM D, YYYY, h:mm A')} (user's local time).`,
    `ALWAYS address the user as "Boss" — never by their name. Talk like a sharp, supportive friend, not a formal bot.`,
    `You can answer ANY question, on two levels:`,
    `1) Questions about the user's life (tasks, money, habits, projects, schedule) — answer concretely from the live DATA snapshot below. Never invent numbers about their data; if something isn't in DATA, say so.`,
    `2) Everything else — general knowledge, geography, science, history, math, advice, writing, ideas — answer fully and confidently from your own knowledge, like any capable AI assistant. The DATA snapshot is context about the user, NOT a limit on what you know. Never refuse a general question by saying "my data doesn't have that".`,
    `You know the Myth app inside-out. Its features (all reflected in DATA): Today's plan (todayPlan — the morning "what I'll do today" pills under the capture bar; each item can be ticked done; user can add via "plan: ..." or the Set today's plan button), the capture bar (free text/voice → auto-routed to tasks, ideas, notes, meetings, expenses, income, habits, birthdays, events, learning, journal, plan items), Tasks (priorities 1-5, due dates, statuses), Projects (tasks link to them), Notes/Ideas/Meetings vault, Habits with streaks, Finance (₹ expenses/income by category), Journal (mood & energy 1-5), Learning pipeline (want-to-learn → learning → applied → taught), Calendar events & yearly birthdays, Drive (private file/password vault — you see counts only, contents stay private), Reports (monthly reviews), XP/levels/streak gamification. Work and personal live in one combined flow.`,
    `Context Engine (DATA.contextEngine): every meeting is linked to its project, open tasks, notes, documents, people and previous meetings with unresolved action items. Use it proactively — when a meeting is near, summarise what is open (e.g. "Tomorrow's client meeting: 4 open tasks, 2 documents, 3 unresolved action items") and suggest preparing; the user can open the Context engine panel to act on it.`,
    `Notification intelligence (DATA.notifications): the things worth interrupting the user for right now, each with its reasoning — what, by when, how long it needs, whether the day has room. When asked what to handle first or why something was flagged, answer from it; never invent urgency that isn't there.`,
    `When asked about today's plan, answer from DATA.todayPlan (items with done flags). Questions about ANY feature above — how it works, what's in it, progress — answer them; never claim you lack access to a Myth feature.`,
    `The home screen is the Life Command Center: DATA.commandCenter holds the day progress, what needs attention, today's timeline and the plan you suggest (focus blocks that fit between events). When asked what matters now, what to do next or what the plan is, answer from it, and mention they can say "follow the plan" to put the focus blocks on today's calendar.`,
    `MITH NOW (DATA.mithNow): the big "What should I do now?" button. It measures the minutes until the next meeting/event, picks the one task that best fits that window (bestUse) and fills the rest with quick wins (then). When asked what to do now / right now, answer from DATA.mithNow exactly — the same task, minutes and quick wins — and mention they can press the button to start a timed sprint. Mith learns from what they start, skip and finish.`,
    `Automatic project creation: when the user describes an undertaking ("I need to launch my portfolio website next month") Myth drafts a project proposal — milestones and dated tasks — and asks before creating anything. DATA.proposal holds the pending one, if any; it becomes a real project only when they press Create project or say "create project".`,
    `Be brief and warm; use short lines and the occasional emoji, matching a productivity app. Amounts are in Indian rupees (₹).`,
    `DATA: ${JSON.stringify(buildContext(state))}`,
  ].join('\n');
}

// Resolve which endpoint/model to use.
// Configured provider first; with nothing configured the fallback chain is
// local Ollama (private) → LLM7 free keyless cloud, so chat works out of the box.
export async function resolveAI(state) {
  const { aiEndpoint, aiModel, aiKey } = state.settings;

  if (aiEndpoint) {
    const provider = providerFor(aiEndpoint);
    const probe = await detectAI(aiEndpoint, { apiKey: aiKey });
    if (!probe.ok) {
      // Some OpenAI-compatible endpoints gate or omit /models. With a key and a
      // known model we can still chat — let the actual completion call decide.
      const model = aiModel || provider?.defaultModel;
      if (aiKey && model) return { ok: true, endpoint: aiEndpoint, apiKey: aiKey, model };
      return { ok: false, configured: true };
    }
    const models = provider?.mapModels ? provider.mapModels(probe.models) : probe.models;
    const usable = models.length ? models : probe.models;
    return { ok: true, endpoint: aiEndpoint, apiKey: aiKey, model: pickModel(aiModel || provider?.defaultModel, usable) };
  }

  // Auto mode 1: local Ollama when it's running (fully private).
  const local = await detectAI(OLLAMA_DEFAULT);
  if (local.ok) return { ok: true, endpoint: OLLAMA_DEFAULT, apiKey: '', model: pickModel(aiModel, local.models) };

  // Auto mode 2: LLM7 — free cloud, no key needed.
  const llm7 = PROVIDERS.find((p) => p.id === 'llm7');
  const cloud = await detectAI(llm7.endpoint);
  if (cloud.ok) {
    const models = llm7.mapModels(cloud.models);
    return {
      ok: true, endpoint: llm7.endpoint, apiKey: '',
      model: pickModel(aiModel || llm7.defaultModel, models.length ? models : llm7.fallbackModels),
    };
  }
  return { ok: false, configured: false };
}

// Keep the local model resident so questions answer in ~1s instead of ~30s.
// Call on app start and every few minutes while the app is open.
export async function keepModelWarm(state) {
  const ai = await resolveAI(state);
  if (!ai.ok) return false;
  await warmUp(ai.endpoint, ai.model);
  return true;
}

// Open-source LLM bridge (OpenAI-compatible). Streams tokens through onToken.
export async function llmAnswer(q, state, onToken, history = []) {
  const ai = await resolveAI(state);
  if (!ai.ok) return null;
  const recent = history.slice(-8).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
  const text = await streamChat({
    endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, onToken,
    messages: [
      { role: 'system', content: systemPrompt(state) },
      ...recent,
      { role: 'user', content: q },
    ],
  });
  return text || null;
}

// AI-written month-in-review, streamed. Returns null when no model is reachable.
export async function aiMonthReview(stats, state, onToken) {
  const ai = await resolveAI(state);
  if (!ai.ok) return null;
  const text = await streamChat({
    endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, onToken,
    messages: [
      {
        role: 'system',
        content: `You are Myth, the personal life-OS of ${state.settings.name}. Address the reader only as "Boss". Write warm, concrete, honest reviews. Plain text only — no markdown symbols, no emojis, no headers.`,
      },
      {
        role: 'user',
        content: `Write my month-in-review for ${stats.month} in 6-9 short lines. Cover: what got done, what lagged, one pattern you notice, and end with 2-3 concrete focus points for next month. Amounts are Indian rupees. Data: ${JSON.stringify(stats)}`,
      },
    ],
  });
  return text ? { text, model: ai.model } : null;
}

// Rephrase the Command Center's recommendation in Myth's voice. The facts —
// which tasks, in what order, for how long — come from the rule-based plan;
// the model only changes the wording. Null when no model is reachable.
export async function aiPlanMessage(plan, state) {
  try {
    const ai = await resolveAI(state);
    if (!ai.ok || !plan.blocks.length) return null;
    const text = await streamChat({
      endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `You are ${APP_NAME}, Boss's personal assistant. Reply with plain text only: at most two short sentences, max 40 words, no emojis, no markdown, no clock times. Say "Boss" at most once. Keep every fact — task names, their order and durations.`,
        },
        {
          role: 'user',
          content: `Rewrite this recommendation in your own words: "${plan.message}". The plan in order: ${plan.blocks.map((b) => `${b.title} (${b.minutes} min, ${b.why})`).join('; ')}.`,
        },
      ],
    });
    const clean = text?.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ');
    return clean && clean.length > 20 && clean.length < 320 ? clean : null;
  } catch {
    return null;
  }
}

// MITH NOW, second opinion. The rule-based engine has already chosen; the model
// sees the same window, the pick and the alternatives and may (a) keep it or
// swap in an alternative that genuinely fits better and (b) write one short
// line explaining the call in Myth's voice. Anything outside the candidate
// list is ignored, so the model can steer but never invent work. Null when no
// model is reachable, slow (>12 s) or returns junk — the rule-based answer stays.
export async function aiMithNow(result, state) {
  try {
    const ai = await resolveAI(state);
    if (!ai.ok || (!result.primary && !result.quick.length)) return null;
    const brief = nowBrief(result);
    const text = await Promise.race([
      streamChat({
        endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: `You are ${APP_NAME}, Boss's personal assistant, giving real-time decision support. It is ${dayjs().format('dddd h:mm A')}. Reply with ONLY a JSON object, no prose, no markdown fences: {"pick":"<task id>","note":"<one sentence, max 28 words, plain text, no emojis, says 'Boss' at most once>"}. "pick" must be the id of the recommended task or one of the alternatives — choose an alternative only if it clearly fits the minutes available better or is more urgent. The note explains why this is the best use of the time and, if there are quick wins, how the remaining minutes get used. Never mention ids.`,
          },
          { role: 'user', content: `Decision brief: ${JSON.stringify(brief)}` },
        ],
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 12000)),
    ]);
    const json = text?.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json);
    const valid = new Set([result.primary?.id, ...result.alternatives.map((a) => a.id)].filter(Boolean));
    const pick = valid.has(parsed.pick) ? parsed.pick : result.primary?.id ?? null;
    const note = String(parsed.note ?? '').replace(/\s+/g, ' ').trim();
    return { pick, note: note.length > 12 && note.length < 260 ? note : null, model: ai.model };
  } catch {
    return null;
  }
}

// Summarize a meeting note into crisp minutes + action items.
export async function aiMeetingSummary(note, state) {
  const ai = await resolveAI(state);
  if (!ai.ok) return null;
  const m = note.meeting ?? {};
  const text = await streamChat({
    endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey,
    messages: [
      { role: 'system', content: 'You summarize meeting notes into short, plain-text minutes. No markdown symbols, no emojis.' },
      {
        role: 'user',
        content: `Summarize this meeting in up to 5 short lines, then list action items as "- owner: action" lines.\nTitle: ${note.title}\nDate: ${m.date ?? ''} ${m.time ?? ''}\nParticipants: ${m.participants ?? ''}\nAgenda/discussion: ${m.agenda ?? ''}\nAction items noted: ${m.actions ?? ''}\nExtra notes: ${note.body ?? ''}`,
      },
    ],
  });
  return text ? { text, model: ai.model } : null;
}

// Tailor a project template to the user's own sentence. Returns milestone
// templates (validated by normalizeAiPlan) or null — the built-in template
// stays when the model is slow, offline or returns junk. Never throws.
export async function aiProjectPlan(intent, state) {
  try {
    const ai = await resolveAI(state);
    if (!ai.ok) return null;
    const tpl = TEMPLATES[intent.template] ?? TEMPLATES.generic;
    const text = await Promise.race([
      streamChat({
        endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: 'You plan projects. Reply with ONLY a JSON object, no prose, no markdown fences: {"milestones":[{"title":"...","tasks":["...","..."]}]}. 5-7 milestones in chronological order, 3-5 short imperative tasks each, at most 30 tasks in total. Be specific to this project — no generic filler.',
          },
          {
            role: 'user',
            content: `Project: "${intent.name}". The person said: "${intent.text}". Deadline: ${intent.deadline}. A default "${tpl.label}" plan would be: ${tpl.milestones.map((m) => m.title).join(' → ')}. Tailor the milestones and tasks to this specific project.`,
          },
        ],
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    const json = text?.match(/\{[\s\S]*\}/)?.[0];
    return json ? normalizeAiPlan(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

export async function askAssistant(q, store, onToken) {
  const state = store.getState();
  const trimmed = q.trim();

  // ---- automatic project creation ----
  // "create project" / "yes" confirms the pending proposal; "discard the proposal" drops it;
  // a sentence that describes an undertaking drafts a new one (nothing is created yet).
  if (state.pendingProposal) {
    if (/^(?:create|make|confirm|approve|build|go ahead with)\s+(?:the\s+|this\s+|that\s+|it\s+)?(?:project|plan|proposal)?\s*[.!]?$/i.test(trimmed) || /^(?:yes|ok|okay|sure|confirm|go ahead|do it|create it|make it|approve)[.!]?$/i.test(trimmed)) {
      const res = state.createProposedProject();
      return `Created "${res.project.name}", Boss ✅ — ${res.milestoneCount} milestones and ${res.taskCount} tasks, deadline ${dayjs(res.project.deadline).format('ddd, MMM D')}. It's in Projects; the first tasks are already on your list.`;
    }
    if (/^(?:discard|cancel|drop|forget|scrap|no|not now|never mind)\b/i.test(trimmed) && /\b(?:proposal|project|plan|it|now|mind)\b|^no$/i.test(trimmed)) {
      state.discardProposal();
      return 'Proposal discarded — nothing was created, Boss.';
    }
  }
  const projectIntent = detectProjectIntent(q);
  if (projectIntent) {
    const plan = state.proposeProject(q, projectIntent);
    return describePlan(plan);
  }

  // "add <thing> to today's plan" / "put <thing> on my plan"
  const planAdd = q.match(/^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?(?:today'?s?\s+)?plan\s*$/i);
  if (planAdd) {
    state.addPlanItems([planAdd[1].trim()]);
    return `Added to today's plan, Boss ✅ — "${planAdd[1].trim()}"`;
  }

  // "add follow-up task" — the Context Engine picks the meeting that still needs one
  if (/^(?:add|create|make)\s+(?:a\s+)?follow[- ]?up/i.test(q.trim())) {
    const target = followUpsNeeded(state, 7)[0] ?? upcomingMeetingContexts(state, 7).find((u) => !u.ctx.followUpTask);
    if (!target) return 'Every recent meeting already has a follow-up, Boss.';
    const due = createFollowUpTask(store, target.ctx);
    return `Follow-up task added for "${target.ctx.node.label}" — due ${dayjs(due).format('ddd, MMM D')} ✅`;
  }

  // "plan: review designs" — direct plan capture
  if (/^(?:plan|today'?s?\s+plan|my\s+plan)[:\-]/i.test(q.trim())) {
    const parsed = parseCapture(q, state.projects);
    if (parsed) return executeCapture(parsed, store);
  }

  // "mark <item> done" / "complete <item>" — ticks a plan pill or completes a matching task
  const markDone = q.match(/^(?:mark|tick|check(?:\s+off)?|complete|finish|done)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete[d]?))?\s*$/i);
  if (markDone && !/^(?:done|complete|finish)$/i.test(markDone[1])) {
    const phrase = markDone[1].replace(/\s+(?:in|on|from)\s+(?:my\s+|the\s+|today'?s?\s+)?plan$/i, '').trim().toLowerCase();
    const planItem = todayPlanItems(state).find((i) => !i.done && i.text.toLowerCase().includes(phrase));
    if (planItem) {
      state.togglePlanItem(planItem.id);
      const left = todayPlanItems(store.getState()).filter((i) => !i.done).length;
      return `"${planItem.text}" ticked off today's plan ✅${left ? ` — ${left} to go.` : ' — that was the last one. All done today, Boss! 🎉'}`;
    }
    const task = state.tasks.find((t) => t.status !== 'done' && t.title.toLowerCase().includes(phrase));
    if (task) {
      state.completeTask(task.id);
      return `Task "${task.title}" marked done ✅`;
    }
  }

  // "follow the plan" / "apply your plan" — put the Command Center's focus blocks on today's calendar
  if (/^(?:follow|apply|accept|go with|set|start)\s+(?:the\s+|your\s+|my\s+|myth'?s?\s+|mith'?s?\s+|today'?s?\s+)?plan\b/i.test(q.trim())) {
    const cc = commandCenter(state);
    if (!cc.plan.blocks.length) {
      if (cc.active?.remaining) return `The plan is already on today's calendar, Boss — ${cc.active.remaining} block${cc.active.remaining === 1 ? '' : 's'} to go.`;
      return `Nothing to schedule right now, Boss. ${cc.plan.message}`;
    }
    state.applyPlan(cc.plan.blocks);
    return [
      `Plan set, Boss ✅ — ${cc.plan.blocks.length} focus block${cc.plan.blocks.length === 1 ? '' : 's'} on today's calendar:`,
      ...cc.plan.blocks.map((b) => `${b.start}–${b.end}  ${b.title}`),
    ].join('\n');
  }
  if (/^(?:clear|cancel|drop|remove)\s+(?:the\s+|my\s+|today'?s?\s+)?(?:plan|focus blocks?)\b/i.test(q.trim())) {
    state.clearFocusBlocks();
    return "Today's focus blocks are cleared, Boss. Ask \"what matters now\" whenever you want a fresh plan.";
  }

  // If the message looks like a capture command, capture it.
  if (/^(add|create|new)\s+(task|note|idea|habit|meeting|project|event|expense|income|learning|journal)\b/i.test(q)) {
    const cleaned = q.replace(/^(add|create|new)\s+/i, '');
    const parsed = parseCapture(cleaned, state.projects);
    if (parsed) return executeCapture(parsed, store);
  }

  const local = localAnswer(q, state);
  // Prefer the LLM (configured endpoint, or auto-detected local Ollama); fall back to the local brain.
  try {
    const llm = await llmAnswer(q, state, onToken, state.chat);
    if (llm) return llm;
  } catch {
    if (local) return local + '\n\n(⚠ AI model unreachable — answered locally)';
    return '⚠ Boss, my AI model is unreachable. Check Settings → AI brain (endpoint, model and API key), or ask me about tasks, priorities, reports, habits, or expenses — I can answer those offline.';
  }
  if (local) return local;
  return `Boss, I can answer things like:\n• "What are my priorities today?"\n• "Generate my monthly report"\n• "What's overdue?"\n• "How much did I spend this month?"\n\nMy AI brain seems offline right now (I normally connect to a free AI automatically). Check your internet, or pick a provider in Settings → AI brain. ✨`;
}
