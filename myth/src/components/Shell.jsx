import { useEffect, useMemo, useState } from 'react';
import { Box, Drawer, Modal, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Spotlight } from '@mantine/spotlight';
import { IconChecklist, IconFolders, IconNotes, IconCalendarEvent, IconSearch } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { seedIfNeeded } from '../store/seed';
import { runReminderNotifications } from '../notify';
import * as cloud from '../cloud/netlify';
import TopBar from './TopBar';
import CaptureBar from './CaptureBar';
import CommandCenter, { CommandHero } from './CommandCenter';
import ContextStrip from './ContextStrip';
import MithNowSheet, { MithNowButton } from './MithNow';
import ProjectProposal from './ProjectProposal';
import PlannerPanel from './planner/PlannerPanel';
import Dock from './Dock';
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

export default function Shell() {
  const state = useStore();
  // panel state lives in useUI so widgets, reminders and the Today panel can deep-link
  const panel = useUI((s) => s.panel);
  const setPanel = useUI((s) => s.setPanel);
  const [inlineChat, setInlineChat] = useState(false);
  const [nowOpen, setNowOpen] = useState(false); // MITH NOW sheet

  useEffect(() => {
    // no popup after login — reminders live quietly in the bell icon
    seedIfNeeded(useStore);
    // chat history is short-lived by design: anything older than 3 days goes
    useStore.getState().pruneChat();
  }, []);

  // quiet daily cloud backup (when a sync key is set) — keeps the background
  // push digest computed from fresh data instead of a stale snapshot
  useEffect(() => {
    const id = setTimeout(async () => {
      const s = useStore.getState().settings;
      if (!cloud.isConfigured(s)) return;
      const today = dayjs().format('YYYY-MM-DD');
      if (localStorage.getItem('myth-autosync') === today) return;
      try {
        await cloud.syncUp(s); // validates the key first; throws if the cloud is unreachable
        localStorage.setItem('myth-autosync', today);
      } catch { /* silent — manual sync still available in Settings */ }
    }, 8000);
    return () => clearTimeout(id);
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

  const meta = PANEL_META[panel];

  // side-by-side mode: on wide screens the drawer doesn't cover the app —
  // everything slides left and stays fully interactive
  const wide = useMediaQuery('(min-width: 1100px)');
  // phone mode: bottom tab bar, full-screen sheets, app-like UI
  const mobile = useMediaQuery('(max-width: 768px)');
  const drawerOpen = !!meta || panel === 'assistant';
  const shift = wide && drawerOpen ? (panel === 'assistant' ? 522 : 582) : 0;

  // panels open as full-screen bottom sheets on phones, right drawers on desktop
  const sheetProps = mobile
    ? {
        position: 'bottom',
        size: '100%',
        offset: 0,
        radius: 0,
        withOverlay: true,
        transitionProps: { transition: 'slide-up', duration: 260, timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        styles: { content: { borderRadius: '22px 22px 0 0', height: 'calc(100dvh - 40px)', marginTop: 40 } },
      }
    : {
        position: 'right',
        offset: 14,
        radius: 24,
        withOverlay: !wide,
        transitionProps: { transition: 'slide-left', duration: 280, timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      };

  return (
    <Box className="app-root" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="bg-photo bg-animated" style={{ backgroundImage: `url(${asset('bg-home.jpg')})`, backgroundColor: '#2b3b38' }} />

      <Box
        style={{
          position: 'relative', zIndex: 2, height: '100%', display: 'flex', flexDirection: 'column',
          paddingRight: shift,
          transition: 'padding-right 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <TopBar onOpen={setPanel} />

        {/* desktop: sections float apart with auto margins and the column scrolls only if
            they ever outgrow the viewport — nothing gets clipped behind the dock */}
        <Box
          className="scroll-y"
          style={{
            flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
            overflowX: mobile ? undefined : 'hidden',
            justifyContent: 'flex-start',
            gap: mobile ? 18 : 0,
            paddingTop: mobile ? 8 : 0,
            paddingBottom: mobile ? 'calc(92px + env(safe-area-inset-bottom))' : 86,
          }}
        >
          {/* Life Command Center: greeting + how much of the day is done */}
          <CommandHero mobile={mobile}>
            {/* MITH NOW — the one big decision button */}
            <MithNowButton mobile={mobile} onClick={() => setNowOpen(true)} />
          </CommandHero>

          <Box w="100%" px={{ base: 12, sm: 24 }} my={mobile ? 0 : 'auto'}>
            <CaptureBar onExpand={() => setPanel('assistant')} onChatOpen={setInlineChat} />
          </Box>

          {/* the inline conversation takes the cards' space so the page never scrolls */}
          {!inlineChat && (
            <Box w="100%" my={mobile ? 0 : 'auto'}>
              {/* the Context Engine's next briefing sits above the Command Center */}
              <ContextStrip />
              <CommandCenter onOpen={setPanel} />
            </Box>
          )}
        </Box>

        {mobile
          ? <MobileNav onOpen={setPanel} active={panel} />
          : <Dock onOpen={setPanel} active={panel} shift={shift} />}
      </Box>

      {/* Standard panels: right drawer on desktop, full-screen sheet on phones */}
      <Drawer
        opened={!!meta}
        onClose={() => setPanel(null)}
        size={mobile ? '100%' : 560}
        lockScroll={mobile}
        trapFocus={!wide}
        closeOnClickOutside={!wide || mobile}
        {...sheetProps}
        styles={{
          ...sheetProps.styles,
          body: { height: 'calc(100% - 78px)', ...(sheetProps.styles?.body ?? {}) },
        }}
        title={
          <div>
            <Text fw={800} fz={19}>{meta?.title}</Text>
            {meta?.sub && <Text fz={12.5} c="dimmed" mt={2}>{meta.sub}</Text>}
          </div>
        }
      >
        {meta && <Box className="scroll-y float-in" h="100%"><meta.comp /></Box>}
      </Drawer>

      {/* Assistant: right drawer on desktop, full-screen sheet on phones */}
      <Drawer
        opened={panel === 'assistant'}
        onClose={() => setPanel(null)}
        size={mobile ? '100%' : 500}
        lockScroll={mobile}
        trapFocus={!wide}
        closeOnClickOutside={!wide || mobile}
        {...sheetProps}
        styles={{
          ...sheetProps.styles,
          body: { height: 'calc(100% - 78px)', display: 'flex', flexDirection: 'column', ...(sheetProps.styles?.body ?? {}) },
        }}
        title={
          <div>
            <Text fw={800} fz={19}>Myth Assistant</Text>
            <Text fz={12.5} c="dimmed" mt={2}>Grounded in your live data. Ask anything.</Text>
          </div>
        }
      >
        <ChatAssistant />
      </Drawer>

      {/* Reports: immersive full modal (full-screen on phones) */}
      <Modal
        opened={panel === 'reports'}
        onClose={() => setPanel(null)}
        size="xl"
        radius={mobile ? 0 : 'xl'}
        fullScreen={mobile}
        title={<Text fw={800} fz={20}>Reports & analytics</Text>}
        centered={!mobile}
        styles={{ content: { maxHeight: mobile ? '100dvh' : '92vh' }, body: { overflowY: 'auto' } }}
      >
        <ReportsPanel />
      </Modal>

      {/* Myth Planner: trips, events, study… — full modal, full-screen on phones */}
      <Modal
        opened={panel === 'planner'}
        onClose={() => setPanel(null)}
        size="xl"
        radius={mobile ? 0 : 'xl'}
        fullScreen={mobile}
        title={<div><Text fw={800} fz={20}>Myth Planner</Text><Text fz={12.5} c="dimmed" mt={2}>Trips, events, exams, launches — plan it, confirm it, then go live.</Text></div>}
        centered={!mobile}
        styles={{ content: { maxHeight: mobile ? '100dvh' : '92vh' }, body: { overflowY: 'auto' } }}
      >
        <PlannerPanel />
      </Modal>

      {/* MITH NOW: "What should I do now?" — real-time decision support */}
      <MithNowSheet opened={nowOpen} onClose={() => setNowOpen(false)} onOpen={setPanel} />

      {/* Automatic project creation: the "I drafted a plan — Create project?" sheet */}
      <ProjectProposal />

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
