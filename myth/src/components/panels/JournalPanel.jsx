import { useState } from 'react';
import { Stack, Group, Text, Box, Textarea, Button, ActionIcon, ThemeIcon, Tooltip } from '@mantine/core';
import { IconMoodHappy, IconMoodSmile, IconMoodEmpty, IconMoodSad, IconTrash, IconSparkles } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import EmptyState from '../EmptyState';
import { resolveAI } from '../../ai/assistant';
import { streamChat } from '../../ai/ollama';

const MOODS = [
  { value: 5, label: 'great', icon: IconMoodHappy, color: '#0D2D1C' },
  { value: 4, label: 'good', icon: IconMoodSmile, color: '#74b816' },
  { value: 3, label: 'okay', icon: IconMoodEmpty, color: '#f08c00' },
  { value: 2, label: 'low', icon: IconMoodSad, color: '#e8590c' },
];

const moodOf = (v) => MOODS.find((m) => m.value === v) ?? (v >= 4 ? MOODS[1] : MOODS[2]);

export default function JournalPanel() {
  const { journal, addJournalEntry, deleteJournalEntry, tasks, habits } = useStore();
  const [text, setText] = useState('');
  const [mood, setMood] = useState(4);
  const [drafting, setDrafting] = useState(false);

  const save = () => {
    if (!text.trim()) return;
    addJournalEntry({ text: text.trim(), mood });
    setText('');
    setMood(4);
  };

  // Innovative: let the local AI draft today's recap from what actually happened.
  const draftWithAI = async () => {
    setDrafting(true);
    try {
      const state = useStore.getState();
      const ai = await resolveAI(state);
      if (!ai.ok) {
        notifications.show({ color: 'orange', title: 'AI model not reachable', message: 'Start Ollama to draft recaps automatically.' });
        return;
      }
      const todayKey = dayjs().format('YYYY-MM-DD');
      const done = tasks.filter((t) => t.completedAt && dayjs(t.completedAt).isSame(dayjs(), 'day')).map((t) => t.title);
      const kept = habits.filter((h) => h.log[todayKey]).map((h) => h.name);
      const draft = await streamChat({
        endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey,
        onToken: (t) => setText(t),
        messages: [
          { role: 'system', content: 'Write a 2-3 sentence first-person daily journal recap. Warm, honest, plain text, no emojis, no lists.' },
          { role: 'user', content: `Draft my recap for today. Completed tasks: ${done.join('; ') || 'none'}. Habits kept: ${kept.join('; ') || 'none'}.` },
        ],
      });
      setText(draft.trim());
    } catch (e) {
      notifications.show({ color: 'red', title: 'Draft failed', message: e.message });
    } finally {
      setDrafting(false);
    }
  };

  const entries = [...journal].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0) || b.date.localeCompare(a.date));

  return (
    <Stack gap="md">
      <Box className="glass" p="lg" style={{ borderRadius: 18 }}>
        <Textarea
          variant="unstyled" autosize minRows={3}
          placeholder="What happened? What did you notice? Wins, worries, ideas…"
          value={text} onChange={(e) => setText(e.currentTarget.value)}
          styles={{ input: { fontSize: 14.5, lineHeight: 1.6 } }}
        />
        <Group justify="space-between" mt="md" wrap="wrap" gap="sm">
          <Group gap={8}>
            {MOODS.map((m) => {
              const MIcon = m.icon;
              const active = mood === m.value;
              return (
                <Button
                  key={m.value} size="xs" radius="xl"
                  variant={active ? 'filled' : 'default'}
                  color={active ? 'forest' : undefined}
                  leftSection={<MIcon size={16} color={active ? '#fff' : m.color} />}
                  onClick={() => setMood(m.value)}
                >
                  {m.label}
                </Button>
              );
            })}
          </Group>
          <Group gap={8}>
            <Tooltip label="Let AI draft today's recap from your completed tasks & habits">
              <ActionIcon size={36} radius="xl" variant="light" color="forest" loading={drafting} onClick={draftWithAI}>
                <IconSparkles size={17} />
              </ActionIcon>
            </Tooltip>
            <Button radius="xl" color="forest" onClick={save} disabled={!text.trim()}>
              Save entry
            </Button>
          </Group>
        </Group>
      </Box>

      {entries.length === 0 && (
        <EmptyState kind="journal" color="#7048e8" title="No entries yet" hint="One honest line a day compounds into your monthly story." />
      )}

      <Stack gap={10}>
        {entries.map((j) => {
          const m = moodOf(j.mood);
          const MIcon = m.icon;
          const body = j.text ?? [j.wins, j.gratitude, j.reflection].filter(Boolean).join(' · ');
          if (!body) return null;
          return (
            <Box key={j.id} className="glass" p="md" style={{ borderRadius: 16 }}>
              <Group align="flex-start" gap={12} wrap="nowrap">
                <ThemeIcon size={40} radius="xl" variant="light" style={{ color: m.color, background: `${m.color}18` }}>
                  <MIcon size={24} />
                </ThemeIcon>
                <Box style={{ flex: 1 }}>
                  <Group justify="space-between" mb={2}>
                    <Text fz={12.5} c="dimmed" fw={600}>
                      {dayjs(j.date).format('D MMM')} · {m.label}
                    </Text>
                    <Group gap={6}>
                      <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => deleteJournalEntry(j.id)}>
                        <IconTrash size={13} />
                      </ActionIcon>
                    </Group>
                  </Group>
                  <Text fz={14} lh={1.55}>{body}</Text>
                </Box>
              </Group>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}
