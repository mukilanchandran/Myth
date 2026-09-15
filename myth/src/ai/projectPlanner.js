// Automatic project creation — "I need to launch my portfolio website next
// month" becomes a proposed project: milestones, dated tasks, a deadline.
// Nothing is written to the store until the user confirms; the proposal is
// the product here, not the project. Pure functions so the same logic runs
// in the capture bar, the assistant and node tests.
import * as chrono from 'chrono-node';
import dayjs from 'dayjs';

// ---------- what counts as a project ----------
// Verbs that describe undertaking something, not a single errand.
const STRONG_VERBS = /^(?:launch|build|create|start|plan|organi[sz]e|redesign|develop|set\s+up|publish|renovate|remodel|host|ship|release|migrate|open|throw|grow|rebrand|relaunch|kick\s*off|run|prepare\s+for|train\s+for|study\s+for|apply\s+for|write|record|produce|film|shoot|design|move\s+to|move\s+into|relocate|switch\s+to|pass|clear|learn|master)\b/i;
// Verbs that only make it a project when the object is clearly a deliverable.
const WEAK_VERBS = /^(?:finish|complete|make|get|do|deliver|wrap\s+up|revamp|improve|fix\s+up|upgrade|land|become)\b/i;
// The sentence openers people use for intentions.
const INTENT_LEAD = /^(?:i\s+(?:need|want|have|would\s+like|plan|intend|hope|'d\s+like|'m\s+planning|am\s+planning|'m\s+going|am\s+going|'m\s+hoping|am\s+hoping)\s+to|i\s+(?:should|must|gotta|have\s+got\s+to)|we\s+(?:need|want|plan|have)\s+to|help\s+me(?:\s+to)?|let'?s|my\s+goal\s+is\s+to|goal[:-]\s*|planning\s+to|going\s+to)\s+/i;
const EXPLICIT_PROJECT = /^(?:new|start|create|plan|set\s+up|kick\s*off)\s+(?:a\s+|the\s+)?project\b[:\s-]*(.*)$|^project[:-]\s*(.+)$/i;
// Things the other capture engines own — never a project.
const NOT_PROJECT = /\b(?:habit|routine|every\s*day|everyday|daily|each\s+day|spent|paid|received|salary)\b|₹|\brs\.?\s*\d/i;

// Deliverable words → plan template. Order matters: first match wins.
const DELIVERABLES = [
  ['event', /\b(?:wedding|marriage|reception|engagement|party|conference|meetup|workshop|hackathon|summit|webinar|reunion|festival|ceremony|celebration|fundraiser|exhibition|expo|event)\b/i],
  ['travel', /\b(?:trip|travel|vacation|holiday|tour|backpacking|road\s*trip|honeymoon|pilgrimage|expedition)\b/i],
  ['home', /\b(?:renovat\w*|remodel\w*|interior|kitchen|bathroom|balcony|garden|house|home\s+(?:office|setup|makeover)|apartment|flat|new\s+home|move\s+(?:house|home|to\s+a\s+new)|relocat\w*)\b/i],
  ['content', /\b(?:book|novel|ebook|e-book|memoir|thesis|dissertation|research\s+paper|paper|newsletter|podcast|youtube\s+channel|channel|blog|documentary|album|screenplay|manuscript|whitepaper|case\s+study)\b/i],
  ['website', /\b(?:website|web\s*site|site|portfolio|landing\s+page|web\s+app|webapp|app|application|mobile\s+app|ios\s+app|android\s+app|product|saas|platform|dashboard|prototype|mvp|software|tool|plugin|extension|game|bot|api)\b/i],
  ['business', /\b(?:business|startup|company|shop|store|brand|agency|freelanc\w*|side\s+hustle|cafe|café|restaurant|bakery|studio|consultancy|venture|firm|boutique|food\s+truck|online\s+store|e-?commerce)\b/i],
  ['marketing', /\b(?:campaign|marketing|advertis\w*|social\s+media|brand\s+launch|rebrand\w*|awareness|promotion|outreach|content\s+strategy)\b/i],
  ['career', /\b(?:job|career|role|position|promotion|interview\s+prep|job\s+search|job\s+hunt|switch\s+jobs|new\s+job|internship|placement)\b/i],
  ['learning', /\b(?:exam|certification|certificate|certified|degree|diploma|syllabus|course|gate|neet|jee|upsc|ielts|toefl|gre|gmat|board\s+exams?|learn\w*|master(?:ing)?|fluen\w*|study(?:ing)?)\b/i],
  ['fitness', /\b(?:marathon|half\s+marathon|10k|5k|triathlon|ironman|fitness|get\s+fit|lose\s+\d+\s*kg|weight\s+loss|gain\s+muscle|trek|cycling\s+tour|swim\w*)\b/i],
];

const SMALL = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'at', 'by', 'with', 'my', 'our']);
export const titleCase = (s) =>
  s
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

