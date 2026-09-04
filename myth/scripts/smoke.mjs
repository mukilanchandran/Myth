// End-to-end smoke test: builds are assumed done; runs `vite preview`, drives the app with Playwright,
// opens every panel/overlay, exercises the engines in-page against the seeded store, and reports errors.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = 'F:/Myth/myth';
const PORT = 4179;
const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', shell: true });
await new Promise((r) => setTimeout(r, 3500));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const goto = async () => { await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); };
await goto();
// login
const pw = page.locator('input[type=password]');
if (await pw.count()) { await pw.fill('mukilx'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }
await page.waitForFunction(() => window.__myth?.useStore?.getState().authed, null, { timeout: 15000 }).catch(() => errors.push('login failed'));
await page.waitForTimeout(1200);
// keep the automatic briefings out of the way while we screenshot panels
await page.evaluate(() => { const d = new Date().toISOString().slice(0, 10); window.__myth.useStore.getState().setSettings({ lastMorningBrief: d, lastEveningBrief: d }); window.__myth.useUI.getState().closeOverlay(); });
await page.waitForTimeout(1300);
await page.screenshot({ path: path.join(process.env.SHOT_DIR ?? '.', 'home.png'), fullPage: true });

const panels = ['today', 'inbox', 'tasks', 'projects', 'notes', 'people', 'commitments', 'goals', 'timeline', 'calendar', 'drive', 'learning', 'habits', 'finance', 'routines', 'activity', 'asklife', 'analytics', 'lifedebt', 'privacy', 'tags', 'settings', 'reports', 'assistant'];
const results = {};
for (const key of panels) {
  const before = errors.length;
  await page.evaluate((k) => window.__myth.useUI.getState().setPanel(k), key);
  await page.waitForTimeout(900);
  const stub = await page.evaluate(() => document.body.innerText.includes('coming online…'));
  results[key] = { errors: errors.slice(before), stub };
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `panel-${key}.png`) });
  await page.evaluate(() => window.__myth.useUI.getState().closePanel());
  await page.waitForTimeout(250);
}
const overlays = ['brief', 'debrief', 'now', 'focus', 'proposal', 'context', 'voice'];
for (const key of overlays) {
  const before = errors.length;
  await page.evaluate((k) => {
    const s = window.__myth.useStore.getState();
    const props = k === 'context' ? { type: 'project', id: s.projects[0]?.id } : k === 'proposal' ? { text: 'I need to launch my portfolio website next month' } : {};
    window.__myth.useUI.getState().openOverlay(k, props);
  }, key);
  await page.waitForTimeout(900);
  results[`overlay:${key}`] = { errors: errors.slice(before) };
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `overlay-${key}.png`) });
  await page.evaluate(() => window.__myth.useUI.getState().closeOverlay());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

