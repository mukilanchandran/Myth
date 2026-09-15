// Small text helpers shared by the capture parser and the notification rules.
import dayjs from 'dayjs';

const STOP = new Set((
  'a an the and or of to in on at for with by from this that these those is are was were be been it its my our your their we you ' +
  'i me he she they them as about into over after before up down out off than then so if not no do does did have has had will would ' +
  'can could should may might must new old re vs via per quick check update meeting meet call sync standup tomorrow today tonight ' +
  'next this week month day morning evening afternoon'
).split(/\s+/));

/** Meaningful words of a title, lower-cased, stop words and numbers dropped. */
export function tokens(text = '') {
  const out = new Set();
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').forEach((w) => {
    if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  });
  return [...out];
}

const ROLE = new Set(['me', 'myself', 'i', 'team', 'all', 'everyone', 'client', 'clients', 'pm', 'dev', 'lead', 'manager', 'hr', 'ceo', 'cto',
  'designer', 'developer', 'product', 'design', 'engineering', 'sales', 'marketing', 'support', 'staff', 'boss']);
const DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april',
  'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'today', 'tomorrow', 'yesterday']);

/** People mentioned in a title ("with Ravi", "Amma's", "client Acme") or listed as participants. */
export function extractPeople(text = '', participants = '') {
  const found = new Map();
  const add = (raw) => {
    const name = String(raw).replace(/\(.*?\)/g, '').replace(/[^\w' -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length < 3) return;
    const key = name.toLowerCase();
    if (DAYS.has(key) || key.split(' ').every((w) => ROLE.has(w))) return;
    if (!found.has(key)) found.set(key, name);
  };
  String(participants).split(/[,;&/]|\band\b|\bwith\b/i).forEach(add);
  const t = String(text);
  for (const m of t.matchAll(/\b(?:with|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g)) add(m[1]);
  for (const m of t.matchAll(/\b([A-Z][a-z]{2,})'s\b/g)) add(m[1]);
  for (const m of t.matchAll(/\bclient\s+([A-Z][a-z]+)/g)) add(m[1]);
  return [...found.entries()].map(([key, name]) => ({ key, name }));
}

/** "Today", "Tomorrow", "Friday", "Mon, Oct 3". */
export function relDay(date, now = dayjs()) {
  if (!date) return '';
  const d = dayjs(date);
  const diff = d.startOf('day').diff(dayjs(now).startOf('day'), 'day');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.format('dddd');
  return d.format('ddd, MMM D');
}
