// Track — what you did each day, kept like a simple spreadsheet.
//   • the day sheet: one row per thing you worked on — Work · Description ·
//     Project · Status · Time (optional). Type straight into the cells; every
//     cell saves when you leave it. "+ Add work" (or Enter on the last row)
//     gives the next empty row on the same screen — no dialogs.
//   • left: a small calendar (a dot on every day with logged work), status
//     filters and the projects of the period
//   • Daily = the sheet · Weekly = the seven days as lists · Monthly = the month
//     with a count per day
//   • a daily summary is always maintained: automatic from the rows, written by
//     Myth AI on request, or your own words
//   • Myth AI logs, updates and answers from the same data (see ai/worklog.js)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Anchor, Badge, Button, Checkbox, Collapse, Group, SegmentedControl, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications as toast } from '@mantine/notifications';
import {
  IconChevronLeft, IconChevronRight, IconChevronDown, IconChevronUp, IconPlus, IconClock, IconCheck, IconX, IconSparkles, IconCopy,
  IconPencil, IconTrash, IconFlame, IconRefresh, IconWand,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore, uid } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import { writeWorkSummary } from '../../ai/assistant';
import {
  WORK_STATUSES, statusOf, parseDuration, guessWorkCategory, entriesOn, entriesBetween, totalMinutes, byProject, byStatus, statusLine,
  countByDate, weekDays, monthGrid, trackStreak, summaryFor, standupText, suggestWorkLogs, projectName, fmtMinutes,
} from '../../ai/worklog';
import '../track.css';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const fmt = (d) => dayjs(d).format('YYYY-MM-DD');
const plural = (n, word = 'item') => `${n} ${word}${n === 1 ? '' : 's'}`;

