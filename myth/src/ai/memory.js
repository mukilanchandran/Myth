// Short-term conversational memory shared by the assistant and the voice
// layer: what "this" refers to, which project was last in play, and the
// question Mith is waiting on ("Want me to move them?"). Session-only —
// never persisted, reset on reload.
export const memory = {
  lastItem: null,      // { type: 'task' | 'event' | 'habit' | 'project', id, title }
  lastProjectId: null, // the project last mentioned, created or attached to
  pending: null,       // { kind: 'confirm' | 'pick-project', prompt, ...payload }
  lastReply: '',
  updatedAt: 0,
};

export function remember(patch) {
  Object.assign(memory, patch, { updatedAt: Date.now() });
}

export function setPending(pending) {
  memory.pending = pending ? { ...pending, askedAt: Date.now() } : null;
}

export function clearPending() {
  memory.pending = null;
}

export function resetMemory() {
  memory.lastItem = null;
  memory.lastProjectId = null;
  memory.pending = null;
  memory.lastReply = '';
  memory.updatedAt = 0;
}
