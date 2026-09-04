import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import dayjs from 'dayjs';
import { APP_PASSWORD, AI_MODEL } from '../config/env';

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
        mode: 'work', // single combined flow (work + personal merged)
        aiEndpoint: '',
        aiModel: AI_MODEL, // empty = auto-pick the best installed model
        aiKey: '',
        cloudKey: '', // Netlify sync key (= MYTH_SYNC_KEY on the site) — Settings → Cloud storage & sync
        cloudUrl: '', // optional Netlify site URL when the app runs elsewhere (dev server, Docker)
        notifications: true,
        seeded: false,
      },
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

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
              id: uid(), title: '', desc: '', mode: s.settings.mode, projectId: null,
              priority: 3, status: 'todo', due: null, tags: [], estimate: null,
              created: new Date().toISOString(), completedAt: null, ...t,
            },
            ...s.tasks,
          ],
        })),
      updateTask: (id, patch) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
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
          id: uid(), name: 'Untitled project', desc: '', mode: get().settings.mode,
          color: '#12a150', status: 'active', deadline: null, milestones: [],
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
          id: uid(), title: '', body: '', type: 'note', mode: get().settings.mode,
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
              text: text ?? '', mode: s.settings.mode,
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
      plans: {}, // `${YYYY-MM-DD}|${mode}` -> [{id, text, done, doneAt}]
      addPlanItems: (texts) =>
        set((s) => {
          const key = `${today()}|${s.settings.mode}`;
          const existing = s.plans[key] ?? [];
          const fresh = texts
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && !existing.some((e) => e.text.toLowerCase() === t.toLowerCase()))
            .map((t) => ({ id: uid(), text: t, done: false, doneAt: null }));
          return { plans: { ...s.plans, [key]: [...existing, ...fresh] } };
        }),
      togglePlanItem: (id) => {
        const s = get();
        const key = `${today()}|${s.settings.mode}`;
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
          const key = `${today()}|${s.settings.mode}`;
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
            { id: uid(), title: '', date: today(), time: null, kind: 'event', mode: s.settings.mode, yearly: false, ...e },
            ...s.events,
          ],
        })),
      deleteEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),

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
      version: 5,
      // ask for the password on every visit — auth state is session-only
      partialize: (s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'authed')),
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
        return persisted;
      },
    }
  )
);

// selector helpers
export const inMode = (items, mode) => items.filter((i) => i.mode === mode);
export const levelFromXp = (points) => Math.floor(Math.sqrt(points / 40)) + 1;
export const levelProgress = (points) => {
  const lvl = levelFromXp(points);
  const cur = 40 * (lvl - 1) ** 2;
  const next = 40 * lvl ** 2;
  return { lvl, pct: Math.round(((points - cur) / (next - cur)) * 100), next: next - points };
};
