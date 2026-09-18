// The app frame. Desktop: a dashboard canvas — the home bar (Myth AI /
// Planner on its tabs) with the Myth AI box under it, then the hero with the
// two decision cards beside it, the Planner inline, or an opened module, with
// the icon rail on the right and the floating Myth AI in every module. Phones
// and tablets: the same pieces stacked, with a floating tab bar and bottom sheets.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Drawer, Modal, Text, Tooltip, ActionIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Spotlight } from '@mantine/spotlight';
import { IconChecklist, IconFolders, IconNotes, IconCalendarEvent, IconSearch, IconCompass, IconX, IconArrowsDiagonal, IconBellRinging, IconClockPlay } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { startAutoSync } from '../cloud/autoSync';
import { ConnectBanner, ConflictDialog } from './CloudConnect';
import { runReminderNotifications } from '../notify';
import TopBar from './TopBar';
import CaptureBar from './CaptureBar';
import { useCommandCenter, AttentionCard, TodayCard, TriageModal } from './CommandCenter';
import MithNowSheet from './MithNow';
import ProjectProposal from './ProjectProposal';
import PlannerPanel from './planner/PlannerPanel';
import Hero from './Hero';
import Welcome from './Welcome';
import Rail from './Rail';
import ModuleFrame from './ModuleFrame';
import MobileNav from './MobileNav';
import ChatAssistant from './ChatAssistant';
import AssistantDock from './AssistantDock';
import { asset } from '../config/env';
import TodayPanel from './panels/TodayPanel';
import TasksPanel from './panels/TasksPanel';
import ProjectsPanel from './panels/ProjectsPanel';
import HabitsPanel from './panels/HabitsPanel';
import FinancePanel from './panels/FinancePanel';
import LearningPanel from './panels/LearningPanel';
import CalendarPanel from './panels/CalendarPanel';
import DrivePanel from './panels/DrivePanel';
import ReportsPanel from './panels/ReportsPanel';
import SettingsPanel from './panels/SettingsPanel';
import RemindersPanel from './panels/RemindersPanel';
import TrackPanel from './panels/TrackPanel';
import { fmtMinutes } from '../ai/worklog';
import { HOME_VIDEO, HOME_POSTER } from '../homeVideo';
import './canvas.css';

