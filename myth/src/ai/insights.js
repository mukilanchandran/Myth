// Analytics + report generation over the local dataset.
// Everything lives in one flow, so a month's stats cover tasks, projects,
// notes, money, habits and journal together.
import dayjs from 'dayjs';

export function monthStats(state, monthISO) {
  const m = dayjs(monthISO);
  const inMonth = (d) => d && dayjs(d).isSame(m, 'month');

  const tasks = state.tasks ?? [];
  const created = tasks.filter((t) => inMonth(t.created));
  const completed = tasks.filter((t) => t.status === 'done' && inMonth(t.completedAt));
  const overdue = tasks.filter((t) => t.status !== 'done' && t.due && dayjs(t.due).isBefore(dayjs(), 'day'));
  const open = tasks.filter((t) => t.status !== 'done');

  const notes = (state.notes ?? []).filter((n) => inMonth(n.created));
  const meetings = notes.filter((n) => n.type === 'meeting');
  const ideas = notes.filter((n) => n.type === 'idea');

  const projectProgress = (state.projects ?? []).map((p) => {
    const pt = tasks.filter((t) => t.projectId === p.id);
    const done = pt.filter((t) => t.status === 'done').length;
    return { name: p.name, total: pt.length, done, pct: pt.length ? Math.round((done / pt.length) * 100) : 0 };
  });

  // completion by week-of-month for the trend chart
  const weekly = [1, 2, 3, 4, 5].map((w) => ({
    week: `W${w}`,
    completed: completed.filter((t) => Math.ceil(dayjs(t.completedAt).date() / 7) === w).length,
    created: created.filter((t) => Math.ceil(dayjs(t.created).date() / 7) === w).length,
  }));

  // money
  const tx = (state.transactions ?? []).filter((t) => inMonth(t.date));
  const spent = tx.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const earned = tx.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const byCat = {};
  tx.filter((t) => t.type === 'expense').forEach((t) => { byCat[t.category] = (byCat[t.category] ?? 0) + t.amount; });
  const expenseByCategory = Object.entries(byCat).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // habits
  const daysInMonth = m.daysInMonth();
  const habitStats = (state.habits ?? []).map((h) => {
    const done = Object.keys(h.log ?? {}).filter((d) => dayjs(d).isSame(m, 'month')).length;
    return { name: h.name, icon: h.icon, done, pct: Math.round((done / daysInMonth) * 100) };
  });
  const habitConsistency = habitStats.length
    ? Math.round(habitStats.reduce((a, h) => a + h.pct, 0) / habitStats.length) : 0;

  // journal
  const journalEntries = (state.journal ?? []).filter((j) => dayjs(j.date).isSame(m, 'month'));
  const avgMood = journalEntries.length
    ? (journalEntries.reduce((a, j) => a + (j.mood ?? 3), 0) / journalEntries.length).toFixed(1) : null;

  return {
    month: m.format('MMMM YYYY'),
    created: created.length,
    completed: completed.length,
    completionRate: created.length ? Math.round((completed.length / created.length) * 100) : (completed.length ? 100 : 0),
    overdue: overdue.length,
    open: open.length,
    meetings: meetings.length,
    ideas: ideas.length,
    notes: notes.length,
    projectProgress,
    weekly,
    topTasks: [...completed].sort((a, b) => b.priority - a.priority).slice(0, 5),
    spent,
    earned,
    savings: earned - spent,
    expenseByCategory,
    habitStats,
    habitConsistency,
    avgMood,
    journalCount: journalEntries.length,
  };
}

export function narrative(stats, name) {
  const lines = [];
  lines.push(`Here's your month in review, ${name} — ${stats.month}.`);
  if (stats.completed > 0) lines.push(`You completed ${stats.completed} task${stats.completed > 1 ? 's' : ''} (${stats.completionRate}% completion rate).`);
  else lines.push(`No tasks were completed this month — a fresh slate to build momentum.`);
  if (stats.overdue > 0) lines.push(`${stats.overdue} task${stats.overdue > 1 ? 's are' : ' is'} overdue — worth clearing or rescheduling this week.`);
  if (stats.meetings > 0) lines.push(`You logged ${stats.meetings} meeting${stats.meetings > 1 ? 's' : ''} with notes.`);
  if (stats.ideas > 0) lines.push(`${stats.ideas} new idea${stats.ideas > 1 ? 's' : ''} captured in your vault.`);
  const active = stats.projectProgress.filter((p) => p.total > 0);
  if (active.length) {
    const best = [...active].sort((a, b) => b.pct - a.pct)[0];
    lines.push(`Strongest project: "${best.name}" at ${best.pct}% complete.`);
    const lag = [...active].sort((a, b) => a.pct - b.pct)[0];
    if (lag.name !== best.name && lag.pct < 50) lines.push(`"${lag.name}" is lagging at ${lag.pct}% — consider breaking it into smaller tasks.`);
  }
  // money
  if (stats.earned || stats.spent) lines.push(`Money: earned ₹${stats.earned.toLocaleString('en-IN')}, spent ₹${stats.spent.toLocaleString('en-IN')} → ${stats.savings >= 0 ? 'saved' : 'overspent'} ₹${Math.abs(stats.savings).toLocaleString('en-IN')}.`);
  if (stats.expenseByCategory[0]) lines.push(`Biggest spend: ${stats.expenseByCategory[0].name} (₹${stats.expenseByCategory[0].value.toLocaleString('en-IN')}).`);
  // habits & mood
  if (stats.habitConsistency) lines.push(`Habit consistency: ${stats.habitConsistency}%${stats.habitConsistency >= 70 ? ' — excellent discipline.' : stats.habitConsistency >= 40 ? ' — decent, push for 70%+.' : ' — habits need attention.'}`);
  if (stats.avgMood) lines.push(`Average mood: ${stats.avgMood}/5 across ${stats.journalCount} journal entr${stats.journalCount === 1 ? 'y' : 'ies'}.`);
  // improvement suggestions
  const improve = [];
  if (stats.completionRate < 60 && stats.created > 3) improve.push('commit to fewer tasks and finish them');
  if (stats.overdue > 2) improve.push('review deadlines every morning');
  if (stats.habitStats.length && stats.habitConsistency < 50) improve.push('anchor habits to a fixed time of day');
  if (stats.meetings === 0) improve.push('log meeting notes so nothing is lost');
  if (stats.savings < 0) improve.push('keep spending under what comes in');
  if (improve.length) lines.push(`Next month, focus on: ${improve.join('; ')}.`);
  return lines;
}
