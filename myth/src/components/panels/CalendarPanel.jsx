import { useState } from 'react';
import { Stack, Group, Text, ActionIcon, Box, Badge, Button, TextInput, Select, Modal } from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { eventIcon } from '../../icons';

export default function CalendarPanel() {
  const { events, tasks, addEvent, addTask, deleteEvent } = useStore();
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', date: dayjs().format('YYYY-MM-DD'), time: '', kind: 'event' });

  const openAddFor = (date) => {
    setForm((f) => ({ ...f, date, title: '' }));
    setAdding(true);
  };

  const itemsOn = (d) => {
    const key = d.format('YYYY-MM-DD');
    const evs = events.filter((e) => {
      if (e.yearly) return dayjs(e.date).format('MM-DD') === d.format('MM-DD');
      return e.date === key;
    }).map((e) => ({ ...e, _kind: e.kind }));
    const due = tasks.filter((t) => t.status !== 'done' && t.due === key)
      .map((t) => ({ id: t.id, title: t.title, _kind: 'task', task: true }));
    return [...evs, ...due];
  };

  const start = month.startOf('week');
  const cells = Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap={6}>
          <ActionIcon variant="subtle" radius="xl" onClick={() => setMonth(month.subtract(1, 'month'))}><IconChevronLeft size={18} /></ActionIcon>
          <Text fw={800} fz={17} w={150} ta="center">{month.format('MMMM YYYY')}</Text>
          <ActionIcon variant="subtle" radius="xl" onClick={() => setMonth(month.add(1, 'month'))}><IconChevronRight size={18} /></ActionIcon>
        </Group>
        <Button size="xs" radius="xl" leftSection={<IconPlus size={14} />} onClick={() => setAdding(true)}>Event</Button>
      </Group>

      <Box>
        <Group gap={0} mb={4}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <Text key={d} fz={11} fw={700} c="dimmed" ta="center" style={{ width: `${100 / 7}%` }}>{d}</Text>
          ))}
        </Group>
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {cells.map((d) => {
            const items = itemsOn(d);
            const inMonth = d.isSame(month, 'month');
            const isToday = d.isSame(dayjs(), 'day');
            return (
              <Box
                key={d.format('YYYY-MM-DD')}
                p={4}
                onClick={() => openAddFor(d.format('YYYY-MM-DD'))}
                title="Click to add a task or event on this date"
                style={{
                  minHeight: 64, borderRadius: 10, cursor: 'pointer',
                  background: isToday ? 'rgba(18,161,80,0.18)' : 'rgba(255,255,255,0.45)',
                  border: isToday ? '1.5px solid #12a150' : '1px solid rgba(20,60,40,0.08)',
                  opacity: inMonth ? 1 : 0.4,
                  transition: 'background 120ms ease, transform 120ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(18,161,80,0.12)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isToday ? 'rgba(18,161,80,0.18)' : 'rgba(255,255,255,0.45)'; }}
              >
                <Text fz={11.5} fw={isToday ? 800 : 600} ta="right" pr={2}>{d.date()}</Text>
                <Stack gap={2}>
                  {items.slice(0, 2).map((it) => {
                    const meta = eventIcon(it._kind);
                    return (
                      <Text key={it.id} fz={9.5} lineClamp={1} px={4} py={1}
                        style={{ background: `${meta.color}22`, borderRadius: 5, color: meta.color, fontWeight: 700 }}>
                        {it.title}
                      </Text>
                    );
                  })}
                  {items.length > 2 && <Text fz={9} c="dimmed" px={4}>+{items.length - 2} more</Text>}
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Stack gap={6}>
        <Text fw={700} fz={14}>This month</Text>
        {cells.filter((d) => d.isSame(month, 'month')).flatMap((d) => itemsOn(d).map((it) => ({ ...it, _d: d })))
          .map((it) => {
            const meta = eventIcon(it._kind);
            const EIcon = meta.icon;
            return (
              <Group key={`${it.id}${it._d}`} gap={8} className="glass" p={8} style={{ borderRadius: 12 }} wrap="nowrap">
                <Badge size="sm" variant="light" style={{ minWidth: 60 }} color="gray">{it._d.format('MMM D')}</Badge>
                <EIcon size={15} color={meta.color} style={{ flexShrink: 0 }} />
                <Text fz={13} style={{ flex: 1 }}>{it.title}{it.time ? ` · ${it.time}` : ''}</Text>
                {!it.task && (
                  <ActionIcon size="sm" variant="subtle" color="red" onClick={() => deleteEvent(it.id)}><IconTrash size={13} /></ActionIcon>
                )}
              </Group>
            );
          })}
      </Stack>

      <Modal
        opened={adding} onClose={() => setAdding(false)} radius="xl"
        title={<Text fw={700}>Add on {dayjs(form.date).format('ddd, MMM D')}</Text>}
      >
        <Stack gap="sm">
          <TextInput
            radius="md" label="Title" placeholder="What's happening?" data-autofocus
            value={form.title} onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
          />
          <Select
            radius="md" label="Type" value={form.kind} onChange={(v) => setForm({ ...form, kind: v })}
            data={[
              { value: 'task', label: 'Task (with this deadline)' },
              { value: 'event', label: 'Event' }, { value: 'meeting', label: 'Meeting' },
              { value: 'birthday', label: 'Birthday (yearly)' }, { value: 'bill', label: 'Bill / renewal' },
            ]}
          />
          <Group grow>
            <DateInput radius="md" label="Date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            {form.kind !== 'task' && (
              <TimeInput radius="md" label="Time" value={form.time} onChange={(e) => setForm({ ...form, time: e.currentTarget.value })} />
            )}
          </Group>
          <Button radius="xl" color="forest" onClick={() => {
            if (!form.title.trim()) return;
            const date = dayjs(form.date).format('YYYY-MM-DD');
            if (form.kind === 'task') {
              addTask({ title: form.title.trim(), due: date });
            } else {
              addEvent({
                title: form.title.trim(), date, time: form.time || null,
                kind: form.kind, yearly: form.kind === 'birthday',
              });
            }
            setForm({ title: '', date: dayjs().format('YYYY-MM-DD'), time: '', kind: 'event' });
            setAdding(false);
          }}>
            Save
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
