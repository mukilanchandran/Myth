// Context engine panel — pick any node of the Life Context Graph (an upcoming
// meeting by default) and see everything connected to it, then act on it:
// tick action items, turn them into tasks, block travel, add a follow-up,
// write a prep note.
import { useEffect, useMemo, useState } from 'react';
import { Stack, Group, Text, Box, Badge, Checkbox, Button, TextInput, ActionIcon } from '@mantine/core';
import {
  IconBrain, IconSearch, IconChecklist, IconNotes, IconFiles, IconLink, IconCar, IconHistory, IconUsers, IconFolders,
  IconArrowForwardUp, IconSparkles, IconCalendarEvent, IconFileText, IconLock, IconPhoto, IconBulb, IconMapPin,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import {
  contextFor, upcomingMeetingContexts, followUpsNeeded, searchNodes, getGraph, relDay, actionItems,
  setActionItemDone, actionItemsToTasks, createFollowUpTask, addTravelPlan, travelPlanExists, createPrepNote,
} from '../../ai/context';
import { NoteEditor } from './NotesPanel';

const TYPE_META = {
  project: { label: 'Project', color: 'teal', icon: IconFolders },
  task: { label: 'Task', color: 'green', icon: IconChecklist },
  meeting: { label: 'Meeting', color: 'violet', icon: IconCalendarEvent },
  note: { label: 'Note', color: 'teal', icon: IconNotes },
  idea: { label: 'Idea', color: 'yellow', icon: IconBulb },
  event: { label: 'Event', color: 'blue', icon: IconCalendarEvent },
  file: { label: 'File', color: 'gray', icon: IconFiles },
  drive: { label: 'Drive', color: 'blue', icon: IconLink },
  person: { label: 'Person', color: 'orange', icon: IconUsers },
};

const VIA_LABEL = {
  in_project: 'same project', project: 'same project', about: 'mentions the project', from_meeting: 'from this meeting',
  scheduled: 'on the calendar', mentions: 'mentioned here', relates: 'related by topic',
};
const viaLabel = (via) => (via?.startsWith('person:') ? `via ${via.slice(7)}` : VIA_LABEL[via] ?? '');

function driveIcon(d) {
  if (d.kind === 'image') return <IconPhoto size={16} color="#7048e8" />;
  if (d.kind === 'password') return <IconLock size={16} color="#e8590c" />;
  if (d.kind === 'link') return <IconLink size={16} color="#1971c2" />;
  if (d.kind === 'text') return <IconFileText size={16} color="#0ca678" />;
  return <IconFiles size={16} color="#495057" />;
}

function Section({ icon: Icon, color, title, count, extra, children }) {
  if (!count) return null;
  return (
    <Box>
      <Group gap={6} mb={6} justify="space-between">
        <Group gap={6}>
          <Icon size={15} color={color} />
          <Text fw={700} fz={12.5} tt="uppercase" lts={0.5} c="dimmed">{title}</Text>
          <Badge size="xs" variant="light" color="gray">{count}</Badge>
        </Group>
        {extra}
      </Group>
      <Stack gap={6}>{children}</Stack>
    </Box>
  );
}

function Row({ children, onClick }) {
  return (
    <Group className="glass" p={10} gap={8} wrap="nowrap" style={{ borderRadius: 12, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      {children}
    </Group>
  );
}

function Briefing({ ctx, state, onSelect, onEditNote, setPanel }) {
  const meta = TYPE_META[ctx.node.type] ?? TYPE_META.note;
  const Icon = meta.icon;
  const location = ctx.entity.meeting?.location;
  const meetings = [...ctx.nextMeetings, ...ctx.previousMeetings];

  const blockTravel = () => {
    addTravelPlan(useStore, ctx);
    notifications.show({ color: 'grape', title: 'Travel blocked', message: `"Leave by ${ctx.travel.leaveBy}" added to ${relDay(ctx.when.date).toLowerCase()}'s plan.` });
  };
  const toTasks = () => {
    const n = actionItemsToTasks(useStore, ctx);
    notifications.show({ color: n ? 'green' : 'gray', title: n ? `${n} task${n === 1 ? '' : 's'} created` : 'Nothing new', message: n ? 'Unresolved action items are now on your task list.' : 'Those action items already exist as tasks.' });
  };
  const followUp = () => {
    const due = createFollowUpTask(useStore, ctx);
    notifications.show({ color: 'blue', title: 'Follow-up added', message: `Due ${dayjs(due).format('ddd, MMM D')}.` });
  };
  const prepNote = () => {
    const note = createPrepNote(useStore, ctx);
    notifications.show({ color: 'violet', title: 'Prep note created', message: 'Everything Myth knows about this meeting, in one note.' });
    onEditNote(note.id);
  };

  return (
    <Stack gap="md">
      <Box className="glass" p="lg" style={{ borderRadius: 18 }}>
        <Group gap={6} mb={6}>
          <Badge variant="light" color={meta.color} leftSection={<Icon size={11} />}>{meta.label}</Badge>
          {ctx.when.date && <Badge variant="light" color="gray">{ctx.when.rel}{ctx.when.time ? ` · ${ctx.when.time}` : ''}</Badge>}
          {ctx.project && ctx.node.type !== 'project' && (
            <Badge variant="light" color="teal" style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => onSelect(`project:${ctx.project.id}`)}>
              {ctx.project.name}
            </Badge>
          )}
        </Group>
        <Text fw={800} fz={18} lh={1.2}>{ctx.node.label}</Text>
        {location && (
          <Group gap={4} mt={4}><IconMapPin size={13} color="#868e96" /><Text fz={12.5} c="dimmed">{location}</Text></Group>
        )}
        {ctx.people.length > 0 && (
          <Group gap={6} mt={8}>
            {ctx.people.map((p) => (
              <Badge key={p.id} variant="outline" color="orange" radius="xl" leftSection={<IconUsers size={11} />}
                style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => onSelect(p.id)}>
                {p.label}
              </Badge>
            ))}
          </Group>
        )}

        <Box mt="md" p="md" style={{ borderRadius: 14, background: 'rgba(112,72,232,0.07)', border: '1px solid rgba(112,72,232,0.18)' }}>
          <Group gap={6} mb={4}><IconBrain size={15} color="#7048e8" /><Text fw={700} fz={13}>Myth's briefing</Text></Group>
          {ctx.lines.map((l, i) => <Text key={i} fz={13.5} lh={1.5}>{l}</Text>)}
        </Box>

        {ctx.isMeeting && (
          <Group gap={8} mt="md">
            {!ctx.isPast && ctx.travel?.leaveBy && (travelPlanExists(state, ctx)
              ? <Badge variant="light" color="green" leftSection={<IconCar size={12} />} style={{ textTransform: 'none' }}>Travel on {relDay(ctx.when.date).toLowerCase()}'s plan</Badge>
              : <Button size="xs" radius="xl" variant="light" color="grape" leftSection={<IconCar size={14} />} onClick={blockTravel}>Block travel · leave {ctx.travel.leaveBy}</Button>)}
            {ctx.unresolvedActions.length > 0 && (
              <Button size="xs" radius="xl" variant="light" color="orange" leftSection={<IconChecklist size={14} />} onClick={toTasks}>Unresolved → tasks</Button>
            )}
            {ctx.followUpTask
              ? <Badge variant="light" color="green" leftSection={<IconArrowForwardUp size={12} />} style={{ textTransform: 'none' }}>Follow-up: {ctx.followUpTask.title}</Badge>
              : <Button size="xs" radius="xl" variant="light" color="blue" leftSection={<IconArrowForwardUp size={14} />} onClick={followUp}>Add follow-up task</Button>}
            <Button size="xs" radius="xl" variant="gradient" gradient={{ from: '#7048e8', to: '#5f3dc4' }} leftSection={<IconSparkles size={14} />} onClick={prepNote}>
              Prepare for meeting →
            </Button>
          </Group>
        )}
      </Box>

      <Section icon={IconChecklist} color="#12a150" title="Open tasks" count={ctx.openTasks.length}
        extra={ctx.doneTasks.length > 0 && <Text fz={11.5} c="dimmed">{ctx.doneTasks.length} done</Text>}>
        {ctx.openTasks.map(({ node: t, via }) => {
          const late = t.date && dayjs(t.date).isBefore(dayjs(), 'day');
          return (
            <Row key={t.id}>
              <Checkbox size="sm" radius="xl" color="forest" checked={false} onChange={() => state.completeTask(t.ref.id)} />
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text fz={13.5} lineClamp={1}>{t.label}</Text>
                <Text fz={11} c="dimmed">{viaLabel(via)}</Text>
              </Box>
              {t.date && <Badge size="xs" variant="light" color={late ? 'red' : 'gray'}>{dayjs(t.date).format('MMM D')}</Badge>}
            </Row>
          );
        })}
      </Section>

      {ctx.ownActions.length > 0 && (
        <Section icon={IconChecklist} color="#e8590c" title="This meeting's action items" count={ctx.ownActions.length}>
          <Box className="glass" p={10} style={{ borderRadius: 12 }}>
            <Stack gap={6}>
              {ctx.ownActions.map((a) => (
                <Checkbox key={a.idx} size="xs" radius="xl" color="forest" checked={a.done}
                  label={<Text fz={12.5} td={a.done ? 'line-through' : undefined} c={a.done ? 'dimmed' : undefined}>{a.text}</Text>}
                  onChange={(e) => setActionItemDone(useStore, ctx.entity.id, a.idx, e.currentTarget.checked)} />
              ))}
            </Stack>
          </Box>
        </Section>
      )}

      <Section icon={IconHistory} color="#7048e8" title={ctx.isMeeting ? 'Meeting history' : 'Meetings'} count={meetings.length}>
        {meetings.map(({ node: m }) => {
          const items = actionItems(m.ref);
          const open = items.filter((a) => !a.done);
          const upcoming = ctx.nextMeetings.some((r) => r.node.id === m.id);
          return (
            <Box key={m.id} className="glass" p={10} style={{ borderRadius: 12 }}>
              <Group justify="space-between" wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => onSelect(m.id)}>
                <Box style={{ minWidth: 0 }}>
                  <Text fz={13.5} fw={600} lineClamp={1}>{m.label}</Text>
                  <Text fz={11.5} c="dimmed" lineClamp={1}>
                    {upcoming ? 'Upcoming · ' : ''}{relDay(m.date)}{m.time ? ` · ${m.time}` : ''}{m.ref.meeting?.participants ? ` · ${m.ref.meeting.participants}` : ''}
                  </Text>
                </Box>
                <Group gap={4} wrap="nowrap">
                  {open.length > 0 && <Badge size="xs" color="orange" variant="light">{open.length} open</Badge>}
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); onEditNote(m.ref.id); }}>
                    <IconNotes size={14} />
                  </ActionIcon>
                </Group>
              </Group>
              {items.length > 0 && (
                <Stack gap={4} mt={8}>
                  {items.map((a) => (
                    <Checkbox key={a.idx} size="xs" radius="xl" color="forest" checked={a.done}
                      label={<Text fz={12.5} td={a.done ? 'line-through' : undefined} c={a.done ? 'dimmed' : undefined}>{a.text}</Text>}
                      onChange={(e) => setActionItemDone(useStore, m.ref.id, a.idx, e.currentTarget.checked)} />
                  ))}
                </Stack>
              )}
            </Box>
          );
        })}
      </Section>

      <Section icon={IconNotes} color="#0f766e" title="Related notes & ideas" count={ctx.notes.length}>
        {ctx.notes.slice(0, 8).map(({ node: n, via }) => (
          <Row key={n.id} onClick={() => onEditNote(n.ref.id)}>
            {n.type === 'idea' ? <IconBulb size={16} color="#f08c00" /> : <IconNotes size={16} color="#0f766e" />}
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fz={13.5} fw={600} lineClamp={1}>{n.label}</Text>
              {n.ref.body && <Text fz={12} c="dimmed" lineClamp={1}>{n.ref.body}</Text>}
            </Box>
            <Text fz={11} c="dimmed" style={{ flexShrink: 0 }}>{viaLabel(via)}</Text>
          </Row>
        ))}
      </Section>

      <Section icon={IconFiles} color="#1971c2" title="Documents" count={ctx.documents.length}>
        {ctx.documents.map(({ node: d, via }) => {
          const open = () => {
            if (d.type === 'drive' && d.ref.kind === 'link' && d.ref.url) window.open(d.ref.url, '_blank', 'noopener');
            else setPanel(d.type === 'drive' ? 'drive' : 'projects');
          };
          return (
            <Row key={d.id} onClick={open}>
              {d.type === 'file' ? <IconFiles size={16} color="#495057" /> : driveIcon(d.ref)}
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text fz={13.5} fw={600} lineClamp={1}>{d.label}</Text>
                <Text fz={11.5} c="dimmed" lineClamp={1}>
                  {d.type === 'file' ? `${d.ref.type || 'file'} · ${((d.ref.size ?? 0) / 1024).toFixed(0)} KB` : d.ref.kind === 'link' ? d.ref.url : d.ref.kind}
                </Text>
              </Box>
              <Text fz={11} c="dimmed" style={{ flexShrink: 0 }}>{viaLabel(via)}</Text>
            </Row>
          );
        })}
      </Section>

      <Section icon={IconCalendarEvent} color="#1971c2" title="On the calendar" count={ctx.events.length}>
        {ctx.events.map(({ node: e }) => (
          <Row key={e.id} onClick={() => setPanel('calendar')}>
            <IconCalendarEvent size={16} color="#1971c2" />
            <Text fz={13.5} style={{ flex: 1 }} lineClamp={1}>{e.label}</Text>
            <Badge size="xs" variant="light">{relDay(e.date)}{e.time ? ` ${e.time}` : ''}</Badge>
          </Row>
        ))}
      </Section>
    </Stack>
  );
}