// ---------- deadline ----------
// "next month" means the end of next month for a project, not the same day a
// month from now (chrono's literal reading); "by end of year" isn't parsed by
// chrono at all. Everything else — "in 6 weeks", "by Oct 15" — is chrono's.
const UNIT_END = /\b(?:by\s+|before\s+|until\s+)?(?:the\s+)?end\s+of\s+(?:the\s+|this\s+|next\s+)?(week|month|quarter|year)\b/i;
const MONTHS = /^(?:in\s+|by\s+|before\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)$/i;

function unitEnd(now, unit, next) {
  if (unit === 'quarter') {
    const q = Math.floor(now.month() / 3) + (next ? 1 : 0);
    return now.startOf('year').add(q * 3 + 2, 'month').endOf('month');
  }
  return (next ? now.add(1, unit) : now).endOf(unit);
}

export function extractDeadline(text, now = dayjs()) {
  const endMatch = text.match(UNIT_END);
  if (endMatch) {
    return { deadline: unitEnd(now, endMatch[1].toLowerCase(), /next/i.test(endMatch[0])).format('YYYY-MM-DD'), phrase: endMatch[0] };
  }
  const results = chrono.parse(text, now.toDate(), { forwardDate: true });
  if (!results.length) return { deadline: null, phrase: '' };
  const r = results[0];
  const phrase = r.text;
  let d = dayjs(r.start.date());
  const unitMatch = phrase.match(/^(next|this|coming)\s+(week|month|quarter|year)$/i);
  if (unitMatch) d = unitEnd(now, unitMatch[2].toLowerCase(), /next|coming/i.test(unitMatch[1]));
  else if (MONTHS.test(phrase)) d = d.endOf('month'); // "in December" → the whole month is the runway
  else if (/^(?:this|next)\s+(?:spring|summer|autumn|fall|winter)$/i.test(phrase)) d = d.add(2, 'month').endOf('month');
  if (d.isBefore(now, 'day')) return { deadline: null, phrase };
  return { deadline: d.format('YYYY-MM-DD'), phrase };
}

