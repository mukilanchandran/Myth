import { useEffect, useRef, useState } from 'react';
import { Stack, Group, Text, Box, TextInput, ActionIcon, Loader, Button, Badge, Tooltip } from '@mantine/core';
import { IconSend, IconRobotFace, IconTrash, IconHistory, IconPlus } from '@tabler/icons-react';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { askAssistant, resolveAI } from '../ai/assistant';

const SUGGESTIONS = [
  "What's on today's plan?",
  'What are my priorities today?',
  'Generate my monthly report',
  "What's overdue?",
  'How much did I spend this month?',
  "What's coming up on my calendar?",
];

export default function ChatAssistant({ initialQuestion, onConsumedInitial }) {
  const {
    chat, chatHistory, pushChat, updateChat,
    startNewChat, loadChatSession, deleteChatSession, pruneChat,
  } = useStore();
  const [value, setValue] = useState('');
  const [thinking, setThinking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [engine, setEngine] = useState(null); // null = checking, {model} = LLM, false = offline brain
  const bottomRef = useRef(null);

  useEffect(() => {
    pruneChat(); // drop history older than 3 days
    let alive = true;
    resolveAI(useStore.getState()).then((ai) => {
      if (alive) setEngine(ai.ok ? { model: ai.model } : false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async (q) => {
    const question = (q ?? value).trim();
    if (!question || thinking) return;
    setValue('');
    setShowHistory(false);
    pushChat({ role: 'user', text: question });
    setThinking(true);
    let aiId = null; // created lazily on the first streamed token
    const onToken = (textSoFar) => {
      if (!aiId) aiId = pushChat({ role: 'ai', text: textSoFar });
      else updateChat(aiId, { text: textSoFar });
    };
    try {
      const answer = await askAssistant(question, useStore, onToken);
      if (aiId) updateChat(aiId, { text: answer });
      else pushChat({ role: 'ai', text: answer });
    } catch (e) {
      pushChat({ role: 'ai', text: `Something went wrong: ${e.message}` });
    } finally {
      setThinking(false);
    }
  };

  useEffect(() => {
    if (initialQuestion) {
      ask(initialQuestion);
      onConsumedInitial?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, thinking]);

  const sessionLabel = (h) => h.messages.find((m) => m.role === 'user')?.text ?? 'Conversation';

  return (
    <Stack gap="sm" h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between">
        <Group gap={6}><IconRobotFace size={18} color="#12a150" /><Text fw={700} fz={14}>At your service, Boss — ask me anything</Text></Group>
        <Group gap={6}>
          <Tooltip label={engine ? 'AI model connected — open-ended chat is live' : engine === false ? 'Connect a free AI in Settings → AI brain (Groq / OpenRouter / Gemini) — offline brain answers data questions' : 'Checking for an AI model…'}>
            <Badge size="sm" variant="light" color={engine ? 'grape' : engine === false ? 'gray' : 'blue'}>
              {engine ? engine.model : engine === false ? 'offline brain' : 'detecting…'}
            </Badge>
          </Tooltip>
          <Tooltip label="New chat (this one is kept in history for 3 days)">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => { startNewChat(); setShowHistory(false); }}>
              <IconPlus size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="History — old chats auto-delete after 3 days">
            <ActionIcon variant={showHistory ? 'light' : 'subtle'} color={showHistory ? 'forest' : 'gray'} size="sm" onClick={() => setShowHistory((v) => !v)}>
              <IconHistory size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Box className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
        {showHistory ? (
          chatHistory.length === 0 ? (
            <Text fz={13} c="dimmed" ta="center" mt="lg">
              No past chats yet — conversations are kept here for 3 days, then clear themselves.
            </Text>
          ) : (
            <Stack gap={8} py="xs">
              {chatHistory.map((h) => (
                <Group
                  key={h.id} gap={10} wrap="nowrap" p="sm"
                  style={{ borderRadius: 14, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.6)', cursor: 'pointer' }}
                  onClick={() => { loadChatSession(h.id); setShowHistory(false); }}
                >
                  <IconHistory size={15} color="#0f766e" style={{ flexShrink: 0 }} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text fz={13} fw={600} truncate>{sessionLabel(h)}</Text>
                    <Text fz={11} c="dimmed">{dayjs(h.ts).format('ddd, MMM D · h:mm A')} · {h.messages.length} messages</Text>
                  </Box>
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); deleteChatSession(h.id); }}>
                    <IconTrash size={13} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )
        ) : (
          <>
            {chat.length === 0 && (
              <Stack gap={8} mt="md">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="light" color="forest" radius="xl" size="xs" onClick={() => ask(s)} style={{ alignSelf: 'flex-start' }}>
                    {s}
                  </Button>
                ))}
              </Stack>
            )}
            <Stack gap={10} py="xs">
              {chat.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Box
                    p="sm" px="md" maw="88%"
                    style={{
                      borderRadius: 16,
                      marginLeft: m.role === 'user' ? 'auto' : 0,
                      background: m.role === 'user' ? 'linear-gradient(135deg,#12a150,#0f766e)' : 'rgba(255,255,255,0.75)',
                      color: m.role === 'user' ? '#fff' : '#16281f',
                      border: '1px solid rgba(255,255,255,0.6)',
                    }}
                  >
                    <Text fz={13.5} lh={1.55} style={{ whiteSpace: 'pre-line' }}>{m.text}</Text>
                  </Box>
                </motion.div>
              ))}
              {thinking && (
                <Group gap={8} pl={4}><Loader size="xs" color="forest" type="dots" /><Text fz={12.5} c="dimmed">Myth is thinking…</Text></Group>
              )}
              <div ref={bottomRef} />
            </Stack>
          </>
        )}
      </Box>

      <Group gap={8}>
        <TextInput
          style={{ flex: 1 }} radius="xl" placeholder="Ask about your plan, tasks, money, habits — anything…"
          value={value} onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <ActionIcon size={38} radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }} onClick={() => ask()}>
          <IconSend size={17} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
