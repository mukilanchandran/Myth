// The full Myth AI conversation: ask anything, drop a file in, and tell Myth
// what to do with it — every module of the app is one sentence away
// ("add this pdf to learning", "make a cheat sheet on SQL joins and save it
// to learning", "add task pay rent tomorrow", "plan a trip to Goa in Dec").
import { useEffect, useRef, useState } from 'react';
import { Stack, Group, Text, Box, TextInput, ActionIcon, Loader, Button, Badge, Tooltip } from '@mantine/core';
import { IconSend, IconTrash, IconHistory, IconPlus, IconX } from '@tabler/icons-react';
import MythBot from './MythBot';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { askAssistant, resolveAI } from '../ai/assistant';
import { useChatFiles } from './chat/useChatFiles';
import { AttachButton, FileTray } from './chat/FileTray';
import ChatMessage from './chat/ChatMessage';

const SUGGESTIONS = [
  'What should I do now?',
  'What meetings do I have this week?',
  'Add task: pay the electricity bill on Friday',
  'Make a study sheet on React hooks and add it to learning',
  'Plan a trip from Chennai to Kodaikanal next weekend for 2',
  'Generate my monthly report',
  "What's overdue?",
  'How much did I spend this month?',
];

// `compact`: the small floating panel (AssistantDock) — tighter header, chip
// suggestions, smaller controls; `onClose` adds a close button to the header.
export default function ChatAssistant({ initialQuestion, onConsumedInitial, compact = false, onClose }) {
  const {
    chat, chatHistory, pushChat, updateChat,
    startNewChat, loadChatSession, deleteChatSession, pruneChat,
  } = useStore();
  const [value, setValue] = useState('');
  const [thinking, setThinking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [engine, setEngine] = useState(null); // null = checking, {model} = LLM, false = offline brain
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef(null);
  const filesApi = useChatFiles();

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
    if ((!question && !filesApi.pending.length) || thinking || filesApi.busy) return;
    setValue('');
    setShowHistory(false);
    const files = filesApi.take();
    pushChat({ role: 'user', text: question || `Here ${files.length === 1 ? 'is a file' : 'are some files'}.`, files });
    setThinking(true);
    let aiId = null; // created lazily on the first streamed token
    const onToken = (textSoFar) => {
      if (!textSoFar) return;
      if (!aiId) aiId = pushChat({ role: 'ai', text: textSoFar });
      else updateChat(aiId, { text: textSoFar });
    };
    try {
      const answer = await askAssistant(question || 'I attached a file. Tell me what it is about in two lines and what you could do with it.', useStore, onToken, { files });
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

  // paste a screenshot / drop a file anywhere in the conversation
  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); filesApi.ingest(files); }
  };

  const sessionLabel = (h) => h.messages.find((m) => m.role === 'user')?.text ?? 'Conversation';

  return (
    <Stack
      gap="sm" h="100%" style={{ minHeight: 0, outline: dragOver ? '2px dashed #0D2D1C' : 'none', outlineOffset: -2, borderRadius: 16 }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); filesApi.ingest(e.dataTransfer?.files); }}
      onPaste={onPaste}
    >
      <Group justify="space-between">
        <Group gap={8}><MythBot size={compact ? 26 : 30} active mood={thinking ? 'thinking' : 'idle'} /><Text fw={700} fz={compact ? 13 : 14}>{compact ? 'Myth AI' : 'At your service, Boss'}</Text></Group>
        <Group gap={6}>
          <Tooltip label={engine ? 'AI model connected — open-ended chat and file generation are live' : engine === false ? 'Connect a free AI in Settings → AI brain (Groq / OpenRouter / Gemini) — the offline brain still answers data questions and files things' : 'Checking for an AI model…'}>
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
          {onClose && (
            <Tooltip label="Close (Esc)">
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose} aria-label="Close Myth AI"><IconX size={15} /></ActionIcon>
            </Tooltip>
          )}
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
                  <IconHistory size={15} color="#1b5a38" style={{ flexShrink: 0 }} />
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
                <Text fz={12.5} c="dimmed">I can answer, and I can act — tasks, money, habits, projects, files, learning, the planner. Drop a PDF here and say where it goes. Try:</Text>
                <Group gap={compact ? 6 : 8} align="flex-start" style={compact ? undefined : { flexDirection: 'column' }}>
                  {(compact ? SUGGESTIONS.slice(0, 5) : SUGGESTIONS).map((s) => (
                    <Button key={s} variant="light" color="forest" radius="xl" size={compact ? 'compact-xs' : 'xs'} onClick={() => ask(s)}>
                      {s}
                    </Button>
                  ))}
                </Group>
              </Stack>
            )}
            <Stack gap={10} py="xs">
              {chat.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <ChatMessage m={m} fz={compact ? 13 : 13.5} />
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

      <FileTray pending={filesApi.pending} onRemove={filesApi.remove} />
      <Group gap={8} wrap="nowrap">
        <AttachButton onFiles={filesApi.ingest} size={compact ? 34 : 38} variant="light" />
        <TextInput
          style={{ flex: 1 }} radius="xl" size={compact ? 'sm' : 'md'} autoFocus={compact} placeholder={filesApi.pending.length ? 'What should I do with it? e.g. "add this to learning"' : 'Ask, or tell me what to add where…'}
          value={value} onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <ActionIcon size={compact ? 34 : 38} radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }} loading={thinking || filesApi.busy} onClick={() => ask()} aria-label="Send">
          <IconSend size={17} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