const PANEL_META = {
  today: { title: 'Daily planner', sub: 'Your day at a glance — score, priorities, meetings.', comp: TodayPanel },
  tasks: { title: 'Tasks', sub: 'Everything you committed to, sorted by urgency.', comp: TasksPanel },
  projects: { title: 'Projects', sub: 'Tasks, milestones & documents in one place.', comp: ProjectsPanel },
  drive: { title: 'Drive', sub: 'Private vault — paste screenshots, store files, passwords & links. Local only.', comp: DrivePanel },
  learning: { title: 'Learning pipeline', sub: 'Nothing counts as learned until it reaches Applied. Files, notes and links live on each card.', comp: LearningPanel },
  habits: { title: 'Habit tracker', sub: 'Small daily wins that compound.', comp: HabitsPanel },
  finance: { title: 'Finance', sub: 'Where the money goes, at a glance.', comp: FinancePanel },
  calendar: { title: 'Calendar & timeline', sub: 'Click any date to add a task or event.', comp: CalendarPanel },
  reminders: { title: 'Reminders', sub: 'Nudges at the right time — once or on repeat. Say "remind me…" anywhere in Myth.', comp: RemindersPanel },
  settings: { title: 'Settings', sub: 'Profile, AI brain, planner brain, backups.', comp: SettingsPanel },
};
// wide modules that were modals: on desktop they open in place like the rest
const WIDE_META = {
  track: { title: 'Track', sub: 'What you did each day — work, description, project and status — with a daily summary.', comp: TrackPanel },
  reports: { title: 'Reports & analytics', sub: 'Your month in numbers and a story.', comp: ReportsPanel },
  planner: { title: 'Myth Planner', sub: 'Trips, events, exams, launches — plan it, confirm it, then go live.', comp: PlannerPanel },
  assistant: { title: 'Myth AI', sub: 'Ask anything, hand me a file, or tell me what to add where.', comp: ChatAssistant, flex: true },
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

// The Planner under the home bar (Planner tab).
function InlinePlanner({ onClose, onFull }) {
  return (
    <section className="inline-planner float-in">
      <div className="inline-planner-head">
        <div>
          <div className="inline-planner-title"><IconCompass size={18} color="#f0a316" /> Myth Planner</div>
          <div className="inline-planner-sub">Type what you're planning in the bar above — routes, weather, stays, places and several day-by-day plans for trips; dated milestones plus a playbook (training weeks, meal plans, budgets, savings schedules, timetables) for everything else.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {onFull && <Tooltip label="Open as a full module"><ActionIcon size={34} radius="xl" variant="light" color="gray" onClick={onFull} aria-label="Open full planner"><IconArrowsDiagonal size={16} /></ActionIcon></Tooltip>}
          <Tooltip label="Back to Myth AI"><ActionIcon size={34} radius="xl" variant="light" color="gray" onClick={onClose} aria-label="Close planner"><IconX size={16} /></ActionIcon></Tooltip>
        </div>
      </div>
      <PlannerPanel embedded />
    </section>
  );
}

export default function Shell() {
  const state = useStore();
  // panel state lives in useUI so widgets, reminders and the Today panel can deep-link
  const panel = useUI((s) => s.panel);
  const setPanel = useUI((s) => s.setPanel);
  const plannerInline = useUI((s) => s.plannerInline);
  const showPlannerInline = useUI((s) => s.showPlannerInline);
  const assistantOpen = useUI((s) => s.assistantOpen);
  const assistantSeed = useUI((s) => s.assistantSeed);
  const closeAssistant = useUI((s) => s.closeAssistant);
  const consumeAssistantSeed = useUI((s) => s.consumeAssistantSeed);
  const [mode, setMode] = useState('chat'); // the home bar's tabs: chat | planner
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
  // and every minute while the app stays open (reminders fire at their minute)
  useEffect(() => {
    const tick = () => runReminderNotifications(useStore.getState());
    tick();
    const id = setInterval(tick, 60 * 1000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // Esc closes whatever module is open in place
  useEffect(() => {
    // An open dialog inside the module takes the Esc for itself. Capture phase: this
    // runs before the dialog's own handler closes it, while it is still in the DOM.
    const onKey = (e) => { if (e.key === 'Escape' && panel && !document.querySelector('[role="dialog"]')) setPanel(null); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel, setPanel]);

  // the assistant (or a "plan…" action) asked for the planner: switch the bar to Planner mode on the home screen
  useEffect(() => {
    if (!plannerInline) return;
    setMode('planner');
    setPanel(null);
    showPlannerInline(false);
  }, [plannerInline, setPanel, showPlannerInline]);

  const spotlightActions = useMemo(() => {
    const acts = [];
    state.tasks.slice(0, 60).forEach((t) =>
      acts.push({ id: `t${t.id}`, label: t.title, description: `Task · ${t.status}`, leftSection: <IconChecklist size={16} />, onClick: () => setPanel('tasks') }));
    state.projects.forEach((p) =>
      acts.push({ id: `p${p.id}`, label: p.name, description: 'Project', leftSection: <IconFolders size={16} />, onClick: () => setPanel('projects') }));
    state.events.forEach((e) =>
      acts.push({ id: `e${e.id}`, label: e.title, description: `Event · ${dayjs(e.date).format('MMM D')}`, leftSection: <IconCalendarEvent size={16} />, onClick: () => setPanel('calendar') }));
    state.learning.forEach((l) =>
      acts.push({ id: `l${l.id}`, label: l.title, description: 'Learning pipeline', leftSection: <IconNotes size={16} />, onClick: () => setPanel('learning') }));
    (state.reminders ?? []).filter((r) => !r.done).forEach((r) =>
      acts.push({ id: `r${r.id}`, label: r.title, description: `Reminder · ${dayjs(r.date).format('MMM D')}${r.time ? ` ${r.time}` : ''}`, leftSection: <IconBellRinging size={16} />, onClick: () => setPanel('reminders') }));
    (state.worklog ?? []).slice(0, 40).forEach((w) =>
      acts.push({ id: `w${w.id}`, label: w.title, description: `Work log · ${dayjs(w.date).format('MMM D')} · ${fmtMinutes(w.minutes)}`, leftSection: <IconClockPlay size={16} />, onClick: () => setPanel('track') }));
    (state.plannerSessions ?? []).forEach((p) =>
      acts.push({ id: `pl${p.id}`, label: p.title || 'Plan', description: `Myth Planner · ${p.mode} · ${p.status}`, leftSection: <IconCompass size={16} />, onClick: () => { useUI.getState().setPlannerFocus(p.id); showPlannerInline(true); } }));
    return acts;
  }, [state.tasks, state.projects, state.events, state.learning, state.plannerSessions, state.reminders, state.worklog, setPanel, showPlannerInline]);

  const desktop = useMediaQuery('(min-width: 1000px)');
  const mobile = useMediaQuery('(max-width: 768px)');
  const meta = PANEL_META[panel];
  const wideMeta = WIDE_META[panel];
  const inPlace = desktop ? (meta ?? wideMeta) : null;

  // The backdrop video only plays on the home screen: with a module open it is
  // almost fully covered, so it rests there and the module stays smooth.
  const bgRef = useRef(null);
  const [bgReady, setBgReady] = useState(false);
  const moduleOpen = !!inPlace;
  useEffect(() => {
    const v = bgRef.current;
    if (!v) return;
    if (moduleOpen) v.pause(); else v.play().catch(() => { /* autoplay refused — the poster stays */ });
  }, [moduleOpen, desktop]);

  // phones: the floating assistant is the centre tab's drawer
  useEffect(() => {
    if (!desktop && assistantOpen) { setPanel('assistant'); closeAssistant(); }
  }, [desktop, assistantOpen, setPanel, closeAssistant]);

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

  const plannerOnHome = mode === 'planner';
  // in Planner mode the composer + examples under the bar are the empty state;
  // the planner card appears once there is a plan to show
  const plannerFocusId = useUI((s) => s.plannerFocusId);
  const plannerHasContent = !!plannerFocusId || (state.plannerSessions ?? []).length > 0;

  // the home block floats in the middle of the free space (auto margins), and
  // scrolls normally when there is more content than screen
  const home = (
    <div className="home">
      {/* "Hey Boss, good afternoon" + one small line for the day */}
      <Welcome />
      {/* a device without a sync key yet: paste the passphrase once */}
      <ConnectBanner />
      <CaptureBar mode={mode} onMode={setMode} onExpand={() => setPanel('assistant')} onChatOpen={setInlineChat} />
      {plannerOnHome ? (
        plannerHasContent && <InlinePlanner onClose={() => setMode('chat')} onFull={desktop ? () => setPanel('planner') : null} />
      ) : !inlineChat && (
        <>
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
        {/* the dashboard's own backdrop: a muted, looping video on desktop; the mobile artwork as a still on phones and tablets */}
        {desktop ? (
          <>
            {/* the poster (first frame, ~70 KB) paints at once; the video fades in over it when it can play */}
            <div className="canvas-bg canvas-bg-image" style={{ backgroundImage: `url(${HOME_POSTER})` }} aria-hidden="true" />
            <video
              ref={bgRef} className="canvas-bg canvas-bg-video" data-ready={bgReady || undefined}
              autoPlay muted loop playsInline preload="auto" disablePictureInPicture aria-hidden="true"
              onCanPlay={() => setBgReady(true)}
            >
              <source src={HOME_VIDEO} type="video/webm" />
            </video>
          </>
        ) : (
          <div
            className="canvas-bg canvas-bg-image"
            style={{ backgroundImage: `url(${encodeURI(asset('Mobile app image.jpg'))})` }}
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

      {/* the floating Myth AI: reachable from every module on desktop */}
      {desktop && <AssistantDock />}

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
            title={<div><Text fw={800} fz={19}>Myth AI</Text><Text fz={12.5} c="dimmed" mt={2}>Ask anything, hand me a file, or tell me what to add where.</Text></div>}
          >
            <ChatAssistant initialQuestion={assistantSeed} onConsumedInitial={consumeAssistantSeed} />
          </Drawer>
          {['track', 'reports', 'planner'].map((key) => (
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
        searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Search tasks, projects, events, plans…' }}
      />
    </Box>
  );
}
