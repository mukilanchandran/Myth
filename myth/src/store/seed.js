// First-run auto-setup: creates a working dataset so every module is alive
// from the first login. Everything is editable/deletable afterwards.
import dayjs from 'dayjs';

export function seedIfNeeded(store) {
  const s = store.getState();

  // v2 additions (learning pipeline) — runs once even for already-seeded users
  if (!s.settings.seededV2) {
    if (!s.learning.length) {
      s.addLearning('Design tokens pipeline');
      s.addLearning('Motion design basics');
      s.addLearning('Figma variables & modes');
      s.addLearning('Accessibility WCAG 2.2');
      const st = store.getState();
      const stages = { 'Figma variables & modes': 1, 'Accessibility WCAG 2.2': 2 };
      store.setState({
        learning: st.learning.map((l) => (stages[l.title] != null ? { ...l, stage: stages[l.title] } : l)),
      });
    }
    s.setSettings({ seededV2: true });
  }

  seedContextDemo(store);

  if (s.settings.seeded) return;

  const d = (n) => dayjs().add(n, 'day').format('YYYY-MM-DD');

  // --- projects ---
  const p1 = s.addProject({ name: 'Myth Platform', desc: 'Personal OS — design & build', color: '#12a150' });
  const p2 = s.addProject({ name: 'Client Dashboard Redesign', desc: 'SaaS analytics dashboard UX revamp', color: '#1971c2' });
  const p3 = s.addProject({ name: 'Home Renovation', desc: 'Hall + balcony refresh', color: '#e8590c' });

  // --- tasks ---
  s.addTask({ title: 'Finalize landing page glass UI', projectId: p1.id, priority: 5, due: d(1), status: 'doing' });
  s.addTask({ title: 'Wireframes for reports module', projectId: p1.id, priority: 4, due: d(3) });
  s.addTask({ title: 'Competitor analysis — 3 dashboards', projectId: p2.id, priority: 3, due: d(5) });
  s.addTask({ title: 'Prepare design review deck', projectId: p2.id, priority: 4, due: d(2) });
  s.addTask({ title: 'Update portfolio with GIS project', priority: 2, due: d(10) });

  s.addTask({ title: 'Book dentist appointment', priority: 4, due: d(2) });
  s.addTask({ title: 'Renew bike insurance', priority: 5, due: d(6) });
  s.addTask({ title: 'Buy paint samples', projectId: p3.id, priority: 3, due: d(4) });

  // --- notes / ideas / meeting ---
  s.addNote({ title: 'AI-powered field survey app for farmers', type: 'idea' });
  s.addNote({ title: 'Weekend trip — Ooty or Kodaikanal?', type: 'idea' });
  s.addNote({
    title: 'Sprint kickoff with product team', type: 'meeting', projectId: p2.id,
    meeting: { date: d(0), time: '10:30', participants: 'PM, Dev lead, Me', agenda: 'Scope Q3 redesign', actions: 'Share moodboard by Friday' },
  });
  s.addNote({ title: 'Figma auto-layout wrap trick', body: 'Use min-width on children to control wrap breakpoints.', type: 'note' });

  // --- habits ---
  const habitDefs = [
    { name: 'Drink 3L water', icon: 'water' }, { name: 'Workout', icon: 'workout' },
    { name: 'Read 20 min', icon: 'read' }, { name: 'Meditation', icon: 'meditate' },
    { name: 'No junk food', icon: 'eat' },
  ];
  habitDefs.forEach((h) => s.addHabit(h));
  // backfill some history so charts are alive
  const st = store.getState();
  st.habits.forEach((h, i) => {
    for (let back = 1; back <= 14; back++) {
      if ((back + i) % (2 + (i % 2)) !== 0) {
        const date = dayjs().subtract(back, 'day').format('YYYY-MM-DD');
        store.setState((prev) => ({
          habits: prev.habits.map((x) => (x.id === h.id ? { ...x, log: { ...x.log, [date]: true } } : x)),
        }));
      }
    }
  });

  // --- finance ---
  s.addTransaction({ type: 'income', amount: 85000, category: 'Salary', note: 'Monthly salary', date: dayjs().startOf('month').format('YYYY-MM-DD') });
  s.addTransaction({ type: 'expense', amount: 15000, category: 'Home & Bills', note: 'Rent', date: dayjs().startOf('month').add(1, 'day').format('YYYY-MM-DD') });
  s.addTransaction({ type: 'expense', amount: 2400, category: 'Groceries', note: 'Weekly groceries', date: d(-3) });
  s.addTransaction({ type: 'expense', amount: 640, category: 'Food', note: 'Team lunch', date: d(-2) });
  s.addTransaction({ type: 'expense', amount: 1199, category: 'Entertainment', note: 'Annual Spotify', date: d(-1) });

  // --- events ---
  s.addEvent({ title: "Amma's birthday", date: dayjs().add(12, 'day').format('YYYY-MM-DD'), kind: 'birthday', yearly: true });
  s.addEvent({ title: 'Electricity bill', date: d(7), kind: 'bill' });
  s.addEvent({ title: 'Design review', date: d(2), time: '15:00', kind: 'meeting' });

  // --- journal ---
  s.upsertJournal({ date: d(-1), mood: 4, energy: 4, gratitude: 'Good progress on the platform build', reflection: 'Deep work morning went well.', wins: 'Shipped login flow' });

  store.getState().setSettings({ seeded: true });
  seedContextDemo(store);
}

