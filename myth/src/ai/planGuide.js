// The playbook for every non-trip plan. The template gives dated milestones;
// the model (the planner brain — ChatGPT when a key is set) adds what a
// coach or an organiser would: the weekly training plan, the 7-day menu and
// grocery list, the budget split and run-of-show, the savings schedule, the
// syllabus timetable… Each mode declares the sections it needs; the answer is
// normalized into a small set of shapes the UI renders generically.
import dayjs from 'dayjs';
import { MODES } from './planner.js';

const transport = () => import('./llm.js');
const brain = () => import('./tripGuide.js');

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// [title, kind, columns?] — kinds: list | checklist | table | schedule
export const GUIDE_SPECS = {
  event: {
    hint: 'Think like a wedding / event planner in India: vendors, deposits, timelines, guest logistics.',
    sections: [['Budget split', 'table', ['Item', '₹', 'Notes']], ['Vendor checklist', 'checklist'], ['Run of show', 'schedule', ['Time', 'What', 'Who']], ['Guests & invites', 'list'], ['Risks & backups', 'list']],
  },
  study: {
    hint: 'Think like a top coach for this exam: syllabus weightage, resources people actually use, mocks, revision.',
    sections: [['Week-by-week syllabus', 'table', ['Week', 'Topics', 'Hours']], ['Best resources', 'list'], ['Mock test plan', 'schedule', ['When', 'Mock', 'Goal']], ['Study techniques that work here', 'list'], ['Exam-day checklist', 'checklist']],
  },
  fitness: {
    hint: 'Think like a certified coach: progressive overload, rest, nutrition, injury prevention, realistic for the level given.',
    sections: [['Weekly training plan', 'schedule', ['Day', 'Session', 'Duration']], ['Progression by week', 'table', ['Week', 'Focus', 'Volume']], ['Nutrition & recovery', 'list'], ['Gear', 'checklist'], ['Stop and rest if', 'list']],
  },
  food: {
    hint: 'Think like a dietician: Indian home-cooked meals, realistic portions, the goal and the diet type given, calories and protein per day.',
    sections: [['7-day meal plan', 'table', ['Day', 'Breakfast', 'Lunch', 'Snack', 'Dinner']], ['Grocery list', 'checklist'], ['Daily targets', 'list'], ['Meal-prep plan', 'list'], ['Eating-out rules', 'list']],
  },
  finance: {
    hint: 'Think like a fee-only financial planner in India: the monthly amount needed, where the money should sit (savings account, RD, liquid fund, index SIP), expense cuts, automation.',
    sections: [['Savings schedule', 'table', ['Month', 'Save', 'Cumulative']], ['Where to keep the money', 'list'], ['Expense cuts that add up', 'list'], ['Automation steps', 'checklist'], ['Risks & rules', 'list']],
  },
  business: {
    hint: 'Think like a founder who has done this: validation before spending, real startup costs in ₹, pricing, first 10 customers, Indian compliance basics.',
    sections: [['Validation plan', 'checklist'], ['Startup costs', 'table', ['Item', '₹', 'Notes']], ['Pricing & first customers', 'list'], ['Legal & setup', 'checklist'], ['First-month marketing', 'list']],
  },
  website: {
    hint: 'Think like a senior product engineer: sitemap, stack that fits the person, launch checklist, SEO and analytics.',
    sections: [['Sitemap & pages', 'list'], ['Tech stack & tools', 'list'], ['Week-by-week timeline', 'schedule', ['Week', 'Focus', 'Done when']], ['Launch checklist', 'checklist'], ['SEO, analytics & polish', 'list']],
  },
  writing: {
    hint: 'Think like an editor: a real outline, a word-count schedule that fits the deadline, research, editing passes, publishing.',
    sections: [['Outline', 'list'], ['Writing schedule', 'table', ['Week', 'Words', 'Milestone']], ['Research & sources', 'list'], ['Editing passes', 'checklist'], ['Publishing steps', 'checklist']],
  },
  home: {
    hint: 'Think like an interior contractor in India: room-wise scope, budget split, permits, sequencing, common mistakes.',
    sections: [['Room-by-room scope', 'list'], ['Budget split', 'table', ['Item', '₹', 'Notes']], ['Contractors & permits', 'checklist'], ['Work sequence', 'schedule', ['Week', 'Work', 'Watch out']], ['Common mistakes', 'list']],
  },
  career: {
    hint: 'Think like a career coach and a hiring manager: target roles, the skills gap, profile fixes, interview prep, negotiation.',
    sections: [['Target roles & companies', 'list'], ['Skills gap', 'table', ['Skill', 'Where you are', 'How to close it']], ['Resume & profile fixes', 'checklist'], ['Interview prep plan', 'schedule', ['Week', 'Focus', 'Practice']], ['Negotiation & decision', 'list']],
  },
  routine: {
    hint: 'Think like a habits coach: a realistic daily schedule around the wake/sleep times given, anchors, cues, the minimum version for bad days.',
    sections: [['Daily schedule', 'schedule', ['Time', 'Block', 'Why']], ['Morning & evening rituals', 'list'], ['Weekly rhythm', 'table', ['Day', 'Focus', 'Note']], ['Habit stack', 'checklist'], ['When the day slips', 'list']],
  },
  generic: {
    hint: 'Think like an experienced project lead.',
    sections: [['What done looks like', 'list'], ['Key steps', 'checklist'], ['Resources & people', 'list'], ['Weekly rhythm', 'schedule', ['Week', 'Focus', 'Done when']], ['Risks', 'list']],
  },
};

