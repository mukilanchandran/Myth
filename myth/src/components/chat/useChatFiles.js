// Files handed to the assistant: stored right away (blob in IndexedDB, meta
// in `files` so it syncs), text extracted for the model, then attached to the
// next message you send. Shared by the inline chat and the full assistant.
import { useCallback, useState } from 'react';
import { useStore, uid } from '../../store/useStore';
import { putBlob, deleteBlob } from '../../store/fileStore';
import { extractText } from '../../ai/docgen';

const EXCERPT = 6000; // characters of text kept on the message (the rest stays in the blob)

export function useChatFiles() {
  const [pending, setPending] = useState([]); // [{ id, name, type, size, text, busy }]
  const addFileMeta = useStore((s) => s.addFileMeta);
  const deleteFileMeta = useStore((s) => s.deleteFileMeta);

  const ingest = useCallback(async (list) => {
    const files = Array.from(list ?? []).filter(Boolean);
    for (const file of files) {
      const id = uid();
      const name = file.name || `pasted-${Date.now()}.${(file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '')}`;
      setPending((p) => [{ id, name, type: file.type, size: file.size, text: '', busy: true }, ...p]);
      try {
        await putBlob(id, file);
        addFileMeta({ id, name, size: file.size, type: file.type, projectId: null, learningId: null, source: 'chat', title: name.replace(/\.[a-z0-9]+$/i, '') });
        const text = (await extractText(file, { maxChars: 40000 })).slice(0, EXCERPT);
        setPending((p) => p.map((f) => (f.id === id ? { ...f, text, busy: false } : f)));
      } catch {
        setPending((p) => p.filter((f) => f.id !== id));
      }
    }
  }, [addFileMeta]);

  const remove = useCallback((id) => {
    setPending((p) => p.filter((f) => f.id !== id));
    deleteBlob(id).catch(() => {});
    deleteFileMeta(id);
  }, [deleteFileMeta]);

  // hand the ready files to the message being sent and clear the tray
  const take = useCallback(() => {
    const ready = pending.filter((f) => !f.busy).map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, text: f.text }));
    setPending((p) => p.filter((f) => f.busy));
    return ready;
  }, [pending]);

  return { pending, ingest, remove, take, busy: pending.some((f) => f.busy) };
}
