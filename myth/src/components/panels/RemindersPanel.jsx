// Reminders — nudges at the right time, once or on repeat.
//   • type it like you'd say it ("call Ravi tomorrow 5pm", "pay rent every 1st",
//     "water the plants every evening") — the preview shows what Myth understood
//   • Myth suggests reminders from the calendar, due tasks, bills and birthdays
//   • sections: overdue, today, tomorrow, this week, later, done
//   • each row: done (a repeat rolls to its next date), snooze presets, move,
//     repeat, edit, delete
//   • reminders fire as notifications at their time (see ai/reminders.js)
import { useEffect, useMemo, useState } from 'react';
import {
  Stack, Group, Text, Box, TextInput, Button, ActionIcon, Badge, Menu, Modal, Select, Textarea, Tooltip, Anchor, Collapse,
} from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import {
  IconBellPlus, IconBellRinging, IconCheck, IconRepeat, IconAlarmSnooze, IconDots, IconTrash, IconPencil, IconPlus,
  IconSparkles, IconArrowForward, IconChevronDown, IconChevronUp, IconRotate, IconBellOff,
} from '@tabler/icons-react';
import { notifications as toast } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import {
  parseReminder, groupReminders, describeWhen, snoozeOptions, quickPhrases, suggestReminders, REPEATS, CATEGORIES, activeReminders,
} from '../../ai/reminders';
import { notifyStatus, enableNotifications } from '../../notify';
import EmptyState from '../EmptyState';
import '../reminders.css';

const SECTIONS = [
  ['overdue', 'Overdue', '#e03131'],
  ['today', 'Today', '#0D2D1C'],
  ['tomorrow', 'Tomorrow', '#1971c2'],
  ['week', 'This week', '#7048e8'],
  ['later', 'Later', '#868e96'],
];

