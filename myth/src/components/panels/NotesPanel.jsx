import { useState } from 'react';
import {
  Stack, Group, Text, Badge, ActionIcon, TextInput, Button, Box, Modal, Textarea,
  SegmentedControl, Select,
} from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import { IconPlus, IconTrash, IconPin, IconPinFilled, IconBulb, IconNotes, IconUsers, IconSparkles } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { aiMeetingSummary } from '../../ai/assistant';

export function NoteEditor({ note, onClose }) {
  const { updateNote, deleteNote, projects } = useStore();
  const [summarizing, setSummarizing] = useState(false);
  const isMeeting = note.type === 'meeting';
  const m = note.meeting ?? {};

  const patchMeeting = (patch) => updateNote(note.id, { meeting: { ...m, ...patch } });

  const summarize = async () => {
    setSummarizing(true);
    try {
      const state = useStore.getState();
      const fresh = state.notes.find((n) => n.id === note.id) ?? note;
      const result = await aiMeetingSummary(fresh, state);
      if (!result) {
        notifications.show({ color: 'orange', title: 'AI model not reachable', message: 'Start Ollama on this device (Settings → AI brain) and try again.' });
      } else {
        const stamp = `— AI summary (${result.model}) —\n${result.text.trim()}`;
        const existing = (fresh.body ?? '').replace(/— AI summary[\s\S]*$/, '').trim();
        updateNote(note.id, { body: existing ? `${existing}\n\n${stamp}` : stamp });
        notifications.show({ color: 'green', title: 'Meeting summarized', message: 'Minutes and action items added to the note.' });
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Summary failed', message: e.message });
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size="lg" radius="xl" title={
      <Group gap={8}>
        <Badge variant="light" color={isMeeting ? 'violet' : note.type === 'idea' ? 'yellow' : 'teal'}>{note.type}</Badge>
        <Text fw={700} fz={15}>Edit</Text>
      </Group>
    }>
      <Stack gap="sm">
        <TextInput
          size="md" radius="md" placeholder="Title" defaultValue={note.title}
          onBlur={(e) => updateNote(note.id, { title: e.currentTarget.value })}
          styles={{ input: { fontWeight: 700 } }}
        />
        {isMeeting && (
          <>
            <Group grow>
              <DateInput
                radius="md" label="Date" size="sm"
                value={m.date ?? null}
                onChange={(v) => patchMeeting({ date: v ? dayjs(v).format('YYYY-MM-DD') : null })}
              />
              <TimeInput radius="md" label="Time" size="sm" defaultValue={m.time ?? ''} onBlur={(e) => patchMeeting({ time: e.currentTarget.value })} />
            </Group>
            <TextInput radius="md" label="Participants" size="sm" leftSection={<IconUsers size={15} />}
              defaultValue={m.participants} onBlur={(e) => patchMeeting({ participants: e.currentTarget.value })} />
            <Textarea radius="md" label="Agenda / discussion" autosize minRows={2}
              defaultValue={m.agenda} onBlur={(e) => patchMeeting({ agenda: e.currentTarget.value })} />
            <Textarea radius="md" label="Action items (one per line)" autosize minRows={2}
              defaultValue={m.actions} onBlur={(e) => patchMeeting({ actions: e.currentTarget.value })} />
            <Button
              size="xs" radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }}
              leftSection={<IconSparkles size={14} />} loading={summarizing} onClick={summarize}
              style={{ alignSelf: 'flex-start' }}
            >
              Summarize with AI
            </Button>
          </>
        )}
        <Textarea
          key={`body-${note.updated}`}
          radius="md" label={isMeeting ? 'Extra notes' : 'Note'} placeholder="Write freely…" autosize minRows={isMeeting ? 2 : 6}
          defaultValue={note.body}
          onBlur={(e) => updateNote(note.id, { body: e.currentTarget.value })}
        />
        <Select
          radius="md" label="Linked project" clearable size="sm"
          data={projects.map((p) => ({ value: p.id, label: p.name }))}
          value={note.projectId}
          onChange={(v) => updateNote(note.id, { projectId: v })}
        />
        <Group justify="space-between">
          <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />}
            onClick={() => { deleteNote(note.id); onClose(); }}>
            Delete
          </Button>
          <Button radius="xl" onClick={onClose}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function NotesPanel() {
  const { notes, addNote, updateNote, projects } = useStore();
  const [tab, setTab] = useState('all');
  const [editId, setEditId] = useState(null);
  const [quick, setQuick] = useState('');

  const mine = notes
    .filter((n) => tab === 'all' || n.type === tab)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated.localeCompare(a.updated));

  const editNote = notes.find((n) => n.id === editId);

  return (
    <Stack gap="md">
      <Group gap="xs">
        <TextInput
          style={{ flex: 1 }} radius="xl" placeholder="New note or idea title…"
          value={quick} onChange={(e) => setQuick(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && quick.trim()) {
              const n = addNote({ title: quick.trim(), type: tab === 'idea' ? 'idea' : 'note' });
              setQuick(''); setEditId(n.id);
            }
          }}
        />
        <Button radius="xl" leftSection={<IconPlus size={16} />}
          onClick={() => { if (quick.trim()) { const n = addNote({ title: quick.trim(), type: tab === 'idea' ? 'idea' : 'note' }); setQuick(''); setEditId(n.id); } }}>
          Add
        </Button>
      </Group>
      <SegmentedControl
        value={tab} onChange={setTab} radius="xl" size="sm" fullWidth
        styles={{ root: { background: '#f1f4f2' } }}
        data={[
          { value: 'all', label: 'All' },
          { value: 'note', label: 'Notes' },
          { value: 'idea', label: 'Ideas' },
          { value: 'meeting', label: 'Meetings' },
        ]}
      />
      <Stack gap={8}>
        {mine.length === 0 && (
          <Text c="dimmed" ta="center" py="xl" fz={14}>
            Nothing here yet. Try capturing “idea: …” or “meeting with team tomorrow 11am” from the landing bar.
          </Text>
        )}
        {mine.map((n) => {
          const proj = projects.find((p) => p.id === n.projectId);
          return (
            <Box key={n.id} className="glass hover-lift" p="md" style={{ borderRadius: 14, cursor: 'pointer' }} onClick={() => setEditId(n.id)}>
              <Group gap={8} wrap="nowrap">
                {n.type === 'idea' ? <IconBulb size={17} color="#f08c00" /> : <IconNotes size={17} color="#1b5a38" />}
                <Box style={{ flex: 1 }}>
                  <Text fw={650} fz={14}>{n.title}</Text>
                  <Group gap={6} mt={2}>
                    <Badge size="xs" variant="light" color={n.type === 'meeting' ? 'violet' : n.type === 'idea' ? 'yellow' : 'teal'}>{n.type}</Badge>
                    {proj && <Badge size="xs" variant="light" color="teal">{proj.name}</Badge>}
                    {n.type === 'meeting' && n.meeting?.date && <Badge size="xs" variant="light">{dayjs(n.meeting.date).format('MMM D')}{n.meeting.time ? ` · ${n.meeting.time}` : ''}</Badge>}
                    <Text fz={11} c="dimmed">{dayjs(n.updated).fromNow ? dayjs(n.updated).format('MMM D') : dayjs(n.updated).format('MMM D')}</Text>
                  </Group>
                  {n.body && <Text fz={12.5} c="dimmed" lineClamp={1} mt={4}>{n.body}</Text>}
                </Box>
                <ActionIcon variant="subtle" color={n.pinned ? 'orange' : 'gray'}
                  onClick={(e) => { e.stopPropagation(); updateNote(n.id, { pinned: !n.pinned }); }}>
                  {n.pinned ? <IconPinFilled size={16} /> : <IconPin size={16} />}
                </ActionIcon>
              </Group>
            </Box>
          );
        })}
      </Stack>
      {editNote && <NoteEditor note={editNote} onClose={() => setEditId(null)} />}
    </Stack>
  );
}