// Context Engine demo (runs once, also for already-seeded users): a client thread
// with history, so the landing-page briefing has something real to say.
function seedContextDemo(store) {
  const s = store.getState();
  if (s.settings.seededV3) return;
  const day = (n) => dayjs().add(n, 'day').format('YYYY-MM-DD');
  const proj = s.projects.find((p) => /client dashboard/i.test(p.name)) ?? s.projects[0] ?? null;
  if (!proj) return; // first run: the main seed creates the projects, then calls back in
  if (!s.notes.some((n) => n.type === 'meeting' && /walkthrough/i.test(n.title))) {
    s.addNote({
      title: 'Client review — dashboard v1', type: 'meeting', projectId: proj.id, created: dayjs().subtract(9, 'day').toISOString(),
      meeting: {
        date: day(-9), time: '11:00', participants: 'Ravi (Acme), Priya (PM), Me', location: 'Acme office, Guindy',
        agenda: 'Walked through v1. KPI cards need rework; Ravi wants a PDF export for board decks.',
        actions: '[x] Send meeting recap to Ravi\nShare updated moodboard with Acme\nCollect final KPI list from Ravi\nEstimate PDF export effort',
      },
    });
    s.addNote({
      title: 'Client meeting — dashboard v2 walkthrough', type: 'meeting', projectId: proj.id,
      meeting: { date: day(1), time: '10:00', participants: 'Ravi (Acme), Me', location: 'Acme office, Guindy', agenda: 'Present v2 KPI cards; agree on export scope and launch date.', actions: '' },
    });
    s.addEvent({ title: 'Client meeting — dashboard v2 walkthrough', date: day(1), time: '10:00', kind: 'meeting' });
    s.addNote({ title: 'Acme dashboard — export options', type: 'note', projectId: proj.id, body: 'PDF export via headless render vs. CSV-only. Ravi prefers PDF for board decks; CSV is a quick win.' });
    s.addDriveItem({ kind: 'link', title: 'Client dashboard — Figma v2', url: 'https://www.figma.com/file/client-dashboard-v2', tags: ['client dashboard redesign', 'acme'] });
    s.addDriveItem({ kind: 'text', title: 'Acme KPI list (draft)', body: 'Revenue, active users, churn, NPS — final list pending from Ravi.', tags: ['acme', 'client dashboard'] });
  }
  s.setSettings({ seededV3: true });
}