function useNow(ms) {
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// "2h", "45m", "1.5h", "1h 30m" — a bare number is hours up to 12, minutes above ("90")
function readTime(text) {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  const d = parseDuration(t);
  if (d) return d.minutes;
  if (/^\d+(?:\.\d+)?$/.test(t)) { const n = parseFloat(t); return Math.round(n <= 12 ? n * 60 : n); }
  return null;
}

// ---------------------------------------------------------------------------
// left column
// ---------------------------------------------------------------------------
function MiniCalendar({ month, onMonth, selected, onSelect, counts, view }) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const today = fmt(dayjs());
  const week = useMemo(() => new Set(weekDays(selected).map(fmt)), [selected]);
  return (
    <div className="trk-card trk-cal">
      <div className="trk-cal-head">
        <b>{month.format('MMMM YYYY')}</b>
        <span>
          <button type="button" onClick={() => onMonth(month.subtract(1, 'month'))} aria-label="Previous month"><IconChevronLeft size={15} /></button>
          <button type="button" onClick={() => onMonth(month.add(1, 'month'))} aria-label="Next month"><IconChevronRight size={15} /></button>
        </span>
      </div>
      <div className="trk-cal-grid">
        {DOW.map((d, i) => <span key={i} className="trk-cal-dow">{d}</span>)}
        {weeks.flat().map((d) => {
          const key = fmt(d);
          return (
            <button
              key={key} type="button" className="trk-cal-day" onClick={() => onSelect(key)}
              data-out={d.month() !== month.month() || undefined} data-today={key === today || undefined}
              data-selected={key === selected || undefined} data-week={(view === 'week' && week.has(key)) || undefined}
              aria-label={`${d.format('dddd, MMMM D')}${counts[key] ? ` — ${plural(counts[key])} logged` : ''}`}
            >
              {d.date()}
              {counts[key] > 0 && <i />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// the timer is started from Myth AI ("start timer for …"); while it runs it shows here
function RunningTimer() {
  const timer = useStore((s) => s.worklogTimer);
  const stopWorkTimer = useStore((s) => s.stopWorkTimer);
  const now = useNow(1000);
  if (!timer) return null;
  const secs = Math.max(0, now.diff(dayjs(timer.startedAt), 'second'));
  const clock = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const stop = () => {
    const entry = stopWorkTimer();
    toast.show(entry ? { color: 'forest', title: 'Logged', message: `${entry.title} — ${fmtMinutes(entry.minutes)}` } : { color: 'gray', message: 'Under a minute — nothing logged' });
  };
  return (
    <div className="trk-timer">
      <small><span className="trk-pulse" /> Timer running</small>
      <b>{timer.title}</b>
      <div className="trk-timer-clock">{clock}</div>
      <div className="trk-timer-foot">
        <span><IconClock size={13} /> since {dayjs(timer.startedAt).format('h:mm A')}{timer.project ? ` · ${timer.project}` : ''}</span>
        <span className="trk-timer-btns">
          <Tooltip label="Discard"><button type="button" className="is-discard" onClick={() => stopWorkTimer({ discard: true })} aria-label="Discard timer"><IconX size={15} stroke={2.6} /></button></Tooltip>
          <Tooltip label="Stop and add it to today"><button type="button" className="is-stop" onClick={stop} aria-label="Stop timer and log"><IconCheck size={15} stroke={2.8} /></button></Tooltip>
        </span>
      </div>
    </div>
  );
}

function Foldable({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="trk-card">
      <button type="button" className="trk-fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <b>{title}</b>{open ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
      </button>
      <Collapse expanded={open}>{children}</Collapse>
    </div>
  );
}

// ---------------------------------------------------------------------------
// the day sheet
// ---------------------------------------------------------------------------
const toForm = (entry, projects) => ({
  title: entry.title ?? '', note: entry.note ?? '', project: projectName(entry, projects), status: statusOf(entry),
  time: entry.minutes > 0 ? fmtMinutes(entry.minutes) : '',
});

function SheetRow({ index, entry, draft, date, focus, onFocused, onEnter, onRemove }) {
  const projects = useStore((s) => s.projects);
  const addWorkLog = useStore((s) => s.addWorkLog);
  const updateWorkLog = useStore((s) => s.updateWorkLog);
  const deleteWorkLog = useStore((s) => s.deleteWorkLog);
  const [form, setForm] = useState(() => toForm(entry, projects));
  const titleRef = useRef(null);
  const saved = useRef(!draft); // a new row is written to the log once it has a name

  // changes made elsewhere (Myth AI, another device, the project Myth recognised) show up in the row
  useEffect(() => { if (saved.current) setForm(toForm(entry, projects)); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry.title, entry.note, entry.project, entry.projectId, entry.status, entry.minutes]);
  useEffect(() => { if (focus === entry.id) { titleRef.current?.focus(); onFocused(); } }, [focus, entry.id, onFocused]);

  const commit = (next = form) => {
    const title = next.title.trim();
    const known = projects.find((p) => p.name.toLowerCase() === next.project.trim().toLowerCase());
    const minutes = readTime(next.time);
    const data = { title, note: next.note.trim(), projectId: known?.id ?? null, project: known?.name ?? next.project.trim(), status: next.status };
    if (!saved.current) {
      if (!title) return;
      saved.current = true;
      addWorkLog({ id: entry.id, date, ...data, minutes: minutes ?? 0, category: guessWorkCategory(title), source: 'manual' });
      return;
    }
    const current = useStore.getState().worklog.find((w) => w.id === entry.id);
    if (!current) return;
    if (!title) { setForm((f) => ({ ...f, title: current.title })); return; } // a row keeps its name; delete it with the bin
    if (minutes == null) setForm((f) => ({ ...f, time: current.minutes > 0 ? fmtMinutes(current.minutes) : '' })); // not a time — put the old one back
    else if (minutes !== (current.minutes ?? 0)) Object.assign(data, { minutes, start: null, end: null, approx: false });
    const changed = Object.entries(data).some(([k, v]) => (current[k] ?? (k === 'status' ? 'done' : null)) !== v && !(v === '' && current[k] == null));
    if (changed) updateWorkLog(entry.id, data);
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const onKey = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return; // Shift+Enter = a new line inside the description
    e.preventDefault();
    commit();
    onEnter(index);
  };
  const remove = () => { if (saved.current) deleteWorkLog(entry.id); onRemove(entry.id); };
  const st = WORK_STATUSES[form.status];

  return (
    <div className="trk-row" role="row" data-status={form.status} data-draft={!saved.current || undefined}>
      <span className="trk-cell is-num" role="cell">{index + 1}</span>
      <div className="trk-cell is-title" role="cell">
        <input ref={titleRef} value={form.title} placeholder="What did you work on?" aria-label="Work" onChange={(e) => set('title', e.currentTarget.value)} onBlur={() => commit()} onKeyDown={onKey} />
      </div>
      <div className="trk-cell is-note" role="cell">
        <Textarea variant="unstyled" autosize minRows={1} maxRows={8} value={form.note} placeholder="Description — what exactly, outcome, blockers" aria-label="Description" onChange={(e) => set('note', e.currentTarget.value)} onBlur={() => commit()} onKeyDown={onKey} />
      </div>
      <div className="trk-cell is-project" role="cell">
        <input list="trk-projects" value={form.project} placeholder="Project" aria-label="Project" onChange={(e) => set('project', e.currentTarget.value)} onBlur={() => commit()} onKeyDown={onKey} />
      </div>
      <div className="trk-cell is-status" role="cell">
        <select value={form.status} aria-label="Status" style={{ '--tint': st.tint, '--ink': st.color }} onChange={(e) => { const next = { ...form, status: e.currentTarget.value }; setForm(next); commit(next); }}>
          {Object.entries(WORK_STATUSES).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
        </select>
      </div>
      <div className="trk-cell is-time" role="cell">
        <input value={form.time} placeholder="—" aria-label="Time spent (optional)" title='Optional — "2h", "45m", "1h 30m"' onChange={(e) => set('time', e.currentTarget.value)} onBlur={() => commit()} onKeyDown={onKey} />
      </div>
      <div className="trk-cell is-del" role="cell">
        <Tooltip label="Delete row"><button type="button" onClick={remove} aria-label={`Delete row ${index + 1}`}><IconTrash size={14} /></button></Tooltip>
      </div>
    </div>
  );
}

function DaySheet({ date, entries, projectNames, addSignal, isFuture }) {
  const [drafts, setDrafts] = useState([]);
  const [focus, setFocus] = useState(null);
  const count = entries.length;

  // a new day starts clean; an empty day opens with one blank row, ready to type
  useEffect(() => { setDrafts(count || isFuture ? [] : [{ id: uid() }]); setFocus(null); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date]);

  const addRow = () => { const id = uid(); setDrafts((d) => [...d, { id }]); setFocus(id); };
  // the "+ Add work" button in the header
  const seen = useRef(addSignal);
  useEffect(() => { if (addSignal !== seen.current) { seen.current = addSignal; addRow(); } }, [addSignal]);

  const rows = [...entries.map((entry) => ({ entry, draft: false })), ...drafts.filter((d) => !entries.some((e) => e.id === d.id)).map((entry) => ({ entry, draft: true }))];
  const onEnter = (index) => { const next = rows[index + 1]; if (next) setFocus(next.entry.id); else addRow(); };
  const onRemove = (id) => setDrafts((d) => d.filter((x) => x.id !== id));
  const clearFocus = useMemo(() => () => setFocus(null), []);

  if (isFuture) return <div className="trk-card trk-sheet-empty">This day hasn't happened yet — work is logged once it is done.</div>;

  return (
    <div className="trk-card trk-sheet" role="table" aria-label={`Work done on ${dayjs(date).format('dddd, MMMM D')}`}>
      <datalist id="trk-projects">{projectNames.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="trk-row is-head" role="row">
        <span className="trk-cell is-num" role="columnheader">#</span>
        <span className="trk-cell" role="columnheader">Work</span>
        <span className="trk-cell" role="columnheader">Description</span>
        <span className="trk-cell" role="columnheader">Project</span>
        <span className="trk-cell" role="columnheader">Status</span>
        <span className="trk-cell" role="columnheader">Time</span>
        <span className="trk-cell is-del" role="columnheader" />
      </div>
      {rows.map(({ entry, draft }, i) => (
        <SheetRow key={entry.id} index={i} entry={entry} draft={draft} date={date} focus={focus} onFocused={clearFocus} onEnter={onEnter} onRemove={onRemove} />
      ))}
      <button type="button" className="trk-addrow" onClick={addRow}><IconPlus size={15} stroke={2.6} /> Add work</button>
      <p className="trk-sheet-hint">Type in any cell — it saves by itself. <b>Enter</b> next row · <b>Tab</b> next cell · <b>Shift+Enter</b> new line · Time is optional.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// week and month
// ---------------------------------------------------------------------------
function WeekList({ days, entries, projects, selected, onOpen }) {
  const today = fmt(dayjs());
  return (
    <div className="trk-week">
      {days.map((d) => {
        const key = fmt(d);
        const list = entriesOn(entries, key);
        const mins = totalMinutes(list);
        return (
          <div key={key} className="trk-card trk-weekday" data-today={key === today || undefined} data-selected={key === selected || undefined}>
            <button type="button" className="trk-weekday-head" onClick={() => onOpen(key)} disabled={key > today}>
              <b>{d.format('ddd')} <span>{d.date()}</span></b>
              <small>{list.length ? `${plural(list.length)} · ${statusLine(list)}${mins > 0 ? ` · ${fmtMinutes(mins)}` : ''}` : key > today ? '' : 'Nothing logged'}</small>
              {key <= today && <em>{list.length ? 'Open' : '+ Add'}</em>}
            </button>
            {list.length > 0 && (
              <ul>
                {list.map((e) => {
                  const st = WORK_STATUSES[statusOf(e)];
                  const p = projectName(e, projects);
                  return (
                    <li key={e.id}>
                      <i style={{ background: st.color }} title={st.label} />
                      <div>
                        <b>{e.title}</b>
                        {e.note && <span>{e.note}</span>}
                      </div>
                      {p && <em>{p}</em>}
                      {statusOf(e) !== 'done' && <em className="is-status" style={{ '--tint': st.tint, '--ink': st.color }}>{st.label}</em>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ month, entries, selected, onPick }) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const today = fmt(dayjs());
  return (
    <div className="trk-month">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="trk-month-dow">{d}</span>)}
      {weeks.flat().map((d) => {
        const key = fmt(d);
        const list = entriesOn(entries, key);
        return (
          <button key={key} type="button" className="trk-month-day" data-out={d.month() !== month.month() || undefined} data-today={key === today || undefined} data-selected={key === selected || undefined} onClick={() => onPick(key)}>
            <span>{d.date()}</span>
            {list.length > 0 && (
              <>
                <b>{plural(list.length)}</b>
                <div className="trk-month-bar" title={statusLine(list)}>
                  {byStatus(list).map((s) => <i key={s.key} style={{ flex: s.count, background: s.color }} />)}
                </div>
                <small>{list.slice(0, 2).map((e) => e.title).join(', ')}{list.length > 2 ? '…' : ''}</small>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// the daily summary
// ---------------------------------------------------------------------------
function SummaryCard({ date, entries }) {
  const worklog = useStore((s) => s.worklog ?? []);
  const worklogSummaries = useStore((s) => s.worklogSummaries ?? {});
  const projects = useStore((s) => s.projects);
  const setWorkSummary = useStore((s) => s.setWorkSummary);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [writing, setWriting] = useState(false);
  const state = { worklog, worklogSummaries, projects };
  const summary = summaryFor(state, date);
  useEffect(() => { setEditing(false); }, [date]);

  const write = async () => {
    setWriting(true);
    const text = await writeWorkSummary(useStore, date);
    setWriting(false);
    if (text) { setWorkSummary(date, text, 'ai'); toast.show({ color: 'forest', message: 'Summary written by Myth AI' }); } else toast.show({ color: 'orange', title: 'Myth AI is unreachable', message: 'Kept the automatic summary — check Settings → AI brain.' });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${standupText(state, date)}${summary.source !== 'auto' ? `\n\n${summary.text}` : ''}`); toast.show({ color: 'forest', message: 'Copied — paste it into your standup or status mail' }); } catch { toast.show({ color: 'orange', message: 'Could not reach the clipboard' }); }
  };

  return (
    <div className="trk-card trk-summary">
      <div className="trk-summary-head">
        <div>
          <b>Daily summary</b>
          <span>{dayjs(date).format('dddd, MMM D')} · {plural(entries.length)}</span>
        </div>
        <Badge size="sm" radius="sm" variant="light" color={summary.source === 'ai' ? 'violet' : summary.source === 'manual' ? 'blue' : 'gray'}>
          {summary.source === 'ai' ? 'Written by Myth AI' : summary.source === 'manual' ? 'Your words' : 'Automatic'}
        </Badge>
      </div>
      {editing ? (
        <Stack gap={8}>
          <Textarea autosize minRows={4} maxRows={12} radius="md" value={draft} onChange={(e) => setDraft(e.currentTarget.value)} placeholder="What got done, what is blocked, what is next…" data-autofocus />
          <Group justify="flex-end" gap={6}>
            <Button size="xs" radius="xl" variant="subtle" color="gray" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="xs" radius="xl" onClick={() => { setWorkSummary(date, draft, 'manual'); setEditing(false); }}>Save summary</Button>
          </Group>
        </Stack>
      ) : summary.text ? (
        <p className="trk-summary-text">{summary.text}</p>
      ) : (
        <p className="trk-summary-empty">Nothing logged this day yet. Add what you worked on and the summary writes itself.</p>
      )}
      {!editing && (
        <div className="trk-summary-actions">
          <Button size="xs" radius="xl" variant="light" color="violet" leftSection={<IconWand size={14} />} loading={writing} disabled={!entries.length} onClick={write}>Write with Myth AI</Button>
          <Button size="xs" radius="xl" variant="light" color="gray" leftSection={<IconPencil size={14} />} onClick={() => { setDraft(summary.text); setEditing(true); }}>Edit</Button>
          <Button size="xs" radius="xl" variant="light" color="gray" leftSection={<IconCopy size={14} />} disabled={!entries.length} onClick={copy}>Copy standup</Button>
          {summary.source !== 'auto' && <Button size="xs" radius="xl" variant="subtle" color="gray" leftSection={<IconRefresh size={14} />} onClick={() => setWorkSummary(date, '')}>Back to automatic</Button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// the panel
// ---------------------------------------------------------------------------
export default function TrackPanel() {
  const worklog = useStore((s) => s.worklog ?? []);
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.events);
  const addWorkLog = useStore((s) => s.addWorkLog);
  const openAssistant = useUI((s) => s.openAssistant);
  const compact = useMediaQuery('(max-width: 900px)');
  const now = useNow(60 * 1000);

  const [selected, setSelected] = useState(() => fmt(dayjs()));
  const [mode, setMode] = useState('day');
  const [calMonth, setCalMonth] = useState(() => dayjs().startOf('month'));
  const [hidden, setHidden] = useState(() => new Set());
  const [addSignal, setAddSignal] = useState(0);

  const today = fmt(now);
  const pick = (date) => { setSelected(date); setCalMonth(dayjs(date).startOf('month')); };
  const openDay = (date) => { pick(date); setMode('day'); };
  const step = (dir) => pick(fmt(dayjs(selected).add(dir, mode === 'month' ? 'month' : mode === 'week' ? 'week' : 'day')));
  // "+ Add work": always lands on the sheet of a day that has happened, with a fresh row under the cursor
  const addWork = () => { if (selected > today) pick(today); setMode('day'); setAddSignal((n) => n + 1); };

  const sel = dayjs(selected);
  const week = useMemo(() => weekDays(selected), [selected]);
  const [from, to] = mode === 'month' ? [fmt(sel.startOf('month')), fmt(sel.endOf('month'))] : mode === 'week' ? [fmt(week[0]), fmt(week[6])] : [selected, selected];
  const visible = useMemo(() => worklog.filter((e) => !hidden.has(statusOf(e))), [worklog, hidden]);
  const inRange = useMemo(() => entriesBetween(worklog, from, to), [worklog, from, to]);
  const dayAll = useMemo(() => entriesOn(worklog, selected), [worklog, selected]);
  const dayEntries = useMemo(() => entriesOn(visible, selected), [visible, selected]);
  const counts = useMemo(() => countByDate(worklog), [worklog]);
  const weekEntries = useMemo(() => entriesBetween(worklog, fmt(week[0]), fmt(week[6])), [worklog, week]);
  const streak = useMemo(() => trackStreak(worklog, now), [worklog, now]);
  const projectNames = useMemo(() => [...new Set([...projects.map((p) => p.name), ...worklog.map((e) => e.project)].filter(Boolean))], [projects, worklog]);
  const suggestions = useMemo(() => (selected > today ? [] : suggestWorkLogs({ worklog, tasks, events }, selected, now.toDate())), [worklog, tasks, events, selected, now, today]);

  const weekMax = Math.max(1, ...week.map((d) => counts[fmt(d)] ?? 0));
  const weekOpen = weekEntries.filter((e) => statusOf(e) !== 'done').length;
  const top = [...byProject(weekEntries, projects)].sort((a, b) => b.count - a.count).find((p) => p.name !== 'No project');
  const statuses = byStatus(inRange);
  const projRows = [...byProject(inRange, projects)].sort((a, b) => b.count - a.count);
  const dayMinutes = totalMinutes(dayAll);

  const title = mode === 'month' ? sel.format('MMMM YYYY') : mode === 'week' ? `${week[0].format('MMM D')} – ${week[6].format(week[0].month() === week[6].month() ? 'D' : 'MMM D')}, ${week[6].format('YYYY')}` : sel.format('dddd, MMMM D YYYY');
  const toggleStatus = (key) => setHidden((h) => { const next = new Set(h); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return (
    <div className="trk" data-compact={compact || undefined}>
      <aside className="trk-side">
        <MiniCalendar month={calMonth} onMonth={setCalMonth} selected={selected} onSelect={pick} counts={counts} view={mode} />
        <RunningTimer />
        <Foldable title="Status">
          <div className="trk-filters">
            {Object.entries(WORK_STATUSES).map(([key, s]) => (
              <label key={key}>
                <Checkbox size="xs" radius="sm" color="forest" checked={!hidden.has(key)} onChange={() => toggleStatus(key)} aria-label={s.label} />
                <i style={{ background: s.tint, borderColor: s.color }} />
                <span>{s.label}</span>
                <small>{statuses.find((x) => x.key === key)?.count ?? ''}</small>
              </label>
            ))}
          </div>
        </Foldable>
        <Foldable title={`Projects · ${mode === 'day' ? 'this day' : mode === 'week' ? 'this week' : 'this month'}`} defaultOpen={!compact}>
          {projRows.length ? (
            <div className="trk-projects">
              {projRows.slice(0, 8).map((p) => (
                <div key={p.key}>
                  <span><b>{p.name}</b><small>{plural(p.count)}{p.minutes > 0 ? ` · ${fmtMinutes(p.minutes)}` : ''}</small></span>
                  <div><i style={{ width: `${(p.count / projRows[0].count) * 100}%`, background: p.color ?? '#0f8a7e' }} /></div>
                </div>
              ))}
            </div>
          ) : <Text fz={12} c="dimmed" pt={6}>Nothing logged in this period yet.</Text>}
        </Foldable>
      </aside>

      <section className="trk-main">
        <div className="trk-head">
          <div className="trk-head-title">
            <button type="button" onClick={() => step(-1)} aria-label="Previous"><IconChevronLeft size={17} /></button>
            <h3>{title}</h3>
            <button type="button" onClick={() => step(1)} aria-label="Next"><IconChevronRight size={17} /></button>
            {selected !== today && <Anchor fz={12} fw={700} ml={4} onClick={() => pick(today)}>Today</Anchor>}
          </div>
          <SegmentedControl
            size="xs" radius="xl" value={mode} onChange={setMode}
            data={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]}
          />
          <button type="button" className="trk-create" onClick={addWork}><IconPlus size={15} stroke={2.6} /> Add work</button>
        </div>

        <div className="trk-stats">
          <div className="trk-card trk-stat">
            <div>
              <small>{selected === today ? 'Today' : sel.format('ddd, MMM D')}</small>
              <b>{plural(dayAll.length)}</b>
              <em>{dayAll.length ? `${statusLine(dayAll)}${dayMinutes > 0 ? ` · ${fmtMinutes(dayMinutes)}` : ''}` : 'nothing logged yet'}</em>
            </div>
          </div>
          <div className="trk-card trk-stat">
            <div>
              <small>This week</small>
              <b>{plural(weekEntries.length)}</b>
              <em>{weekEntries.length ? (weekOpen ? `${weekOpen} still open` : 'all done') : 'nothing yet'}</em>
            </div>
            <div className="trk-spark" aria-hidden="true">
              {week.map((d) => <i key={fmt(d)} data-on={fmt(d) === selected || undefined} style={{ height: `${Math.max(6, ((counts[fmt(d)] ?? 0) / weekMax) * 100)}%` }} title={`${d.format('ddd')} — ${plural(counts[fmt(d)] ?? 0)}`} />)}
            </div>
          </div>
          <div className="trk-card trk-stat">
            <div>
              <small>Top project</small>
              <b className="is-text">{top?.name ?? '—'}</b>
              <em>{top ? `${plural(top.count)} this week` : 'fill the Project column'}</em>
            </div>
          </div>
          <div className="trk-card trk-stat">
            <div>
              <small>Streak</small>
              <b><IconFlame size={17} color="#f08c00" /> {plural(streak, 'day')}</b>
              <Anchor fz={11.5} fw={700} onClick={() => openAssistant('Look at my work log this week — what did I get done per project, what is still open or blocked, and what should I pick up next?')}>Ask Myth AI</Anchor>
            </div>
          </div>
        </div>

        {mode === 'day' && (
          <>
            <DaySheet date={selected} entries={dayEntries} projectNames={projectNames} addSignal={addSignal} isFuture={selected > today} />
            {suggestions.length > 0 && (
              <div className="trk-card trk-suggest">
                <span><IconSparkles size={13} color="#f0a316" /> Myth noticed these — add them?</span>
                {suggestions.map((sg) => (
                  <button key={sg.key} type="button" title={sg.why} onClick={() => { addWorkLog({ title: sg.title, date: selected, projectId: sg.projectId, category: sg.category, status: 'done', source: 'suggested' }); toast.show({ color: 'forest', message: `Added — ${sg.title}` }); }}>
                    <IconPlus size={11} stroke={3} /> {sg.title} <small>{sg.why.toLowerCase()}</small>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {mode === 'week' && <WeekList days={week} entries={visible} projects={projects} selected={selected} onOpen={openDay} />}
        {mode === 'month' && <MonthView month={sel.startOf('month')} entries={visible} selected={selected} onPick={openDay} />}

        <SummaryCard date={selected} entries={dayAll} />
      </section>
    </div>
  );
}
