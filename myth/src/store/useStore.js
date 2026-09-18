import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import dayjs from 'dayjs';
import { APP_PASSWORD, AI_MODEL } from '../config/env';
import { buildPlan, createProjectFromPlan } from '../ai/projectPlanner';
import { emptyLearn, learnSkip, learnStart, learnFinish } from '../ai/mithNow';
import { completePatch } from '../ai/reminders';
import { placeEntry, fromMin, inferProject, projectPool } from '../ai/worklog';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const today = () => dayjs().format('YYYY-MM-DD');

const XP_TABLE = { task: 10, habit: 5, journal: 8, capture: 1, meeting: 6 };

// chat history lives for 3 days, then disappears on its own
const CHAT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const pruneChatHistory = (history = []) => history.filter((h) => Date.now() - h.ts < CHAT_TTL_MS);

export const useStore = create(
  persist(
    (set, get) => ({
      // ---------- session ----------
      authed: false,
      login: (pw) => {
        if (pw === APP_PASSWORD) { set({ authed: true }); return true; }
        return false;
      },
      logout: () => set({ authed: false }),
      // passwordless entry (mobile splash) — the password is a convenience
      // lock only; on phones the home-screen icon acts as the door
      unlock: () => set({ authed: true }),

      // ---------- settings ----------
      settings: {
        name: 'Mukil',
        aiEndpoint: '',
        aiModel: AI_MODEL, // empty = auto-pick the best installed model
        aiKey: '',
        // Planner search brain: an optional dedicated ChatGPT (OpenAI) key so the
        // trip planner's destination research uses a strong model even when the
        // everyday assistant runs on a free provider. Empty = same brain as chat.
        plannerAiEndpoint: '',
        plannerAiKey: '',
        plannerAiModel: '',
        cloudKey: '', // Netlify sync key (= MYTH_SYNC_KEY on the site) — Settings → Cloud storage & sync
        cloudUrl: '', // optional Netlify site URL when the app runs elsewhere (dev server, Docker)
        notifications: true,
        notifyBudget: 4, // lock-screen notifications per day (Notification Intelligence Engine)
        quietStart: 22,  // quiet hours: nothing reaches the lock screen from here…
        quietEnd: 7,     // …until here
        seeded: false,
      },
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      // ---------- notification intelligence: snoozed / dismissed ----------
      // key -> { until: ISO, fp } — see isMuted() in src/ai/notifications.js
      notifyMuted: {},
      muteNotification: (key, until, fp = null) =>
        set((s) => ({ notifyMuted: { ...s.notifyMuted, [key]: { until, fp } } })),
      unmuteNotification: (key) =>
        set((s) => { const next = { ...s.notifyMuted }; delete next[key]; return { notifyMuted: next }; }),

      // ---------- gamification ----------
      xp: { points: 0, streakCount: 0, streakLastDate: null },
      addXp: (kind) =>
        set((s) => {
          const pts = XP_TABLE[kind] ?? 2;
          const t = today();
          let { streakCount, streakLastDate } = s.xp;
          if (streakLastDate !== t) {
            streakCount = streakLastDate === dayjs().subtract(1, 'day').format('YYYY-MM-DD') ? streakCount + 1 : 1;
            streakLastDate = t;
          }
          return { xp: { points: s.xp.points + pts, streakCount, streakLastDate } };
        }),

      // ---------- tasks ----------
      tasks: [],
      addTask: (t) =>
        set((s) => ({
          tasks: [
            {
              id: uid(), title: '', desc: '', projectId: null,
              priority: 3, status: 'todo', due: null, tags: [], estimate: null,
              created: new Date().toISOString(), completedAt: null, ...t,
            },
            ...s.tasks,
          ],
        })),
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            // remember when work actually started, so a task that stalls can be noticed
            const startedAt = patch.status === 'doing' ? (t.startedAt ?? new Date().toISOString()) : patch.status === 'todo' ? null : t.startedAt ?? null;
            return { ...t, ...patch, startedAt };
          }),
        })),
      completeTask: (id) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, status: 'done', completedAt: new Date().toISOString() } : t
          ),
        }));
        get().addXp('task');
      },
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      // ---------- projects ----------
      projects: [],
      addProject: (p) => {
        const proj = {
          id: uid(), name: 'Untitled project', desc: '',
          color: '#0D2D1C', status: 'active', deadline: null, milestones: [],
          created: new Date().toISOString(), ...p,
        };
        set((s) => ({ projects: [proj, ...s.projects] }));
        return proj;
      },
      updateProject: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
        })),

      // ---------- files (meta only; blobs live in IndexedDB) ----------
      files: [],
      addFileMeta: (f) => set((s) => ({ files: [{ id: uid(), created: new Date().toISOString(), ...f }, ...s.files] })),
      updateFileMeta: (id, patch) => set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
      deleteFileMeta: (id) =>
        set((s) => ({
          files: s.files.filter((f) => f.id !== id),
          learning: s.learning.map((l) => ((l.fileIds ?? []).includes(id) ? { ...l, fileIds: l.fileIds.filter((x) => x !== id) } : l)),
        })),

      // ---------- drive (private vault: screenshots, files, passwords, links) ----------
      drive: [],
      addDriveItem: (item) => {
        const it = {
          id: uid(), kind: 'file', title: '', pinned: false, tags: [],
          created: new Date().toISOString(), ...item,
        };
        set((s) => ({ drive: [it, ...s.drive] }));
        return it;
      },
      updateDriveItem: (id, patch) =>
        set((s) => ({ drive: s.drive.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
      deleteDriveItem: (id) => set((s) => ({ drive: s.drive.filter((d) => d.id !== id) })),

      // ---------- habits ----------
      habits: [],
      addHabit: (h) =>
        set((s) => ({
          habits: [...s.habits, { id: uid(), name: '', icon: 'spark', target: 7, log: {}, created: new Date().toISOString(), ...h }],
        })),
      toggleHabit: (id, date = today()) => {
        const wasDone = !!get().habits.find((h) => h.id === id)?.log[date];
        set((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h;
            const log = { ...h.log };
            if (log[date]) delete log[date]; else log[date] = true;
            return { ...h, log };
          }),
        }));
        if (!wasDone) get().addXp('habit');
      },
      deleteHabit: (id) => set((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),

      // ---------- finance ----------
      transactions: [],
      addTransaction: (t) =>
        set((s) => ({
          transactions: [
            { id: uid(), type: 'expense', amount: 0, category: 'Other', note: '', date: today(), ...t },
            ...s.transactions,
          ],
        })),
      deleteTransaction: (id) => set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) })),

      // ---------- journal ----------
      journal: [],
      addJournalEntry: ({ text, mood }) => {
        set((s) => ({
          journal: [
            {
              id: uid(), date: today(), ts: Date.now(), mood: mood ?? 3,
              text: text ?? '',
            },
            ...s.journal,
          ],
        }));
        get().addXp('journal');
      },
      deleteJournalEntry: (id) => set((s) => ({ journal: s.journal.filter((j) => j.id !== id) })),
      upsertJournal: (entry) => {
        const d = entry.date ?? today();
        const exists = get().journal.find((j) => j.date === d);
        if (exists) {
          set((s) => ({ journal: s.journal.map((j) => (j.date === d ? { ...j, ...entry } : j)) }));
        } else {
          set((s) => ({ journal: [{ id: uid(), date: d, mood: 3, energy: 3, gratitude: '', reflection: '', wins: '', ...entry }, ...s.journal] }));
          get().addXp('journal');
        }
      },

      // ---------- day plan (morning "what I'll do today" stories) ----------
      plans: {}, // 'YYYY-MM-DD' -> [{id, text, done, doneAt}]
      addPlanItems: (texts, date = today()) =>
        set((s) => {
          const key = date;
          const existing = s.plans[key] ?? [];
          const fresh = texts
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && !existing.some((e) => e.text.toLowerCase() === t.toLowerCase()))
            .map((t) => ({ id: uid(), text: t, done: false, doneAt: null }));
          return { plans: { ...s.plans, [key]: [...existing, ...fresh] } };
        }),
      togglePlanItem: (id) => {
        const s = get();
        const key = today();
        const items = s.plans[key] ?? [];
        const target = items.find((i) => i.id === id);
        set({
          plans: {
            ...s.plans,
            [key]: items.map((i) =>
              i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? new Date().toISOString() : null } : i
            ),
          },
        });
        if (target && !target.done) s.addXp('habit');
      },
      deletePlanItem: (id) =>
        set((s) => {
          const key = today();
          return { plans: { ...s.plans, [key]: (s.plans[key] ?? []).filter((i) => i.id !== id) } };
        }),

      // ---------- learning pipeline ----------
      // stages: 0 want-to-learn, 1 learning, 2 applied, 3 taught/shared
      // an item may carry notes, attached files (ids in `files`) and links —
      // the assistant fills these when you hand it a PDF or ask for a study sheet
      learning: [],
      addLearning: (titleOrItem) => {
        const extra = typeof titleOrItem === 'string' ? { title: titleOrItem } : titleOrItem ?? {};
        const item = { id: uid(), title: '', stage: 0, notes: '', fileIds: [], links: [], created: new Date().toISOString(), ...extra };
        set((s) => ({ learning: [...s.learning, item] }));
        return item;
      },
      updateLearning: (id, patch) =>
        set((s) => ({ learning: s.learning.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      attachToLearning: (id, fileId) =>
        set((s) => ({
          learning: s.learning.map((l) => (l.id === id && !(l.fileIds ?? []).includes(fileId) ? { ...l, fileIds: [...(l.fileIds ?? []), fileId] } : l)),
          files: s.files.map((f) => (f.id === fileId ? { ...f, learningId: id } : f)),
        })),
      moveLearning: (id, dir) =>
        set((s) => ({
          learning: s.learning.map((l) =>
            l.id === id ? { ...l, stage: Math.max(0, Math.min(3, l.stage + dir)) } : l
          ),
        })),
      deleteLearning: (id) => set((s) => ({ learning: s.learning.filter((l) => l.id !== id) })),

      // ---------- events (calendar) ----------
      events: [],
      addEvent: (e) =>
        set((s) => ({
          events: [
            { id: uid(), title: '', date: today(), time: null, kind: 'event', yearly: false, ...e },
            ...s.events,
          ],
        })),
      deleteEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
      updateEvent: (id, patch) =>
        set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),

      // ---------- reminders ----------
      // { id, title, note, date, time|null, repeat: none|daily|weekdays|weekly|monthly|yearly,
      //   category, done, doneAt, snoozedUntil, timesDone, lastDoneAt, source, created }
      reminders: [],
      addReminder: (r) => {
        const id = uid();
        set((s) => ({
          reminders: [
            { id, title: '', note: '', date: today(), time: null, repeat: 'none', category: 'personal', done: false, doneAt: null, snoozedUntil: null, timesDone: 0, source: 'manual', created: new Date().toISOString(), ...r },
            ...(s.reminders ?? []),
          ],
        }));
        get().addXp('capture');
        return id;
      },
      updateReminder: (id, patch) =>
        set((s) => ({ reminders: (s.reminders ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      // a one-off closes; a repeat rolls forward to its next date (see ai/reminders.js)
      completeReminder: (id) =>
        set((s) => ({ reminders: (s.reminders ?? []).map((r) => (r.id === id ? { ...r, ...completePatch(r) } : r)) })),
      snoozeReminder: (id, until) =>
        set((s) => ({ reminders: (s.reminders ?? []).map((r) => (r.id === id ? { ...r, snoozedUntil: until } : r)) })),
      reopenReminder: (id) =>
        set((s) => ({ reminders: (s.reminders ?? []).map((r) => (r.id === id ? { ...r, done: false, doneAt: null, snoozedUntil: null } : r)) })),
      deleteReminder: (id) => set((s) => ({ reminders: (s.reminders ?? []).filter((r) => r.id !== id) })),

      // ---------- Track: the daily work log (see ai/worklog.js) ----------
      // A day is the list of what got done: { id, title, note (description), status: done|progress|review|blocked,
      //   date, projectId|null, project (free-text name), category, source: manual|timer|ai|capture|suggested, created,
      //   minutes (0 = no time recorded), start/end 'HH:mm' (only when a clock time was given — the timer, "3pm-4pm") }
      worklog: [],
      worklogSummaries: {}, // 'YYYY-MM-DD' -> { text, source: ai|manual, updated } — no entry = the automatic summary
      worklogTimer: null,   // { title, projectId, project, category, note, startedAt } — the running timer
      addWorkLog: (e) => {
        const date = e.date ?? today();
        // time is optional: a clock time is kept, a bare duration is kept, nothing is fine too
        const slot = e.start || e.end
          ? placeEntry({ date, minutes: e.minutes, start: e.start, end: e.end }, get().worklog ?? [])
          : { start: null, end: null, minutes: Math.max(0, Math.round(Number(e.minutes) || 0)), approx: false };
        const entry = {
          id: uid(), title: '', note: '', status: 'done', projectId: null, project: '', category: 'dev', source: 'manual',
          created: new Date().toISOString(), ...e, date, ...slot,
        };
        // no project given: a project the title names (a real one, or a name used in the log before)
        if (!entry.projectId && !entry.project) {
          const hit = inferProject(entry.title, projectPool(get().projects, get().worklog ?? []));
          if (hit) { entry.projectId = hit.id; entry.project = hit.name; }
        }
        set((s) => ({ worklog: [entry, ...(s.worklog ?? [])] }));
        get().addXp('capture');
        return entry;
      },
      updateWorkLog: (id, patch) =>
        set((s) => ({
          worklog: (s.worklog ?? []).map((w) => {
            if (w.id !== id) return w;
            const next = { ...w, ...patch };
            const clock = (next.start || next.end) && ('start' in patch || 'end' in patch);
            return clock ? { ...next, ...placeEntry(next, (s.worklog ?? []).filter((x) => x.id !== id)) } : next;
          }),
        })),
      deleteWorkLog: (id) => set((s) => ({ worklog: (s.worklog ?? []).filter((w) => w.id !== id) })),
      // one timer at a time: starting a new one files the running one first
      startWorkTimer: (t) => {
        if (get().worklogTimer) get().stopWorkTimer();
        const timer = { title: '', projectId: null, project: '', category: 'dev', note: '', ...t, startedAt: new Date().toISOString() };
        set({ worklogTimer: timer });
        return timer;
      },
      // stop → a log entry with the real start and end (under a minute is dropped)
      stopWorkTimer: ({ discard = false } = {}) => {
        const timer = get().worklogTimer;
        if (!timer) return null;
        set({ worklogTimer: null });
        const began = dayjs(timer.startedAt);
        const minutes = Math.round(dayjs().diff(began, 'second') / 60);
        if (discard || minutes < 1) return null;
        // a timer that ran past midnight is filed on the day it started
        const startMin = began.hour() * 60 + began.minute();
        return get().addWorkLog({
          title: timer.title || 'Focused work', note: timer.note, projectId: timer.projectId, project: timer.project, category: timer.category,
          date: began.format('YYYY-MM-DD'), start: fromMin(startMin), end: fromMin(Math.max(startMin + 1, startMin + minutes)), source: 'timer',
        });
      },
      setWorkSummary: (date, text, source = 'manual') =>
        set((s) => {
          const next = { ...(s.worklogSummaries ?? {}) };
          if (text && text.trim()) next[date] = { text: text.trim(), source, updated: new Date().toISOString() };
          else delete next[date];
          return { worklogSummaries: next };
        }),

      // ---------- Life Command Center: focus blocks ----------
      // "Follow the plan" turns the suggested blocks into calendar events of
      // kind 'focus' (each linked to its task), marks the first task as in
      // progress and mirrors the titles into today's plan pills.
      applyPlan: (blocks) => {
        const s = get();
        const key = today();
        blocks.forEach((b) =>
          s.addEvent({ title: b.title, date: key, time: b.start, end: b.end, kind: 'focus', taskId: b.taskId })
        );
        const first = blocks[0] && s.tasks.find((t) => t.id === blocks[0].taskId);
        if (first && first.status === 'todo') s.updateTask(first.id, { status: 'doing' });
        if (blocks.length) s.addPlanItems(blocks.map((b) => b.title));
      },
      clearFocusBlocks: (date = today()) =>
        set((s) => ({ events: s.events.filter((e) => !(e.kind === 'focus' && e.date === date)) })),

      // ---------- MITH NOW: "What should I do now?" (see ai/mithNow.js) ----------
      // nowLearn is what Boss's choices have taught the engine (persisted).
      // nowSession is the focus sprint currently running from the Mith Now sheet.
      nowLearn: emptyLearn(),
      nowSession: null, // { taskId, title, eventId, startedAt, until: 'HH:mm', minutes }
      nowStart: (rec) => {
        const s = get();
        const task = s.tasks.find((t) => t.id === rec.id);
        if (!task) return null;
        const now = dayjs();
        const start = now.format('HH:mm');
        const end = now.add(rec.minutes, 'minute').format('HH:mm');
        // one focus block on today's calendar, linked to the task
        s.clearNowSession();
        s.addEvent({ title: task.title, date: today(), time: start, end, kind: 'focus', taskId: task.id });
        const eventId = get().events[0]?.id ?? null;
        if (task.status === 'todo') s.updateTask(task.id, { status: 'doing' });
        const session = { taskId: task.id, title: task.title, eventId, startedAt: now.toISOString(), until: end, minutes: rec.minutes };
        set((st) => ({ nowSession: session, nowLearn: learnStart(st.nowLearn, task, now) }));
        return session;
      },
      nowSkip: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return;
        set((st) => ({ nowLearn: learnSkip(st.nowLearn, task, dayjs()) }));
      },
      // Done: the task completes, the real duration calibrates future estimates.
      nowFinish: () => {
        const s = get();
        const sess = s.nowSession;
        if (!sess) return;
        const task = s.tasks.find((t) => t.id === sess.taskId);
        const spent = Math.round(dayjs().diff(dayjs(sess.startedAt), 'minute'));
        if (task && task.status !== 'done') s.completeTask(task.id);
        if (sess.eventId) s.updateEvent(sess.eventId, { end: dayjs().format('HH:mm') });
        set((st) => ({ nowSession: null, nowLearn: task ? learnFinish(st.nowLearn, task, spent) : st.nowLearn }));
      },
      // Stop early: the task stays open, the focus block shrinks to what was used.
      clearNowSession: () => {
        const sess = get().nowSession;
        if (!sess) return;
        if (sess.eventId) {
          const spent = dayjs().diff(dayjs(sess.startedAt), 'minute');
          if (spent < 3) get().deleteEvent(sess.eventId);
          else get().updateEvent(sess.eventId, { end: dayjs().format('HH:mm') });
        }
        set({ nowSession: null });
      },
      resetNowLearn: () => set({ nowLearn: emptyLearn() }),

      // ---------- automatic project creation (see ai/projectPlanner.js) ----------
      // A sentence like "I need to launch my portfolio website next month" becomes
      // a pending proposal — milestones and dated tasks — that the user reviews
      // before anything is created. Session-only (excluded from persistence).
      pendingProposal: null, // { text, intent, plan, ts }
      proposeProject: (text, intent) => {
        const plan = buildPlan(intent);
        set({ pendingProposal: { text, intent, plan, ts: Date.now() } });
        return plan;
      },
      discardProposal: () => set({ pendingProposal: null }),
      // `plan` may be the edited version from the proposal sheet; `selected` a Set of plan task ids
      createProposedProject: (plan = null, selected = null) => {
        const pending = get().pendingProposal;
        const chosen = plan ?? pending?.plan;
        if (!chosen) return null;
        const result = createProjectFromPlan(chosen, get(), selected);
        set({ pendingProposal: null });
        return result;
      },

      // ---------- cloud sync status (session-only, driven by cloud/autoSync.js) ----------
      syncState: 'off', // off | syncing | synced | conflict | offline | error
      syncError: null,
      lastSyncAt: null,
      syncConflict: null,
      // Empty every collection (settings and the sync key stay). With auto-sync
      // on, the empty snapshot is pushed, so every other device empties too.
      resetData: () =>
        set((s) => ({
          tasks: [], projects: [], notes: [], files: [], drive: [], habits: [], transactions: [], journal: [],
          plans: {}, learning: [], events: [], plannerSessions: [], chat: [], chatHistory: [], notifyMuted: {},
          worklog: [], worklogSummaries: {}, worklogTimer: null,
          nowSession: null, pendingProposal: null,
          xp: { points: 0, streakCount: 0, streakLastDate: null },
          settings: { ...s.settings, seeded: true, seededV2: true, seededV3: true },
        })),

      // ---------- Myth Planner (trips, events, study… see ai/planner.js) ----------
      // One session per plan: draft → planned → confirmed → live → done.
      plannerSessions: [],
      addPlannerSession: (s) => {
        const sess = {
          id: uid(), created: new Date().toISOString(), status: 'draft', mode: 'generic', title: '',
          input: {}, result: null, chosen: null, projectId: null, live: null, packingDone: [], chat: [], ...s,
        };
        set((st) => ({ plannerSessions: [sess, ...(st.plannerSessions ?? [])] }));
        return sess;
      },
      updatePlannerSession: (id, patch) =>
        set((st) => ({
          plannerSessions: (st.plannerSessions ?? []).map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)),
        })),
      deletePlannerSession: (id) => set((st) => ({ plannerSessions: (st.plannerSessions ?? []).filter((s) => s.id !== id) })),

      // ---------- assistant chat (sessions; history auto-deletes after 3 days) ----------
      chat: [],
      chatHistory: [], // [{ id, ts, messages: [...] }] — newest first
      pushChat: (msg) => {
        const entry = { id: uid(), ts: Date.now(), ...msg };
        set((s) => ({ chat: [...s.chat.slice(-80), entry] }));
        return entry.id;
      },
      updateChat: (id, patch) =>
        set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      clearChat: () => set({ chat: [] }),
      // Archive the current conversation (if any) and start clean.
      startNewChat: () =>
        set((s) => {
          const history = pruneChatHistory(s.chatHistory);
          if (!s.chat.length) return { chatHistory: history };
          return {
            chat: [],
            chatHistory: [{ id: uid(), ts: Date.now(), messages: s.chat }, ...history].slice(0, 30),
          };
        }),
      // Bring a past conversation back; the current one is archived first.
      loadChatSession: (id) =>
        set((s) => {
          const sess = s.chatHistory.find((h) => h.id === id);
          if (!sess) return {};
          const rest = pruneChatHistory(s.chatHistory.filter((h) => h.id !== id));
          return {
            chat: sess.messages,
            chatHistory: s.chat.length ? [{ id: uid(), ts: Date.now(), messages: s.chat }, ...rest] : rest,
          };
        }),
      deleteChatSession: (id) =>
        set((s) => ({ chatHistory: s.chatHistory.filter((h) => h.id !== id) })),
      pruneChat: () => set((s) => ({ chatHistory: pruneChatHistory(s.chatHistory) })),
    }),
    {
      name: 'myth-db',
      version: 10,
      // ask for the password on every visit — auth state is session-only
      partialize: (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !['authed', 'pendingProposal', 'syncState', 'syncError', 'lastSyncAt', 'syncConflict'].includes(k))),
      migrate: (persisted, version) => {
        if (version < 2 && persisted?.settings) {
          // v2: auto-select the best installed model instead of a hardcoded one
          persisted.settings.aiModel = '';
        }
        if (version < 3 && persisted) {
          // v3: chat sessions — old running chat becomes the first history entry
          persisted.chatHistory = persisted.chat?.length
            ? [{ id: uid(), ts: Date.now(), messages: persisted.chat }]
            : [];
          persisted.chat = [];
        }
        if (version < 4 && persisted) {
          // work + personal merged into one flow: fold every 'personal' item into 'work'
          const fold = (arr) => (Array.isArray(arr) ? arr.map((x) => (x?.mode === 'personal' ? { ...x, mode: 'work' } : x)) : arr);
          ['tasks', 'projects', 'notes', 'events', 'habits', 'files', 'journal', 'learning'].forEach((k) => { if (persisted[k]) persisted[k] = fold(persisted[k]); });
          if (persisted.plans) {
            const merged = {};
            Object.entries(persisted.plans).forEach(([key, items]) => {
              const k = key.replace(/\|personal$/, '|work');
              merged[k] = [...(merged[k] ?? []), ...(items ?? [])];
            });
            persisted.plans = merged;
          }
          if (persisted.settings) persisted.settings.mode = 'work';
        }
        if (version < 5 && persisted?.settings) {
          // v5: cloud sync moved from Supabase to Netlify Blobs — old credentials are meaningless now
          delete persisted.settings.supabaseUrl;
          delete persisted.settings.supabaseKey;
          persisted.settings.cloudKey ??= '';
          persisted.settings.cloudUrl ??= '';
        }
        if (version < 6 && persisted) {
          // v6: one flow for everything — the work/personal split is gone.
          // Plan keys lose their "|mode" suffix and items drop the stale mode field.
          const strip = (arr) => (Array.isArray(arr) ? arr.map((x) => {
            if (!x || typeof x !== 'object') return x;
            const rest = { ...x };
            delete rest.mode;
            return rest;
          }) : arr);
          ['tasks', 'projects', 'notes', 'events', 'habits', 'files', 'journal', 'learning'].forEach((k) => { if (persisted[k]) persisted[k] = strip(persisted[k]); });
          if (persisted.plans) {
            const merged = {};
            Object.entries(persisted.plans).forEach(([key, items]) => {
              const k = key.split('|')[0];
              merged[k] = [...(merged[k] ?? []), ...(items ?? [])];
            });
            persisted.plans = merged;
          }
          if (persisted.settings) delete persisted.settings.mode;
        }
        if (version < 7 && persisted) {
          // v7: notification intelligence — delivery preferences and the snooze/dismiss map
          persisted.settings ??= {};
          persisted.settings.notifyBudget ??= 4;
          persisted.settings.quietStart ??= 22;
          persisted.settings.quietEnd ??= 7;
          persisted.notifyMuted ??= {};
        }
        if (version < 8 && persisted) {
          // v8: learning items can hold notes, files and links; the planner may use its own ChatGPT key
          if (Array.isArray(persisted.learning)) {
            persisted.learning = persisted.learning.map((l) => (l && typeof l === 'object' ? { notes: '', fileIds: [], links: [], ...l } : l));
          }
          persisted.settings ??= {};
          persisted.settings.plannerAiEndpoint ??= '';
          persisted.settings.plannerAiKey ??= '';
          persisted.settings.plannerAiModel ??= '';
        }
        if (version < 9 && persisted) {
          // v9: reminders
          persisted.reminders ??= [];
        }
        if (version < 10 && persisted) {
          // v10: Track — the daily work log, its summaries and the running timer
          persisted.worklog ??= [];
          persisted.worklogSummaries ??= {};
          persisted.worklogTimer ??= null;
        }
        return persisted;
      },
    }
  )
);

// selector helpers
export const levelFromXp = (points) => Math.floor(Math.sqrt(points / 40)) + 1;
export const levelProgress = (points) => {
  const lvl = levelFromXp(points);
  const cur = 40 * (lvl - 1) ** 2;
  const next = 40 * lvl ** 2;
  return { lvl, pct: Math.round(((points - cur) / (next - cur)) * 100), next: next - points };
};
