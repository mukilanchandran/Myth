// The app frame. Desktop: a dashboard canvas — the capture bar, then the hero
// with the two decision cards beside it (or an opened module), with the icon
// rail on the right. Phones and tablets: the same pieces stacked, with a
// floating tab bar and bottom sheets for modules.
import { useEffect, useMemo, useState } from 'react';
import { Box, Drawer, Modal, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Spotlight } from '@mantine/spotlight';
import { IconChecklist, IconFolders, IconNotes, IconCalendarEvent, IconSearch } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { startAutoSync } from '../cloud/autoSync';
import { ConnectBanner, ConflictDialog } from './CloudConnect';
import { runReminderNotifications } from '../notify';
import TopBar from './TopBar';
import CaptureBar from './CaptureBar';
import { useCommandCenter, AttentionCard, TodayCard, TriageModal } from './CommandCenter';
import ContextStrip from './ContextStrip';
import MithNowSheet from './MithNow';
import ProjectProposal from './ProjectProposal';
import PlannerPanel from './planner/PlannerPanel';
import Hero from './Hero';
import Welcome from './Welcome';
import Rail from './Rail';
import ModuleFrame from './ModuleFrame';
import MobileNav from './MobileNav';
import ChatAssistant from './ChatAssistant';
import { keepModelWarm } from '../ai/assistant';
import { AI_WARMUP, asset } from '../config/env';
import TodayPanel from './panels/TodayPanel';
import ContextPanel from './panels/ContextPanel';
import TasksPanel from './panels/TasksPanel';
import ProjectsPanel from './panels/ProjectsPanel';
import NotesPanel from './panels/NotesPanel';
import HabitsPanel from './panels/HabitsPanel';
import FinancePanel from './panels/FinancePanel';
import LearningPanel from './panels/LearningPanel';
import CalendarPanel from './panels/CalendarPanel';
import DrivePanel from './panels/DrivePanel';
import ReportsPanel from './panels/ReportsPanel';
import SettingsPanel from './panels/SettingsPanel';
import './canvas.css';

const PANEL_META = {
  today: { title: 'Daily planner', sub: 'Your day at a glance — score, priorities, meetings.', comp: TodayPanel },
  context: { title: 'Context engine', sub: 'What connects to what — meeting prep, follow-ups and related work.', comp: ContextPanel },
  tasks: { title: 'Tasks', sub: 'Everything you committed to, sorted by urgency.', comp: TasksPanel },
  projects: { title: 'Projects', sub: 'Tasks, milestones, meeting notes & documents in one place.', comp: ProjectsPanel },
  notes: { title: 'Notes, ideas & meetings', sub: 'Your second brain — searchable and linked to projects.', comp: NotesPanel },
  drive: { title: 'Drive', sub: 'Private vault — paste screenshots, store files, passwords & links. Local only.', comp: DrivePanel },
  learning: { title: 'Learning pipeline', sub: 'Nothing counts as learned until it reaches Applied.', comp: LearningPanel },
  habits: { title: 'Habit tracker', sub: 'Small daily wins that compound.', comp: HabitsPanel },
  finance: { title: 'Finance', sub: 'Where the money goes, at a glance.', comp: FinancePanel },
  calendar: { title: 'Calendar & timeline', sub: 'Click any date to add a task or event.', comp: CalendarPanel },
  settings: { title: 'Settings', sub: 'Profile, AI brain, backups.', comp: SettingsPanel },
};
// wide modules that were modals: on desktop they open in place like the rest
const WIDE_META = {
  reports: { title: 'Reports & analytics', sub: 'Your month in numbers and a story.', comp: ReportsPanel },
  planner: { title: 'Myth Planner', sub: 'Trips, events, exams, launches — plan it, confirm it, then go live.', comp: PlannerPanel },
  assistant: { title: 'Myth Assistant', sub: 'Grounded in your live data. Ask anything.', comp: ChatAssistant, flex: true },
};

// The two decision cards, stacked beside the hero (below it on phones).
function CommandRow({ onOpen }) {
  const cc = useCommandCenter();
  const [triage, setTriage] = useState(false);
  return (
    <>
      <div className="cc-pair">
        <AttentionCard i={0} items={cc.attention} onHandle={() => setTriage(true)} />
        <TodayCard i={1} items={cc.timeline} now={cc.now} onOpen={onOpen} />
      </div>
      <TriageModal opened={triage} onClose={() => setTriage(false)} items={cc.attention} onOpen={onOpen} />
    </>
  );
}

