import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import dayjs from 'dayjs';
import { APP_PASSWORD, AI_MODEL } from '../config/env';
import { buildPlan, createProjectFromPlan } from '../ai/projectPlanner';
import { emptyLearn, learnSkip, learnStart, learnFinish } from '../ai/mithNow';

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
      // optional fields: noteId (the meeting a follow-up / action item came from), tags
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
          notes: s.notes.map((n) => (n.projectId === id ? { ...n, projectId: null } : n)),
        })),

      // ---------- notes / ideas / meetings ----------
      notes: [],
      addNote: (n) => {
        const note = {
          id: uid(), title: '', body: '', type: 'note',
          projectId: null, pinned: false, meeting: null,
          created: new Date().toISOString(), updated: new Date().toISOString(), ...n,
        };
        set((s) => ({ notes: [note, ...s.notes] }));
        return note;
      },
      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updated: new Date().toISOString() } : n)),
        })),
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      // ---------- files (meta only; blobs live in IndexedDB) ----------
      files: [],
      addFileMeta: (f) => set((s) => ({ files: [{ id: uid(), created: new Date().toISOString(), ...f }, ...s.files] })),
      deleteFileMeta: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),

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
      learning: [],
      addLearning: (title) =>
        set((s) => ({ learning: [...s.learning, { id: uid(), title, stage: 0, created: new Date().toISOString() }] })),
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
      version: 7,
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