function useNow() {
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function EditModal({ reminder, onClose }) {
  const updateReminder = useStore((s) => s.updateReminder);
  const [form, setForm] = useState(() => ({
    title: reminder.title, note: reminder.note ?? '', date: reminder.date, time: reminder.time ?? '', repeat: reminder.repeat ?? 'none', category: reminder.category ?? 'personal',
  }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    if (!form.title.trim()) return;
    updateReminder(reminder.id, { title: form.title.trim(), note: form.note.trim(), date: form.date, time: form.time || null, repeat: form.repeat, category: form.category, snoozedUntil: null });
    onClose();
  };
  return (
    <Modal opened onClose={onClose} radius="xl" centered title={<Text fw={800} fz={17}>Edit reminder</Text>}>
      <Stack gap="sm">
        <TextInput radius="md" label="Reminder" value={form.title} onChange={(e) => set('title', e.currentTarget.value)} data-autofocus />
        <Group grow>
          <DateInput radius="md" label="Date" value={dayjs(form.date).toDate()} onChange={(v) => v && set('date', dayjs(v).format('YYYY-MM-DD'))} />
          <TimeInput radius="md" label="Time (optional)" value={form.time} onChange={(e) => set('time', e.currentTarget.value)} />
        </Group>
        <Group grow>
          <Select radius="md" label="Repeat" data={Object.entries(REPEATS).map(([value, label]) => ({ value, label }))} value={form.repeat} onChange={(v) => v && set('repeat', v)} allowDeselect={false} />
          <Select radius="md" label="Category" data={Object.entries(CATEGORIES).map(([value, c]) => ({ value, label: c.label }))} value={form.category} onChange={(v) => v && set('category', v)} allowDeselect={false} />
        </Group>
        <Textarea radius="md" label="Note (optional)" autosize minRows={2} value={form.note} onChange={(e) => set('note', e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" radius="xl" onClick={onClose}>Cancel</Button>
          <Button radius="xl" onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ReminderRow({ r, now, onEdit }) {
  const completeReminder = useStore((s) => s.completeReminder);
  const snoozeReminder = useStore((s) => s.snoozeReminder);
  const updateReminder = useStore((s) => s.updateReminder);
  const deleteReminder = useStore((s) => s.deleteReminder);
  const reopenReminder = useStore((s) => s.reopenReminder);
  const cat = CATEGORIES[r.category] ?? CATEGORIES.personal;
  const repeating = r.repeat && r.repeat !== 'none';
  const whenColor = r.status === 'overdue' ? '#e03131' : r.status === 'soon' ? '#f08c00' : r.status === 'snoozed' ? '#868e96' : '#0D2D1C';

  const done = () => {
    completeReminder(r.id);
    toast.show({ color: 'forest', message: repeating ? `"${r.title}" done — next ${describeWhen({ ...r, snoozedUntil: null, date: r.date }, now).toLowerCase()}` : `"${r.title}" done ✓` });
  };
  const move = (days) => updateReminder(r.id, { date: dayjs(r.date).add(days, 'day').format('YYYY-MM-DD'), snoozedUntil: null });

  return (
    <div className={`rem-row${r.status === 'overdue' ? ' is-overdue' : ''}${r.status === 'soon' ? ' is-soon' : ''}${r.done ? ' is-done' : ''}`}>
      {r.done ? (
        <Tooltip label="Reopen"><button type="button" className="rem-check is-on" onClick={() => reopenReminder(r.id)} aria-label="Reopen"><IconRotate size={12} stroke={3} /></button></Tooltip>
      ) : (
        <Tooltip label={repeating ? 'Done for now — rolls to the next one' : 'Done'}><button type="button" className="rem-check" onClick={done} aria-label="Done"><IconCheck size={13} stroke={3} /></button></Tooltip>
      )}
      <div className="rem-body">
        <div className="rem-title">{r.title}{repeating && <Tooltip label={REPEATS[r.repeat]}><IconRepeat size={12} /></Tooltip>}</div>
        <div className="rem-meta">
          <span className="rem-when" style={{ '--c': whenColor }}>{describeWhen(r, now)}</span>
          <span className="rem-cat" style={{ '--c': cat.color }}>{cat.label}</span>
          {repeating && <span>{REPEATS[r.repeat]}{r.timesDone ? ` · ${r.timesDone}×` : ''}</span>}
          {r.note && <span className="rem-note">· {r.note}</span>}
        </div>
      </div>
      <div className="rem-actions">
        {!r.done && (
          <Menu position="bottom-end" radius="md" shadow="md" width={200}>
            <Menu.Target><Tooltip label="Snooze"><ActionIcon variant="subtle" color="gray" size="sm" aria-label="Snooze"><IconAlarmSnooze size={15} /></ActionIcon></Tooltip></Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Snooze for</Menu.Label>
              {snoozeOptions(now).map((o) => <Menu.Item key={o.key} onClick={() => snoozeReminder(r.id, o.until)}>{o.label}</Menu.Item>)}
            </Menu.Dropdown>
          </Menu>
        )}
        <Menu position="bottom-end" radius="md" shadow="md" width={210}>
          <Menu.Target><ActionIcon variant="subtle" color="gray" size="sm" aria-label="More"><IconDots size={15} /></ActionIcon></Menu.Target>
          <Menu.Dropdown>
            {!r.done && (
              <>
                <Menu.Item leftSection={<IconArrowForward size={14} />} onClick={() => move(1)}>Move to tomorrow</Menu.Item>
                <Menu.Item leftSection={<IconArrowForward size={14} />} onClick={() => move(7)}>Move a week later</Menu.Item>
                <Menu.Label>Repeat</Menu.Label>
                {Object.entries(REPEATS).map(([k, label]) => (
                  <Menu.Item key={k} leftSection={r.repeat === k ? <IconCheck size={14} /> : <span style={{ width: 14 }} />} onClick={() => updateReminder(r.id, { repeat: k })}>{label}</Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(r)}>Edit…</Menu.Item>
              </>
            )}
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => deleteReminder(r.id)}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </div>
  );
}

export default function RemindersPanel() {
  const reminders = useStore((s) => s.reminders ?? []);
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.events);
  const addReminder = useStore((s) => s.addReminder);
  const deleteReminder = useStore((s) => s.deleteReminder);
  const openAssistant = useUI((s) => s.openAssistant);
  const now = useNow();
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [permission, setPermission] = useState(() => notifyStatus());

  const preview = useMemo(() => (value.trim().length > 2 ? parseReminder(value, now.toDate()) : null), [value, now]);
  const groups = useMemo(() => groupReminders(reminders, now), [reminders, now]);
  const suggestions = useMemo(() => suggestReminders({ reminders, tasks, events }, now), [reminders, tasks, events, now]);
  const active = activeReminders(reminders);
  const repeating = active.filter((r) => r.repeat && r.repeat !== 'none').length;

  const add = () => {
    const parsed = parseReminder(value, now.toDate());
    if (!parsed) return;
    addReminder({ ...parsed, source: 'manual' });
    setValue('');
    toast.show({ color: 'forest', title: 'Reminder set', message: `${parsed.title} — ${describeWhen(parsed, now)}${parsed.repeat !== 'none' ? ` · ${REPEATS[parsed.repeat].toLowerCase()}` : ''}` });
  };
  const addSuggestion = (s) => {
    addReminder({ title: s.title, date: s.date, time: s.time, repeat: s.repeat, category: s.category, note: '', source: 'suggested' });
    toast.show({ color: 'forest', message: `Reminder set — ${s.title}` });
  };
  const appendPhrase = (phrase) => setValue((v) => `${v.trim()} ${phrase}`.trim());
  const enable = async () => {
    const res = await enableNotifications();
    setPermission(notifyStatus());
    if (!res.ok) toast.show({ color: 'orange', title: 'Not enabled', message: res.reason });
  };
  const clearDone = () => groups.done.forEach((r) => deleteReminder(r.id));

  const empty = reminders.length === 0;

  return (
    <Stack gap="md">
      <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
        <Group gap="xs">
          <TextInput
            style={{ flex: 1 }} radius="xl" leftSection={<IconBellPlus size={16} />}
            placeholder='Remind me… "call Ravi tomorrow 5pm", "pay rent every 1st", "water the plants every evening"'
            value={value} onChange={(e) => setValue(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button radius="xl" leftSection={<IconBellRinging size={15} />} disabled={!preview} onClick={add}>Remind me</Button>
        </Group>
        {preview ? (
          <div className="rem-preview">
            <Badge color="forest" variant="filled" radius="sm">{describeWhen(preview, now)}</Badge>
            {preview.repeat !== 'none' && <Badge variant="light" color="forest" radius="sm" leftSection={<IconRepeat size={11} />}>{REPEATS[preview.repeat]}</Badge>}
            <Badge variant="outline" radius="sm" color="gray">{CATEGORIES[preview.category]?.label}</Badge>
            <span className="rem-preview-title">“{preview.title}”</span>
          </div>
        ) : (
          <Text fz={11.5} c="dimmed" mt={6}>Say when and how often in plain words — Myth picks up the date, the time and the repeat. No time means first thing that day.</Text>
        )}
        <div className="rem-quick">
          {quickPhrases(now).map((q) => <button key={q.label} type="button" onClick={() => appendPhrase(q.phrase)}>{q.label}</button>)}
        </div>
      </Box>

      {permission !== 'granted' && (
        <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={8} wrap="nowrap">
              <IconBellOff size={18} color="#e8590c" />
              <Text fz={12.5}>Turn on notifications so reminders reach you at their time, even when Myth is in the background.</Text>
            </Group>
            <Button size="xs" radius="xl" variant="light" style={{ flexShrink: 0 }} onClick={enable}>Enable</Button>
          </Group>
        </Box>
      )}

      {suggestions.length > 0 && (
        <Box className="glass" p="sm" style={{ borderRadius: 16 }}>
          <Group justify="space-between" mb={8}>
            <Group gap={6}><IconSparkles size={15} color="#f0a316" /><Text fw={700} fz={13}>Myth suggests</Text></Group>
            <Anchor fz={12} fw={600} onClick={() => openAssistant('Look at my reminders, tasks and calendar — what should I set a reminder for, and is anything overdue?')}>Ask Myth</Anchor>
          </Group>
          <Stack gap={6}>
            {suggestions.map((s) => (
              <button key={s.key} type="button" className="rem-suggest" onClick={() => addSuggestion(s)}>
                <div>
                  <b>{s.title}</b>
                  <small>{s.why} · {describeWhen(s, now)}</small>
                </div>
                <span className="rem-suggest-add"><IconPlus size={13} stroke={2.5} /></span>
              </button>
            ))}
          </Stack>
        </Box>
      )}

      {!empty && (
        <div className="rem-stats">
          <div className="rem-stat" style={{ '--c': '#e03131' }}><b>{groups.overdue.length}</b><span>overdue</span></div>
          <div className="rem-stat"><b>{groups.today.length}</b><span>today</span></div>
          <div className="rem-stat" style={{ '--c': '#7048e8' }}><b>{groups.tomorrow.length + groups.week.length}</b><span>this week</span></div>
          <div className="rem-stat" style={{ '--c': '#1971c2' }}><b>{repeating}</b><span>repeating</span></div>
        </div>
      )}

      {empty && <EmptyState kind="generic" color="#e03131" title="Nothing to nudge you about" hint='Type a reminder above, or tell Myth AI "remind me to call Ravi at 5" anywhere in the app.' />}

      {SECTIONS.map(([key, label, color]) => groups[key].length > 0 && (
        <div key={key}>
          <div className="rem-section-head" style={{ '--c': color }}><b>{label}</b><span>{groups[key].length}</span></div>
          <div className="rem-list">
            {groups[key].map((r) => <ReminderRow key={r.id} r={r} now={now} onEdit={setEditing} />)}
          </div>
        </div>
      ))}

      {groups.done.length > 0 && (
        <div>
          <Group justify="space-between" mb={6}>
            <Anchor fz={12} fw={700} c="dimmed" onClick={() => setShowDone((v) => !v)}>
              <Group gap={4} component="span">{showDone ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />} Done ({groups.done.length})</Group>
            </Anchor>
            {showDone && <Anchor fz={12} c="red" onClick={clearDone}>Clear done</Anchor>}
          </Group>
          <Collapse in={showDone}>
            <div className="rem-list">
              {groups.done.slice(0, 30).map((r) => <ReminderRow key={r.id} r={r} now={now} onEdit={setEditing} />)}
            </div>
          </Collapse>
        </div>
      )}

      {editing && <EditModal reminder={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}
