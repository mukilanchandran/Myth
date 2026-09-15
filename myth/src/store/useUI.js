// Session-only UI state: which panel is open, which planner session is on
// screen and whether the floating assistant is open. Lives outside Shell so
// any component (a widget, the Today panel, a reminder row, the assistant
// itself) can deep-link.
import { create } from 'zustand';

export const useUI = create((set) => ({
  panel: null,
  setPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),

  // Myth Planner: the session shown in the planner (inline under the capture bar or in its module)
  plannerFocusId: null,
  setPlannerFocus: (plannerFocusId) => set({ plannerFocusId }),
  // the capture bar asks the shell to show the planner inline; the assistant's
  // "plan a trip" action does the same from anywhere in the app
  plannerInline: false,
  showPlannerInline: (open = true) => set({ plannerInline: open }),

  // the floating Myth AI — reachable from every panel
  assistantOpen: false,
  assistantSeed: null, // a question to ask as soon as it opens
  openAssistant: (seed = null) => set({ assistantOpen: true, assistantSeed: seed }),
  closeAssistant: () => set({ assistantOpen: false, assistantSeed: null }),
  consumeAssistantSeed: () => set({ assistantSeed: null }),
}));