export default function Shell() {
  const state = useStore();
  // panel state lives in useUI so widgets, reminders and the Today panel can deep-link
  const panel = useUI((s) => s.panel);
  const setPanel = useUI((s) => s.setPanel);
  const [inlineChat, setInlineChat] = useState(false);
  const [nowOpen, setNowOpen] = useState(false); // MITH NOW sheet

  useEffect(() => {
    // chat history is short-lived by design: anything older than 3 days goes
    useStore.getState().pruneChat();
    // cloud: pull on open and on focus, push on every change — the same data
    // on every device that opens the link (see cloud/autoSync.js)
    const sync = startAutoSync(useStore);
    return () => sync.stop();
  }, []);

  // system notifications + icon badge: on open, on return to foreground,
  // and every 5 minutes while the app stays open
  useEffect(() => {
    const tick = () => runReminderNotifications(useStore.getState());
    tick();
    const id = setInterval(tick, 5 * 60 * 1000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // keep the local model loaded so the chat answers instantly instead of cold-starting
  useEffect(() => {
    if (!AI_WARMUP) return undefined;
    const warm = () => keepModelWarm(useStore.getState());
    warm();
    const id = setInterval(warm, 4 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Esc closes whatever module is open in place
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && panel) setPanel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, setPanel]);

  const spotlightActions = useMemo(() => {
    const acts = [];
    state.tasks.slice(0, 60).forEach((t) =>
      acts.push({ id: `t${t.id}`, label: t.title, description: `Task · ${t.status}`, leftSection: <IconChecklist size={16} />, onClick: () => setPanel('tasks') }));
    state.projects.forEach((p) =>
      acts.push({ id: `p${p.id}`, label: p.name, description: 'Project', leftSection: <IconFolders size={16} />, onClick: () => setPanel('projects') }));
    state.notes.slice(0, 60).forEach((n) =>
      acts.push({ id: `n${n.id}`, label: n.title, description: n.type, leftSection: <IconNotes size={16} />, onClick: () => setPanel('notes') }));
    state.events.forEach((e) =>
      acts.push({ id: `e${e.id}`, label: e.title, description: `Event · ${dayjs(e.date).format('MMM D')}`, leftSection: <IconCalendarEvent size={16} />, onClick: () => setPanel('calendar') }));
    state.learning.forEach((l) =>
      acts.push({ id: `l${l.id}`, label: l.title, description: 'Learning pipeline', leftSection: <IconNotes size={16} />, onClick: () => setPanel('learning') }));
    return acts;
  }, [state.tasks, state.projects, state.notes, state.events, state.learning, setPanel]);

  const desktop = useMediaQuery('(min-width: 1000px)');
  const mobile = useMediaQuery('(max-width: 768px)');
  const meta = PANEL_META[panel];
  const wideMeta = WIDE_META[panel];
  const inPlace = desktop ? (meta ?? wideMeta) : null;

  // phones: full-screen bottom sheets; tablets: right drawers
  const sheetProps = mobile
    ? {
        position: 'bottom', size: '100%', offset: 0, radius: 0, withOverlay: true,
        transitionProps: { transition: 'slide-up', duration: 260, timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        styles: { content: { borderRadius: '22px 22px 0 0', height: 'calc(100dvh - 40px)', marginTop: 40 } },
      }
    : {
        position: 'right', offset: 14, radius: 24, withOverlay: true,
        transitionProps: { transition: 'slide-left', duration: 280, timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      };

  // the home block floats in the middle of the free space (auto margins), and
  // scrolls normally when there is more content than screen
  const home = (
    <div className="home">
      {/* "Hey Boss, good afternoon" + one small line for the day */}
      <Welcome />
      {/* a device without a sync key yet: paste the passphrase once */}
      <ConnectBanner />
      <CaptureBar onExpand={() => setPanel('assistant')} onChatOpen={setInlineChat} />
      {!inlineChat && (
        <>
          <ContextStrip />
          <div className="home-grid">
            <Hero onOpen={setPanel} onNow={() => setNowOpen(true)} mobile={!desktop} />
            <CommandRow onOpen={setPanel} />
          </div>
        </>
      )}
    </div>
  );

  return (
    <Box className="app-root canvas-page">
      <div className="canvas">
        {/* the dashboard's own backdrop: a muted, looping video on desktop; a still of the same scene on phones and tablets */}
        {desktop ? (
          <video
            className="canvas-bg canvas-bg-video"
            src={encodeURI(asset('Home page Back v1.mp4'))}
            autoPlay muted loop playsInline preload="auto" aria-hidden="true"
          />
        ) : (
          <div
            className="canvas-bg canvas-bg-image"
            style={{ backgroundImage: `url(${encodeURI(asset('Home page background 1.jpg'))})` }}
            aria-hidden="true"
          />
        )}
        <TopBar onOpen={setPanel} desktop={desktop} />

        {desktop ? (
          <div className="canvas-body">
            <main className="canvas-main">
              {inPlace ? (
                <ModuleFrame key={panel} title={inPlace.title} sub={inPlace.sub} flex={inPlace.flex} onClose={() => setPanel(null)}>
                  <inPlace.comp />
                </ModuleFrame>
              ) : home}
            </main>
            <Rail active={panel} onOpen={setPanel} onAssistant={() => setPanel('assistant')} />
          </div>
        ) : (
          <div className="scroll-y" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: `6px 12px calc(96px + env(safe-area-inset-bottom))` }}>
            {home}
          </div>
        )}
      </div>

      {!desktop && <MobileNav onOpen={setPanel} active={panel} />}

      {/* phones & tablets: modules as sheets / drawers */}
      {!desktop && (
        <>
          <Drawer
            opened={!!meta} onClose={() => setPanel(null)} size={mobile ? '100%' : 560} lockScroll={mobile}
            {...sheetProps}
            styles={{ ...sheetProps.styles, body: { height: 'calc(100% - 78px)', ...(sheetProps.styles?.body ?? {}) } }}
            title={<div><Text fw={800} fz={19}>{meta?.title}</Text>{meta?.sub && <Text fz={12.5} c="dimmed" mt={2}>{meta.sub}</Text>}</div>}
          >
            {meta && <Box className="scroll-y float-in" h="100%"><meta.comp /></Box>}
          </Drawer>
          <Drawer
            opened={panel === 'assistant'} onClose={() => setPanel(null)} size={mobile ? '100%' : 500} lockScroll={mobile}
            {...sheetProps}
            styles={{ ...sheetProps.styles, body: { height: 'calc(100% - 78px)', display: 'flex', flexDirection: 'column', ...(sheetProps.styles?.body ?? {}) } }}
            title={<div><Text fw={800} fz={19}>Myth Assistant</Text><Text fz={12.5} c="dimmed" mt={2}>Grounded in your live data. Ask anything.</Text></div>}
          >
            <ChatAssistant />
          </Drawer>
          {['reports', 'planner'].map((key) => (
            <Modal
              key={key} opened={panel === key} onClose={() => setPanel(null)} size="xl" radius={mobile ? 0 : 'xl'} fullScreen={mobile} centered={!mobile}
              title={<div><Text fw={800} fz={20}>{WIDE_META[key].title}</Text><Text fz={12.5} c="dimmed" mt={2}>{WIDE_META[key].sub}</Text></div>}
              styles={{ content: { maxHeight: mobile ? '100dvh' : '92vh' }, body: { overflowY: 'auto' } }}
            >
              {panel === key && (() => { const C = WIDE_META[key].comp; return <C />; })()}
            </Modal>
          ))}
        </>
      )}

      {/* MITH NOW: "What should I do now?" — real-time decision support */}
      <MithNowSheet opened={nowOpen} onClose={() => setNowOpen(false)} onOpen={setPanel} />

      {/* Automatic project creation: the "I drafted a plan — Create project?" sheet */}
      <ProjectProposal />

      {/* first connection with data on both sides: keep which copy? */}
      <ConflictDialog />

      <Spotlight
        actions={spotlightActions}
        nothingFound="Nothing found…"
        highlightQuery
        shortcut={['mod + K', '/']}
        searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Search tasks, projects, notes, events…' }}
      />
    </Box>
  );
}