const str = (v, n = 160) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const arr = (v) => (Array.isArray(v) ? v : []);

function normalizeGuide(json, spec) {
  if (!json || typeof json !== 'object') return null;
  const sections = arr(json.sections).map((s) => {
    const kind = ['list', 'checklist', 'table', 'schedule'].includes(s?.kind) ? s.kind : (Array.isArray(s?.rows) ? 'table' : 'list');
    const out = { title: str(s?.title, 60), kind };
    if (kind === 'table' || kind === 'schedule') {
      out.columns = arr(s.columns).map((c) => str(c, 30)).filter(Boolean).slice(0, 5);
      out.rows = arr(s.rows).map((r) => (Array.isArray(r) ? r.map((c) => str(c, 120)) : typeof r === 'object' && r ? Object.values(r).map((c) => str(c, 120)) : [str(r, 120)])).filter((r) => r.some(Boolean)).slice(0, 16);
      if (!out.columns.length) out.columns = spec.sections.find(([t]) => t === out.title)?.[2] ?? [];
      if (!out.rows.length) return null;
    } else {
      out.items = arr(s.items).map((i) => str(typeof i === 'object' && i ? (i.text ?? i.title ?? Object.values(i).join(' — ')) : i, 200)).filter(Boolean).slice(0, 14);
      if (!out.items.length) return null;
    }
    return out.title ? out : null;
  }).filter(Boolean).slice(0, 10);
  if (sections.length < 2) return null;
  return { summary: str(json.summary, 500), sections, tips: arr(json.tips).map((t) => str(t, 200)).filter(Boolean).slice(0, 8) };
}

/**
 * Ask the planner brain for the mode's playbook. session: { mode, input, title };
 * plan: the milestone plan (titles + dues give the model the timeline). Null when offline / junk.
 */
export async function aiPlanGuide(session, plan, state) {
  try {
    const { resolvePlannerAI } = await brain();
    const ai = await resolvePlannerAI(state);
    if (!ai.ok) return null;
    const { streamChat } = await transport();
    const spec = GUIDE_SPECS[session.mode] ?? GUIDE_SPECS.generic;
    const mode = MODES[session.mode] ?? MODES.generic;
    const schema = spec.sections.map(([title, kind, cols]) => `{"title":"${title}","kind":"${kind}"${kind === 'table' || kind === 'schedule' ? `,"columns":${JSON.stringify(cols)},"rows":[["…"]]` : ',"items":["…"]'}}`).join(',');
    const text = await withTimeout(streamChat({
      endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 0.45,
      messages: [
        {
          role: 'system',
          content: [
            `You write practical plans for one person. ${spec.hint}`,
            'Reply with ONLY one JSON object, no prose, no markdown fences:',
            `{"summary":"2-3 sentences on the approach","sections":[${schema}],"tips":["…"]}`,
            'Keep every section in that order with exactly those titles and kinds. Tables and schedules: every row is an array of short strings matching the columns, 5-12 rows. Lists and checklists: 4-10 short concrete items each. Amounts in Indian rupees. Be specific to the details given — no generic filler. 4-6 tips.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `${mode.label} plan: "${session.title}". Details: ${JSON.stringify({ ...session.input, text: undefined })}. Timeline: ${plan.milestones.map((m) => `${m.title} by ${dayjs(m.due).format('MMM D')}`).join('; ')}. Today: ${dayjs().format('YYYY-MM-DD')}.`,
        },
      ],
    }), 70000);
    const a = text?.indexOf('{') ?? -1;
    const b = text?.lastIndexOf('}') ?? -1;
    if (a < 0 || b <= a) return null;
    let json = null;
    try { json = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
    const guide = normalizeGuide(json, spec);
    return guide ? { ...guide, model: ai.model, dedicated: !!ai.dedicated, at: new Date().toISOString() } : null;
  } catch {
    return null;
  }
}
