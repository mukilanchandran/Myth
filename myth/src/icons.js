// Central design-system icon registry (Tabler icons — Mantine's standard set).
// Entities store a string key; components resolve it here. Legacy emoji keys
// from older data are mapped so nothing breaks.
import {
  IconDroplet, IconBarbell, IconBook, IconYoga, IconSalad, IconWalk,
  IconMoonStars, IconPencil, IconPalette, IconCode, IconHeart, IconSparkles,
  IconCalendarEvent, IconCake, IconCreditCard, IconFlag, IconChecklist, IconTargetArrow,
  IconMoodCry, IconMoodSad, IconMoodEmpty, IconMoodSmile, IconMoodHappy,
} from '@tabler/icons-react';

export const HABIT_ICONS = {
  water: IconDroplet,
  workout: IconBarbell,
  read: IconBook,
  meditate: IconYoga,
  eat: IconSalad,
  walk: IconWalk,
  sleep: IconMoonStars,
  write: IconPencil,
  design: IconPalette,
  code: IconCode,
  love: IconHeart,
  spark: IconSparkles,
};

const EMOJI_TO_HABIT = {
  '💧': 'water', '🏋️': 'workout', '📚': 'read', '🧘': 'meditate', '🥗': 'eat',
  '🚶': 'walk', '💤': 'sleep', '✍️': 'write', '🎨': 'design', '💻': 'code',
  '🙏': 'love', '✨': 'spark',
};

export function habitIcon(key) {
  return HABIT_ICONS[key] ?? HABIT_ICONS[EMOJI_TO_HABIT[key]] ?? IconSparkles;
}

export const EVENT_ICONS = {
  meeting: { icon: IconCalendarEvent, color: '#7048e8' },
  birthday: { icon: IconCake, color: '#e64980' },
  bill: { icon: IconCreditCard, color: '#e8590c' },
  event: { icon: IconFlag, color: '#1971c2' },
  task: { icon: IconChecklist, color: '#0D2D1C' },
  focus: { icon: IconTargetArrow, color: '#0D2D1C' }, // Command Center focus block
};

export function eventIcon(kind) {
  return EVENT_ICONS[kind] ?? EVENT_ICONS.event;
}

export const MOOD_ICONS = [
  { icon: IconMoodCry, color: '#e03131', label: 'Rough' },
  { icon: IconMoodSad, color: '#f08c00', label: 'Low' },
  { icon: IconMoodEmpty, color: '#868e96', label: 'Okay' },
  { icon: IconMoodSmile, color: '#74b816', label: 'Good' },
  { icon: IconMoodHappy, color: '#0D2D1C', label: 'Great' },
];
