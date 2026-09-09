// The amber "Explore" card: every module one tap away, with a live count.
import { IconChecklist, IconFolders, IconNotes, IconCalendarMonth, IconRepeat, IconWallet, IconSchool, IconCloudLock, IconCompass, IconChartAreaLine, IconBrain, IconLayoutDashboard } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';

export default function ExploreCard({ onOpen, active }) {
  const s = useStore();
  const today = dayjs().format('YYYY-MM-DD');
  const items = [
    { key: 'tasks', label: 'Tasks', icon: IconChecklist, count: s.tasks.filter((t) => t.status !== 'done').length },
    { key: 'projects', label: 'Projects', icon: IconFolders, count: s.projects.filter((p) => p.status === 'active').length },
    { key: 'notes', label: 'Notes', icon: IconNotes, count: s.notes.length },
    { key: 'calendar', label: 'Calendar', icon: IconCalendarMonth, count: s.events.filter((e) => e.date >= today).length },
    { key: 'habits', label: 'Habits', icon: IconRepeat, count: `${s.habits.filter((h) => h.log?.[today]).length}/${s.habits.length}` },
    { key: 'finance', label: 'Finance', icon: IconWallet },
    { key: 'planner', label: 'Planner', icon: IconCompass, count: (s.plannerSessions ?? []).filter((x) => x.status !== 'done').length || null },
    { key: 'learning', label: 'Learning', icon: IconSchool, count: (s.learning ?? []).length || null },
    { key: 'drive', label: 'Drive', icon: IconCloudLock },
    { key: 'context', label: 'Context', icon: IconBrain },
    { key: 'today', label: 'Daily planner', icon: IconLayoutDashboard },
    { key: 'reports', label: 'Reports', icon: IconChartAreaLine },
  ];
  return (
    <section className="explore">
      <div className="explore-title">Explore</div>
      <div className="explore-sub">Everything in one place — tap a section to open it right here.</div>
      <div className="explore-chips">
        {items.map(({ key, label, icon: Icon, count }) => (
          <button key={key} type="button" className="explore-chip" data-active={active === key || undefined} onClick={() => onOpen(key)}>
            <Icon size={15} stroke={2} />{label}{count != null && count !== 0 && <small>{count}</small>}
          </button>
        ))}
      </div>
    </section>
  );
}