export default function ContextPanel() {
  const state = useStore();
  const contextId = useUI((s) => s.contextId);
  const setPanel = useUI((s) => s.setPanel);
  const [selected, setSelected] = useState(contextId);
  const [query, setQuery] = useState('');
  const [editNoteId, setEditNoteId] = useState(null);

  useEffect(() => { if (contextId) setSelected(contextId); }, [contextId]);

  const upcoming = useMemo(() => upcomingMeetingContexts(state, 14), [state]);
  const followUps = useMemo(() => followUpsNeeded(state, 5), [state]);
  const graph = getGraph(state);

  const current = (selected && graph.nodes.has(selected) ? selected : null) ?? upcoming[0]?.id ?? followUps[0]?.id ?? null;
  const ctx = current ? contextFor(state, current) : null;
  const results = query.trim() ? searchNodes(state, query) : [];
  const editNote = editNoteId ? state.notes.find((n) => n.id === editNoteId) : null;

  return (
    <Stack gap="md">
      <TextInput
        radius="xl" leftSection={<IconSearch size={16} />} placeholder="Explore anything — a project, task, person, note…"
        value={query} onChange={(e) => setQuery(e.currentTarget.value)}
      />
      {results.length > 0 && (
        <Stack gap={4}>
          {results.map((n) => {
            const meta = TYPE_META[n.type] ?? TYPE_META.note;
            return (
              <Row key={n.id} onClick={() => { setSelected(n.id); setQuery(''); }}>
                <Badge size="xs" variant="light" color={meta.color}>{meta.label}</Badge>
                <Text fz={13.5} lineClamp={1}>{n.label}</Text>
              </Row>
            );
          })}
        </Stack>
      )}

      {(upcoming.length > 0 || followUps.length > 0) && (
        <Box>
          <Text fw={700} fz={12.5} tt="uppercase" lts={0.5} c="dimmed" mb={6}>Up next</Text>
          <Group gap={6}>
            {upcoming.slice(0, 6).map(({ id, ctx: c }) => (
              <Badge key={id} size="lg" radius="xl" variant={id === current ? 'filled' : 'light'} color="violet"
                style={{ cursor: 'pointer', textTransform: 'none', fontWeight: 600 }} onClick={() => setSelected(id)}>
                {c.when.rel}{c.when.time ? ` ${c.when.time}` : ''} · {c.node.label}
              </Badge>
            ))}
            {followUps.slice(0, 4).map(({ id, ctx: c }) => (
              <Badge key={id} size="lg" radius="xl" variant={id === current ? 'filled' : 'light'} color="orange"
                style={{ cursor: 'pointer', textTransform: 'none', fontWeight: 600 }} onClick={() => setSelected(id)}>
                Follow-up · {c.node.label}
              </Badge>
            ))}
          </Group>
        </Box>
      )}

      {ctx
        ? <Briefing ctx={ctx} state={state} onSelect={setSelected} onEditNote={setEditNoteId} setPanel={setPanel} />
        : (
          <Box className="glass" p="xl" style={{ borderRadius: 18, textAlign: 'center' }}>
            <IconBrain size={34} color="#7048e8" />
            <Text fw={700} fz={15} mt={8}>Nothing to prepare for yet</Text>
            <Text fz={13} c="dimmed" mt={4}>
              Capture a meeting — “client meeting tomorrow 10am at Acme office with Ravi” — and Myth links it to the project,
              open tasks, notes, documents, people and previous meetings. Or search any item above to see its connections.
            </Text>
          </Box>
        )}

      <Text fz={11.5} c="dimmed" ta="center">
        Life Context Graph · {graph.stats.nodes} items · {graph.stats.edges} links · {graph.stats.people} people
      </Text>

      {editNote && <NoteEditor note={editNote} onClose={() => setEditNoteId(null)} />}
    </Stack>
  );
}