// ---------- intent detection ----------
// Returns null for ordinary captures (a task, an expense, a question) and a
// description of the project for sentences that describe an undertaking.
export function detectProjectIntent(raw, now = dayjs()) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/[.!\s]+$/, '');
  if (text.length < 8 || /\?\s*$/.test(text)) return null;
  // the other capture engines own these ("plan: x" is a plan pill; "plan a trip" is fine)
  if (/^(?:idea|note|habit|journal|diary|remind\s+me|learn|study|practice)\b|^(?:plan|today'?s?\s+plan|my\s+plan)[:-]/i.test(text)) return null;
  if (NOT_PROJECT.test(text)) return null;

  const { deadline, phrase } = extractDeadline(text, now);
  const withoutDate = phrase
    ? text.replace(phrase, ' ').replace(/\s{2,}/g, ' ').replace(/\s*\b(?:by|before|until|in|on|for|around|within)\s*$/i, '').trim()
    : text;
  const horizonDays = deadline ? dayjs(deadline).diff(now.startOf('day'), 'day') : null;

  // 1) explicit — "new project: Acme redesign", "project: bakery"
  const explicit = withoutDate.match(EXPLICIT_PROJECT);
  if (explicit) {
    const name = (explicit[1] ?? explicit[2] ?? '')
      .replace(/^(?:called|named|for|on|about|to)\s+/i, '')
      .replace(/^(?:my|our|a|an|the)\s+/i, '')
      .replace(/^["'“]|["'”]$/g, '')
      .trim();
    if (!name) return null;
    return finish({ text, name, object: name, deadline, template: templateFor(name), confidence: 1, reason: 'explicit' }, now);
  }

  // 2) intention — "I need to launch my portfolio website next month"
  let object = withoutDate.replace(INTENT_LEAD, '').trim();
  const hadLead = object !== withoutDate;
  object = object.replace(/^to\s+/i, '');
  const strong = STRONG_VERBS.test(object);
  const weak = !strong && WEAK_VERBS.test(object);
  if (!strong && !weak) return null;

  const verb = object.match(strong ? STRONG_VERBS : WEAK_VERBS)[0];
  const rest = object.slice(verb.length).replace(/^\s*(?:a|an|the|my|our|this|that|new|another|up)\s+/i, '').trim();
  const words = rest.split(/\s+/).filter(Boolean).length;
  if (!rest || words > 12) return null;
  const template = templateFor(object);

  let confidence = 0;
  if (/^(?:learn|master|study\s+for)/i.test(verb)) confidence = deadline ? 0.7 : 0; // "learn Spanish" alone is a learning item
  else if (strong && template !== 'generic') confidence = hadLead ? 0.9 : 0.75;
  else if (weak && template !== 'generic' && (deadline || hadLead)) confidence = 0.65;
  else if (strong && hadLead && words >= 3 && (horizonDays == null || horizonDays >= 14) && (horizonDays != null || /\bproject\b/i.test(text))) confidence = 0.6;
  if (confidence < 0.6) return null;

  const name = rest.replace(/\bproject\b/i, '').replace(/\s{2,}/g, ' ').trim();
  if (!name) return null;
  return finish({ text, name, object: `${verb} ${rest}`, deadline, template, confidence, reason: hadLead ? 'intention' : 'verb' }, now);
}

function templateFor(text) {
  for (const [key, rx] of DELIVERABLES) if (rx.test(text)) return key;
  return 'generic';
}

function finish(intent, now) {
  const tpl = TEMPLATES[intent.template] ?? TEMPLATES.generic;
  return {
    ...intent,
    name: titleCase(intent.name),
    deadline: intent.deadline ?? now.add(tpl.horizonWeeks, 'week').format('YYYY-MM-DD'),
    deadlineGuessed: !intent.deadline,
  };
}

// ---------- templates ----------
// {name} is replaced with the project name. Weights spread the milestones
// across the runway; a heavier milestone gets more calendar time.
export const TEMPLATES = {
  website: {
    label: 'Website / app launch', horizonWeeks: 6,
    milestones: [
      { title: 'Research', weight: 1, tasks: ['Define the goal and audience for {name}', 'Collect 5 reference sites and note what works', 'List must-have pages and features', 'Pick the tech stack and hosting'] },
      { title: 'Content', weight: 1.5, tasks: ['Write the site map and page outline', 'Draft copy for every page', 'Gather images, logos and project screenshots', 'Write the bio / about section'] },
      { title: 'Design', weight: 1.5, tasks: ['Sketch wireframes for key pages', 'Choose typography and colour palette', 'Design the home page', 'Design inner pages and mobile layouts'] },
      { title: 'Development', weight: 2.5, tasks: ['Set up the repository and project skeleton', 'Build the layout and navigation', 'Build every page from the designs', 'Add contact form / integrations', 'Make it responsive and accessible'] },
      { title: 'Testing', weight: 1, tasks: ['Test on phone, tablet and desktop', 'Fix broken links, typos and slow pages', 'Run a performance and SEO check', 'Ask two people for feedback and act on it'] },
      { title: 'Launch', weight: 0.5, tasks: ['Connect the domain and SSL', 'Deploy to production', 'Announce {name} on your channels', 'Set up analytics and review after a week'] },
    ],
  },
  event: {
    label: 'Event', horizonWeeks: 8,
    milestones: [
      { title: 'Concept & budget', weight: 1, tasks: ['Decide the purpose, size and vibe of {name}', 'Set the budget and who pays for what', 'Pick 2-3 candidate dates', 'Draft the guest list'] },
      { title: 'Venue & date', weight: 1.5, tasks: ['Shortlist and visit venues', 'Confirm the date with key people', 'Book the venue and pay the deposit', 'Plan travel and stay for outstation guests'] },
      { title: 'Guests & invites', weight: 1.5, tasks: ['Finalise the guest list', 'Design and send invitations', 'Track RSVPs', 'Arrange dress code / outfits'] },
      { title: 'Vendors & logistics', weight: 2, tasks: ['Book catering and finalise the menu', 'Book photographer / videographer', 'Arrange decor, sound and lighting', 'Plan transport and parking', 'Confirm every vendor a week before'] },
      { title: 'Programme', weight: 1, tasks: ['Write the run-of-show timeline', 'Assign roles to family / team', 'Prepare speeches, playlists or presentations', 'Print signage, menus and name cards'] },
      { title: 'Event day & wrap-up', weight: 0.5, tasks: ['Do a final walkthrough of the venue', 'Run the day from the timeline', 'Settle vendor payments', 'Send thank-you notes and share photos'] },
    ],
  },
  content: {
    label: 'Writing / publishing', horizonWeeks: 10,
    milestones: [
      { title: 'Outline', weight: 1, tasks: ['Write a one-paragraph pitch for {name}', 'Define the audience and the promise', 'Outline chapters / episodes', 'Set a word or episode target'] },
      { title: 'Research', weight: 1.5, tasks: ['Collect sources, references and examples', 'Interview or consult 2-3 people', 'Organise notes by chapter', 'Fill the gaps in the outline'] },
      { title: 'Draft', weight: 3, tasks: ['Write the first third', 'Write the second third', 'Write the final third', 'Keep a daily writing streak'] },
      { title: 'Edit & review', weight: 2, tasks: ['Self-edit for structure and flow', 'Get feedback from 2 readers', 'Second pass: line edits', 'Proofread the final text'] },
      { title: 'Design & format', weight: 1, tasks: ['Design the cover / artwork', 'Format for the platform (print, ebook, web)', 'Write the blurb and description', 'Prepare a sample chapter / trailer'] },
      { title: 'Publish', weight: 0.5, tasks: ['Set up the publishing account / platform', 'Upload and schedule the release', 'Announce {name}', 'Collect early reviews'] },
    ],
  },
  business: {
    label: 'Business / venture', horizonWeeks: 12,
    milestones: [
      { title: 'Validate the idea', weight: 1.5, tasks: ['Write down the problem {name} solves and for whom', 'Talk to 10 potential customers', 'Study 3 competitors and their pricing', 'Decide the first offering'] },
      { title: 'Plan & budget', weight: 1.5, tasks: ['Write a one-page business plan', 'Estimate startup costs and a 6-month runway', 'Set prices and revenue targets', 'Decide how to fund it'] },
      { title: 'Legal & setup', weight: 1.5, tasks: ['Register the business / GST as needed', 'Open a business bank account', 'Sort licences, permits and insurance', 'Set up invoicing and bookkeeping'] },
      { title: 'Brand & marketing', weight: 2, tasks: ['Choose the name and register the domain', 'Design the logo and brand basics', 'Set up social profiles and a landing page', 'Plan the first month of marketing'] },
      { title: 'Build the offering', weight: 3, tasks: ['Produce / source the first batch or service package', 'Set up suppliers and tools', 'Run a soft launch with friendly customers', 'Fix what the soft launch revealed'] },
      { title: 'Launch', weight: 0.5, tasks: ['Announce the launch', 'Collect the first 10 customers', 'Ask for reviews and referrals', 'Review the numbers after 30 days'] },
    ],
  },
  home: {
    label: 'Home / renovation', horizonWeeks: 8,
    milestones: [
      { title: 'Scope & budget', weight: 1, tasks: ['List what changes in {name} and why', 'Measure the space and take photos', 'Set the budget with a 15% buffer', 'Decide what to DIY vs hire out'] },
      { title: 'Design & materials', weight: 2, tasks: ['Collect reference images into a mood board', 'Draw the layout / plan', 'Choose materials, colours and fixtures', 'Get quotes for materials'] },
      { title: 'Contractors & permits', weight: 1.5, tasks: ['Get 3 contractor quotes', 'Check society / municipal permissions', 'Sign the contract with a schedule', 'Order materials with long lead times'] },
      { title: 'Execution', weight: 3, tasks: ['Clear and protect the space', 'Demolition and structural work', 'Electrical and plumbing', 'Flooring, walls and paint', 'Weekly site check-ins'] },
      { title: 'Finishing', weight: 1.5, tasks: ['Install fixtures and furniture', 'Deep clean', 'Fix the snag list', 'Style and decorate'] },
      { title: 'Handover', weight: 0.5, tasks: ['Final walkthrough with the contractor', 'Settle payments and collect warranties', 'Before / after photos', 'Celebrate {name}'] },
    ],
  },
  learning: {
    label: 'Learning / exam', horizonWeeks: 8,
    milestones: [
      { title: 'Syllabus & plan', weight: 1, tasks: ['Write down the exact goal for {name}', 'Collect the syllabus / curriculum', 'Pick 1-2 core resources', 'Block study time in the week'] },
      { title: 'Fundamentals', weight: 2.5, tasks: ['Cover the first half of the core topics', 'Make one-page notes per topic', 'Do the basic exercises', 'Weekly self-quiz'] },
      { title: 'Practice', weight: 2.5, tasks: ['Cover the second half of the topics', 'Solve past papers / real projects', 'Keep an error log', 'Join a study group or find a mentor'] },
      { title: 'Mock tests', weight: 1.5, tasks: ['Take a full-length mock', 'Review every mistake', 'Second mock under timed conditions', 'Drill the weakest topics'] },
      { title: 'Revision', weight: 1, tasks: ['Revise from the one-page notes', 'Final mock', 'Sort logistics: admit card, venue, tools', 'Rest the day before'] },
      { title: 'Exam / showcase', weight: 0.5, tasks: ['Sit the exam / present the work', 'Note what to do differently next time', 'Update your profile with the result'] },
    ],
  },
  travel: {
    label: 'Trip', horizonWeeks: 6,
    milestones: [
      { title: 'Destination & dates', weight: 1, tasks: ['Decide where and for how long ({name})', 'Agree dates with everyone travelling', 'Apply for leave', 'Set the budget'] },
      { title: 'Bookings', weight: 1.5, tasks: ['Book flights / trains', 'Book stays', 'Check visa, passport validity and insurance', 'Book any must-do experiences'] },
      { title: 'Itinerary', weight: 1.5, tasks: ['Plan a day-by-day outline', 'List food places and sights', 'Plan local transport', 'Share the plan with the group'] },
      { title: 'Documents & packing', weight: 1, tasks: ['Save tickets and IDs offline', 'Arrange currency / cards', 'Make the packing list', 'Sort home: plants, pets, bills'] },
      { title: 'Travel', weight: 0.5, tasks: ['Check in online', 'Pack the day before', 'Enjoy {name}'] },
      { title: 'Wrap-up', weight: 0.5, tasks: ['Back up photos', 'Settle shared expenses', 'Write a short journal of the trip'] },
    ],
  },
  marketing: {
    label: 'Campaign', horizonWeeks: 5,
    milestones: [
      { title: 'Goals & audience', weight: 1, tasks: ['Define what success looks like for {name}', 'Describe the audience and where they are', 'Set the budget', 'Pick the key metric'] },
      { title: 'Messaging & assets', weight: 2, tasks: ['Write the core message and 3 angles', 'Produce visuals / video', 'Write copy for each channel', 'Build the landing page or offer'] },
      { title: 'Channels & schedule', weight: 1.5, tasks: ['Choose channels', 'Build the posting calendar', 'Set up tracking links and analytics', 'Line up partners / influencers'] },
      { title: 'Launch', weight: 1, tasks: ['Publish the first wave', 'Engage with every reply for 48 hours', 'Send the announcement email'] },
      { title: 'Measure & optimise', weight: 1, tasks: ['Review the numbers weekly', 'Double down on what works', 'Write the campaign retro'] },
    ],
  },
  career: {
    label: 'Career move', horizonWeeks: 8,
    milestones: [
      { title: 'Direction', weight: 1, tasks: ['Write what you want from {name}: role, pay, place', 'List 10 target companies or paths', 'Talk to 3 people already there'] },
      { title: 'Profile', weight: 1.5, tasks: ['Rewrite the resume for the target role', 'Update LinkedIn and portfolio', 'Collect 2-3 recommendations', 'Prepare a 2-minute story'] },
      { title: 'Preparation', weight: 2, tasks: ['Study the interview format', 'Practise the top 20 questions', 'Do 2 mock interviews', 'Prepare questions to ask them'] },
      { title: 'Applications', weight: 2, tasks: ['Apply to the first 5 targets', 'Reach out to referrals', 'Track every application', 'Follow up after a week'] },
      { title: 'Interviews & offer', weight: 1.5, tasks: ['Interview and debrief each one', 'Negotiate the offer', 'Decide with a pros / cons list'] },
      { title: 'Transition', weight: 0.5, tasks: ['Give notice and hand over cleanly', 'Plan the first 90 days', 'Celebrate {name}'] },
    ],
  },
  fitness: {
    label: 'Fitness goal', horizonWeeks: 12,
    milestones: [
      { title: 'Baseline & plan', weight: 1, tasks: ['Define the target for {name} and the date', 'Record the current baseline', 'Pick a training plan', 'Sort gear and a place to train'] },
      { title: 'Base building', weight: 3, tasks: ['Train 3-4 times a week for 4 weeks', 'Fix sleep and nutrition basics', 'Log every session'] },
      { title: 'Build', weight: 3, tasks: ['Increase volume by ~10% a week', 'Add one hard session a week', 'Mid-point test against the baseline'] },
      { title: 'Peak', weight: 2, tasks: ['Rehearse the event conditions', 'Sort logistics: registration, travel, kit', 'Plan race-day nutrition'] },
      { title: 'Taper & event', weight: 1, tasks: ['Reduce volume in the final week', 'Do the event', 'Recover and write down what you learned'] },
    ],
  },
  food: {
    label: 'Food & diet', horizonWeeks: 4,
    milestones: [
      { title: 'Targets & kitchen', weight: 1, tasks: ['Write the goal for {name} and the daily calorie / protein target', 'Clear the pantry of the foods that work against it', 'Pick 8-10 go-to meals you actually like', 'Buy containers and basics for meal prep'] },
      { title: 'Week 1 — the routine', weight: 1.5, tasks: ['Cook or prep breakfasts for the week', 'Shop once from the grocery list', 'Log every meal for 7 days', 'Fix one meal that keeps going wrong'] },
      { title: 'Week 2 — variety', weight: 1.5, tasks: ['Add 3 new recipes to the rotation', 'Plan eating-out choices in advance', 'Weekly check-in: weight, energy, sleep', 'Adjust portions to the numbers'] },
      { title: 'Week 3 — make it automatic', weight: 1.5, tasks: ['Batch-cook Sunday: lunches for 4 days', 'Set a snack rule and a water target', 'Cut one thing that still sneaks in', 'Second check-in'] },
      { title: 'Review', weight: 0.5, tasks: ['Compare week 4 with week 1', 'Write down what to keep for good', 'Set the next 4-week target'] },
    ],
  },
  finance: {
    label: 'Money goal', horizonWeeks: 12,
    milestones: [
      { title: 'Know the numbers', weight: 1, tasks: ['Write the target and date for {name}', 'List monthly income and every fixed expense', 'Find the last 3 months of spending by category', 'Decide the monthly amount to set aside'] },
      { title: 'Set up the machine', weight: 1, tasks: ['Open or pick the account / fund where the money goes', 'Automate the transfer on salary day', 'Cancel or downgrade 2 subscriptions', 'Set a weekly spending limit for the leaky categories'] },
      { title: 'Month 1', weight: 2, tasks: ['Hit the month-1 transfer', 'Track spending weekly against the limit', 'Sell or return something unused', 'Month-end review: on track or adjust'] },
      { title: 'Month 2', weight: 2, tasks: ['Hit the month-2 transfer', 'Add one income boost: freelance, bonus, refund', 'Renegotiate one bill (internet, insurance, rent)', 'Month-end review'] },
      { title: 'Month 3 & beyond', weight: 2, tasks: ['Hit the month-3 transfer', 'Move surplus into the goal', 'Protect the goal: no dipping rule', 'Month-end review'] },
      { title: 'Goal day', weight: 0.5, tasks: ['Confirm the balance reached the target', 'Decide what the money does next', 'Celebrate {name} — without spending it'] },
    ],
  },
  routine: {
    label: 'Routine', horizonWeeks: 4,
    milestones: [
      { title: 'Design it', weight: 1, tasks: ['Write the ideal day for {name}: wake, work, move, wind down', 'Pick the 3 anchors that matter most', 'Decide the wake and sleep times', 'Prepare the night before: clothes, desk, alarm'] },
      { title: 'Week 1 — anchors only', weight: 1.5, tasks: ['Do the 3 anchors every day', 'Track each day: done / missed / why', 'Protect the first hour from the phone', 'Friday review: what fought back'] },
      { title: 'Week 2 — add the rest', weight: 1.5, tasks: ['Add the full schedule on weekdays', 'Set one weekend rhythm', 'Fix the block that keeps slipping', 'Friday review'] },
      { title: 'Week 3 — make it stick', weight: 1.5, tasks: ['Pair each block with a cue (coffee → planning)', 'Plan for the bad day: the minimum version', 'Tell someone the routine', 'Friday review'] },
      { title: 'Review', weight: 0.5, tasks: ['Compare week 4 with week 1', 'Keep what works, drop the rest', 'Write the routine as it really is now'] },
    ],
  },
  generic: {
    label: 'Project', horizonWeeks: 6,
    milestones: [
      { title: 'Define & scope', weight: 1, tasks: ['Write one paragraph on what "done" means for {name}', 'List constraints: budget, time, people', 'Decide the first visible outcome'] },
      { title: 'Research', weight: 1, tasks: ['Study how others have done it', 'List what you need to learn or get', 'Talk to someone who has done it'] },
      { title: 'Plan', weight: 1, tasks: ['Break the work into weekly goals', 'Line up tools, people and materials', 'Set a review checkpoint'] },
      { title: 'Build', weight: 3, tasks: ['Complete the first milestone of the work', 'Complete the second milestone', 'Complete the remaining work', 'Weekly progress review'] },
      { title: 'Review', weight: 1, tasks: ['Test or demo the result', 'Collect feedback', 'Fix the gaps'] },
      { title: 'Deliver', weight: 0.5, tasks: ['Finish and hand over / publish', 'Write a short retro', 'Celebrate {name}'] },
    ],
  },
};

// ---------- build the proposal ----------
// Spread milestones across [today, deadline] by weight; tasks within a
// milestone get evenly spaced due dates so the plan reads like a schedule.
// Ids are positional (m0, t0.1) so the sheet can re-schedule when the
// deadline changes without losing which tasks were unticked; real ids are
// minted when the project is created.
export function buildPlan(intent, now = dayjs(), overrides = {}) {
  const base = TEMPLATES[intent.template] ?? TEMPLATES.generic;
  const tpl = overrides.milestones ? { ...base, milestones: overrides.milestones } : base;
  const name = overrides.name ?? intent.name;
  const deadline = dayjs(overrides.deadline ?? intent.deadline);
  const start = now.startOf('day');
  const totalDays = Math.max(7, deadline.diff(start, 'day'));
  const totalWeight = tpl.milestones.reduce((a, m) => a + (m.weight ?? 1), 0);
  const fill = (s) => s.replace(/\{name\}/g, name);

  let cursor = 0;
  const milestones = tpl.milestones.map((m, mi) => {
    const span = (totalDays * (m.weight ?? 1)) / totalWeight;
    const mStart = cursor;
    cursor += span;
    const mEnd = mi === tpl.milestones.length - 1 ? totalDays : cursor;
    const n = m.tasks.length;
    const edge = mi === 0 || mi === tpl.milestones.length - 1;
    const tasks = m.tasks.map((t, ti) => {
      const at = mStart + ((ti + 1) / n) * (mEnd - mStart);
      return { id: `t${mi}.${ti}`, title: fill(t), due: start.add(Math.max(1, Math.round(at)), 'day').format('YYYY-MM-DD'), priority: edge ? 4 : 3 };
    });
    return { id: `m${mi}`, title: fill(m.title), due: start.add(Math.round(mEnd), 'day').format('YYYY-MM-DD'), tasks };
  });

  return {
    name,
    desc: overrides.desc ?? `From: "${intent.text}"`,
    deadline: deadline.format('YYYY-MM-DD'),
    template: intent.template,
    templateLabel: tpl.label,
    horizonWeeks: base.horizonWeeks,
    milestones,
    taskCount: milestones.reduce((a, m) => a + m.tasks.length, 0),
    source: overrides.source ?? 'template',
    intent,
  };
}

// Validate a model-written plan shape → milestone templates (or null).
// Accepts { milestones: [{ title, tasks: [string] }] }, 3-8 milestones,
// 2-6 tasks each, up to 30 tasks. Anything else falls back to the template.
export function normalizeAiPlan(json) {
  const list = Array.isArray(json?.milestones) ? json.milestones : null;
  if (!list || list.length < 3 || list.length > 8) return null;
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const milestones = [];
  for (const m of list) {
    const title = clean(m?.title);
    const tasks = (Array.isArray(m?.tasks) ? m.tasks : [])
      .map((t) => clean(typeof t === 'string' ? t : t?.title))
      .filter((t) => t.length >= 3);
    if (title.length < 3 || tasks.length < 2 || tasks.length > 6) return null;
    milestones.push({ title, weight: 1, tasks });
  }
  if (milestones.reduce((a, m) => a + m.tasks.length, 0) > 30) return null;
  milestones[milestones.length - 1].weight = 0.5; // the finish line gets less runway, like the templates
  return milestones;
}

// ---------- create it ----------
// Writes the project, its milestones and the selected tasks. Returns what was
// made so the caller can confirm it. `selected` is a Set of plan task ids;
// when omitted every task is created.
export function createProjectFromPlan(plan, store, selected = null) {
  const s = store.getState ? store.getState() : store;
  const stamp = Date.now().toString(36);
  const idOf = (m, i) => `${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`;
  const milestoneIds = new Map(plan.milestones.map((m, i) => [m.id, idOf(m, i)]));
  const milestones = plan.milestones.map((m) => ({ id: milestoneIds.get(m.id), title: m.title, due: m.due, done: false }));
  const project = s.addProject({ name: plan.name, desc: plan.desc, deadline: plan.deadline, milestones });

  // addTask prepends, so add in reverse to keep the schedule reading top-down
  const all = plan.milestones.flatMap((m) => m.tasks.map((t) => ({ ...t, milestoneId: milestoneIds.get(m.id) })));
  let taskCount = 0;
  [...all].reverse().forEach((t) => {
    if (selected && !selected.has(t.id)) return;
    s.addTask({ title: t.title, due: t.due, priority: t.priority, projectId: project.id, milestoneId: t.milestoneId, tags: ['plan'] });
    taskCount++;
  });
  s.addXp?.('capture');
  return { project, taskCount, milestoneCount: milestones.length };
}

// Short text the assistant can say about a proposal.
export function describePlan(plan) {
  return [
    `I drafted a plan for "${plan.name}" — ${plan.milestones.length} milestones, ${plan.taskCount} tasks, finishing ${dayjs(plan.deadline).format('ddd, MMM D')}${plan.intent?.deadlineGuessed ? ' (no date in your message, so I assumed one)' : ''}:`,
    ...plan.milestones.map((m, i) => `${i + 1}. ${m.title} — ${m.tasks.length} tasks, by ${dayjs(m.due).format('MMM D')}`),
    '',
    'Nothing is created yet. Review it in the proposal window, or say "create project" to create all of it.',
  ].join('\n');
}
