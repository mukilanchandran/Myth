// Session-only UI state: which panel is open and which graph node the Context
// panel should focus. Lives outside Shell so any component (a widget, the Today
// panel, a reminder row, the assistant) can deep-link into a panel.
import { create } from 'zustand';

export const useUI = create((set) => ({
  panel: null,
  contextId: null,
  setPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  // open the Context engine on a specific node id, e.g. "note:abc" or "project:xyz"
  openContext: (contextId) => set({ panel: 'context', contextId }),
}));