// engines in-page
const engineReport = await page.evaluate(async () => {
  const E = await window.__myth.engine();
  const store = window.__myth.useStore;
  const state = store.getState();
  const out = {};
  const run = (name, fn) => { try { const r = fn(); out[name] = typeof r === 'string' ? r : JSON.stringify(r).slice(0, 220); } catch (e) { out[name] = 'ERROR ' + e.message; } };
  run('graph', () => { const g = E.context.buildGraph(state); return { nodes: g.nodes.length, edges: g.edges.length }; });
  run('meetingCtx', () => E.context.upcomingMeetingContexts(state, 2).map((m) => ({ t: m.entity.title, s: m.ctx.summary })));
  run('morningBrief', () => { const b = E.briefing.morningBrief(state); return { hours: b.hours, focus: b.focus.length, risks: b.risks.length, rec: b.recommendation.length, line: b.line }; });
  run('eveningDebrief', () => { const d = E.briefing.eveningDebrief(state); return { done: d.completed.length, moved: d.moved.length, line: d.line, insights: d.insights }; });
  run('dayPlan', () => { const p = E.planner.buildDayPlan(state); return { blocks: p.blocks.map((b) => `${b.start}-${b.end} ${b.kind}:${b.title}`), free: p.freeMinutes }; });
  run('bestUse', () => E.planner.bestUseOfTime(state).message);
  run('focusWindows', () => E.planner.focusWindows(state, { minutes: 120 }).map((w) => w.label));
  run('pulse', () => E.pulse.pulse(state).dims.map((d) => `${d.label}:${d.status}:${d.note}`));
  run('lifeDebt', () => E.pulse.lifeDebt(state).items.map((i) => `${i.count} ${i.label}`));
  run('procrastination', () => E.pulse.procrastination(state).map((p) => `${p.task.title} x${p.times} ${p.guess}`));
  run('projectHealth', () => state.projects.map((p) => `${p.name}:${E.pulse.projectHealth(state, p).status}`));
  run('notifications', () => E.notifications.smartNotifications(state).map((n) => `${n.level}: ${n.title}`));
  run('subscriptions', () => { const s = E.subscriptions.detectSubscriptions(state); return { n: s.subscriptions.length, monthly: s.monthlyTotal, names: s.subscriptions.map((x) => `${x.name}/${x.cadence}`) }; });
  run('analytics', () => { const a = E.analytics.meAnalytics(state); return { rate: a.execution.completionRate, explain: a.explain.slice(0, 3) }; });
  run('story', () => { const s = E.analytics.monthlyStory(state); return { title: s.title, changed: s.changed, rec: s.recommendation }; });
  run('annual', () => { const a = E.analytics.annualReview(state); return { sub: a.subtitle, changes: a.changes }; });
  run('modes', () => E.modes.effectiveMode(state));
  run('routinesDue', () => E.routines.dueRoutines(state).map((r) => `${r.routine.name} ${r.done}/${r.total}`));
  run('people', () => E.people.staleContacts(state).map((p) => `${p.person.name} ${p.daysSince}d`));
  run('procedural', () => E.memory.procedural(state, 'how do I usually prepare for client meetings').steps);
  const asks = {};
  for (const q of E.askLife.ASK_EXAMPLES) { try { const a = E.askLife.askLife(state, q); asks[q] = a ? `${a.kind}: ${a.title} (${a.lines.length} lines, ${a.items.length} items)` : 'NULL'; } catch (e) { asks[q] = 'ERROR ' + e.message; } }
  out.askLife = asks;
  const captures = ['Client meeting with Ravi tomorrow at 10 AM', 'Pay electricity bill ₹2,300 Friday', "I'll send Ravi the deck by Friday", 'Need to sort that thing next week', 'Lunch with Arun Friday', 'learn React server components', 'habit: stretch every morning', 'idea: AI recipe planner'];
  const caps = {};
  for (const c of captures) { try { const r = E.agent.processCapture(store, c, { source: 'smoke' }); caps[c] = r.map((x) => `${x.status}@${x.confidence} ${x.kind}: ${x.label.slice(0, 80)}`); } catch (e) { caps[c] = 'ERROR ' + e.message; } }
  out.captures = caps;
  run('proposal', () => { const p = E.agent.proposeProject('I need to launch my portfolio website next month'); return { name: p.name, deadline: p.deadline, ms: p.milestones.map((m) => m.title) }; });
  run('lowEnergy', () => E.agent.handleLowEnergy(store).message);
  run('undoLast', () => { const a = store.getState().activity.find((x) => x.undo && !x.undone); return a ? { label: a.label, ok: store.getState().undoActivity(a.id) } : 'no undoable activity'; });
  run('email', () => E.multimodal.parseEmail('From: Ravi Kumar <ravi@x.com>\nSubject: Proposal\n\nHi, please send the proposal before Friday. Also can you share the GIS map by next Tuesday? Thanks').actions);
  run('voiceRoute', () => 'skipped (async)');
  out.counts = { tasks: store.getState().tasks.length, inbox: store.getState().inbox.length, activity: store.getState().activity.length, people: store.getState().people.length, commitments: store.getState().commitments.length };
  return out;
});

await browser.close();
preview.kill();
try { process.kill(preview.pid); } catch { /* ignore */ }
const report = { results, engineReport, totalErrors: errors.length, errors: errors.slice(0, 60) };
const outFile = path.join(process.env.SHOT_DIR ?? '.', 'smoke-result.json');
await import('node:fs').then((fs) => fs.writeFileSync(outFile, JSON.stringify(report, null, 1)));
const stubs = Object.entries(results).filter(([, v]) => v.stub).map(([k]) => k);
const failing = Object.entries(results).filter(([, v]) => v.errors.length).map(([k, v]) => `${k}: ${v.errors[0]}`);
const engErr = Object.entries(engineReport).filter(([, v]) => typeof v === 'string' && v.startsWith('ERROR')).map(([k, v]) => `${k}: ${v}`);
console.log(JSON.stringify({ totalErrors: errors.length, stubs, failing, engineErrors: engErr, captures: engineReport.captures, askNull: Object.entries(engineReport.askLife ?? {}).filter(([, v]) => v === 'NULL' || String(v).startsWith('ERROR')), file: outFile }, null, 1));
process.exit(0);
