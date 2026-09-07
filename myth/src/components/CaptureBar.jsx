import { useEffect, useRef, useState } from 'react';
import { Box, TextInput, ActionIcon, Group, Text, Tooltip, Chip, Stack, Loader } from '@mantine/core';
import {
  IconMicrophone, IconSend, IconMicrophoneFilled, IconListCheck,
  IconRobotFace, IconX, IconTrash, IconArrowsDiagonal, IconHistory, IconPlus,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { motion, AnimatePresence } from 'framer-motion';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { parseMulti, executeCapture } from '../ai/parser';
import { askAssistant } from '../ai/assistant';
import { detectProjectIntent } from '../ai/projectPlanner';
import DayPlan from './DayPlan';

const CHAT_HINTS = [
  'What should I do now?',
  "Prepare me for tomorrow's meeting",
  'What should I handle today?',
  'What are my priorities today?',
  "What's overdue?",
  'Generate my monthly report',
];

// Clear question phrasing — even in Plan mode this deserves an answer, not a task.
const QUESTION = /^(what|how|which|when|who|why|where|can|could|should|would|is|are|am|do|does|did|tell|explain|show|hi|hey|hello|thanks|thank)\b|^(?:prep(?:are)?\s+me|brief\s+me|get\s+me\s+ready)\b|^(?:follow|apply|accept|go with|clear|cancel|drop)\s+(?:the\s+|your\s+|my\s+|myth'?s?\s+|today'?s?\s+)?(?:plan|focus blocks?)\b|\?$/i;

export default function CaptureBar({ onExpand, onChatOpen }) {
  const [value, setValue] = useState('');
  const [barMode, setBarMode] = useState('plan'); // 'plan' | 'chat'
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [open, setOpen] = useState(false); // inline conversation visible
  const [showHistory, setShowHistory] = useState(false);
  const recRef = useRef(null);
  const scrollRef = useRef(null);

  const projects = useStore((s) => s.projects);
  const proposeProject = useStore((s) => s.proposeProject);
  const chat = useStore((s) => s.chat);
  const chatHistory = useStore((s) => s.chatHistory);
  const pushChat = useStore((s) => s.pushChat);
  const updateChat = useStore((s) => s.updateChat);
  const startNewChat = useStore((s) => s.startNewChat);
  const loadChatSession = useStore((s) => s.loadChatSession);
  const deleteChatSession = useStore((s) => s.deleteChatSession);
  const chatMode = barMode === 'chat';

  // let the shell know the conversation is taking over the page
  useEffect(() => { onChatOpen?.(open); }, [open, onChatOpen]);

  // keep the newest message in view without ever scrolling the page itself
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, thinking, open]);

  // Chatbot always opens fresh — the previous talk moves into history (kept 3 days).
  const switchMode = (next) => {
    if (next === barMode) return;
    setBarMode(next);
    setShowHistory(false);
    if (next === 'chat') startNewChat();
    else setOpen(false);
  };

  const ask = async (q) => {
    if (thinking) return;
    setOpen(true);
    setShowHistory(false);
    pushChat({ role: 'user', text: q });
    setThinking(true);
    let aiId = null; // created on the first streamed token
    const onToken = (textSoFar) => {
      if (!aiId) aiId = pushChat({ role: 'ai', text: textSoFar });
      else updateChat(aiId, { text: textSoFar });
    };
    try {
      const answer = await askAssistant(q, useStore, onToken);
      if (aiId) updateChat(aiId, { text: answer });
      else pushChat({ role: 'ai', text: answer });
    } catch (e) {
      pushChat({ role: 'ai', text: `Something went wrong, Boss: ${e.message}` });
    } finally {
      setThinking(false);
    }
  };

  const submit = (text) => {
    const t = (text ?? value).trim();
    if (!t || thinking) return;
    setValue('');

    // chatbot mode, or clear question phrasing → the assistant
    if (chatMode || QUESTION.test(t)) { ask(t); return; }

    // "I need to launch my portfolio website next month" → a proposed project
    // (milestones + tasks) to review — never thirty silent tasks
    const intent = detectProjectIntent(t);
    if (intent) {
      proposeProject(t, intent);
      setLastResult({ count: 1, msgs: [`Drafted a project plan for "${intent.name}" — nothing is created until you confirm`] });
      setTimeout(() => setLastResult(null), 5000);
      return;
    }

    // Plan mode: split the sentence and route every piece to its feature
    const items = parseMulti(t, projects);
    if (!items.length) { ask(t); return; } // nothing capturable — let the bot handle it

    const msgs = items.map((parsed) => executeCapture(parsed, useStore));
    setLastResult({ count: items.length, msgs });
    setTimeout(() => setLastResult(null), items.length > 1 ? 6500 : 4200);
  };

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      notifications.show({ color: 'orange', title: 'Voice not supported', message: 'Your browser lacks the Web Speech API. Try Chrome or Edge.' });
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ');
      setValue(transcript);
      if (e.results[e.results.length - 1].isFinal) {
        setListening(false);
        submit(transcript);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const sessionLabel = (h) => {
    const firstUser = h.messages.find((m) => m.role === 'user');
    return firstUser?.text ?? 'Conversation';
  };

  return (
    <Box w="100%" maw={720} mx="auto">
      <Box
        className="glass-strong"
        p={8}
        pl={10}
        style={{ borderRadius: 999, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {/* Plan / Chatbot switch */}
        <Group
          gap={2} p={3}
          style={{ borderRadius: 999, background: 'rgba(15,81,50,0.09)', flexShrink: 0 }}
        >
          <Tooltip label="Plan mode — I split what you type into tasks, calendar, plan, money…">
            <ActionIcon
              size={32} radius="xl"
              variant={!chatMode ? 'gradient' : 'subtle'}
              gradient={{ from: '#12a150', to: '#0f766e' }}
              color="forest"
              onClick={() => switchMode('plan')}
            >
              <IconListCheck size={18} color={!chatMode ? '#fff' : '#12a150'} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Chatbot mode — talk to Myth AI (opens a fresh chat)">
            <ActionIcon
              size={32} radius="xl"
              variant={chatMode ? 'gradient' : 'subtle'}
              gradient={{ from: '#12a150', to: '#0f766e' }}
              color="forest"
              onClick={() => switchMode('chat')}
            >
              <IconRobotFace size={18} color={chatMode ? '#fff' : '#12a150'} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <TextInput
          className="capture-input"
          variant="unstyled"
          size="lg"
          style={{ flex: 1 }}
          placeholder={
            listening ? 'Listening… speak now'
              : chatMode ? 'Ask me anything, Boss…'
                : 'Plan anything — tasks, meetings, birthdays, money, habits…'
          }
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Tooltip label={listening ? 'Stop listening' : chatMode ? 'Speak — ask Myth' : 'Speak — I will plan it'}>
          <ActionIcon
            size={44}
            radius="xl"
            variant={listening ? 'filled' : 'light'}
            color={listening ? 'red' : 'forest'}
            className={listening ? 'pulse-soft' : ''}
            onClick={toggleVoice}
          >
            {listening ? <IconMicrophoneFilled size={20} /> : <IconMicrophone size={20} />}
          </ActionIcon>
        </Tooltip>
        <ActionIcon
          size={44} radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }}
          loading={thinking} onClick={() => submit()}
        >
          <IconSend size={19} />
        </ActionIcon>
      </Box>

      {/* inline conversation with Myth */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Box className="glass" mt={10} p={12} style={{ borderRadius: 20 }}>
              <Group justify="space-between" mb={8}>
                <Group gap={6}>
                  <IconRobotFace size={15} color="#12a150" />
                  <Text fz={12} fw={700} c="#0f5132">Myth AI</Text>
                </Group>
                <Group gap={2}>
                  <Tooltip label="New chat (current one is kept in history for 3 days)">
                    <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => { startNewChat(); setShowHistory(false); }}>
                      <IconPlus size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="History — old chats auto-delete after 3 days">
                    <ActionIcon
                      size="sm" variant={showHistory ? 'light' : 'subtle'} color={showHistory ? 'forest' : 'gray'}
                      onClick={() => setShowHistory((v) => !v)}
                    >
                      <IconHistory size={13} />
                    </ActionIcon>
                  </Tooltip>
                  {onExpand && (
                    <Tooltip label="Open full chat">
                      <ActionIcon size="sm" variant="subtle" color="gray" onClick={onExpand}><IconArrowsDiagonal size={13} /></ActionIcon>
                    </Tooltip>
                  )}
                  <Tooltip label="Close">
                    <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setOpen(false)}><IconX size={13} /></ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              {showHistory ? (
                <Box className="scroll-y" style={{ maxHeight: 210 }}>
                  {chatHistory.length === 0 ? (
                    <Text fz={12.5} c="dimmed" ta="center" py={16}>
                      No past chats — history keeps conversations for 3 days, then clears itself.
                    </Text>
                  ) : (
                    <Stack gap={6}>
                      {chatHistory.map((h) => (
                        <Group
                          key={h.id} gap={8} wrap="nowrap" py={7} px={10}
                          style={{ borderRadius: 12, background: 'rgba(255,255,255,0.72)', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.6)' }}
                          onClick={() => { loadChatSession(h.id); setShowHistory(false); }}
                        >
                          <IconHistory size={13} color="#0f766e" style={{ flexShrink: 0 }} />
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text fz={12.5} fw={600} c="#16281f" truncate>{sessionLabel(h)}</Text>
                            <Text fz={10.5} c="dimmed">{dayjs(h.ts).format('ddd, MMM D · h:mm A')}</Text>
                          </Box>
                          <ActionIcon
                            size="sm" variant="subtle" color="gray"
                            onClick={(e) => { e.stopPropagation(); deleteChatSession(h.id); }}
                          >
                            <IconTrash size={12} />
                          </ActionIcon>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Box>
              ) : (
                <Box ref={scrollRef} className="scroll-y" style={{ maxHeight: 210 }}>
                  <Stack gap={8}>
                    {chat.length === 0 && !thinking && (
                      <Text fz={12.5} c="dimmed" ta="center" py={12}>Fresh chat — ask me anything, Boss.</Text>
                    )}
                    {chat.slice(-14).map((m) => (
                      <Box
                        key={m.id}
                        py={8} px={12} maw="88%"
                        style={{
                          borderRadius: 14,
                          marginLeft: m.role === 'user' ? 'auto' : 0,
                          background: m.role === 'user' ? 'linear-gradient(135deg,#12a150,#0f766e)' : 'rgba(255,255,255,0.82)',
                          color: m.role === 'user' ? '#fff' : '#16281f',
                          border: '1px solid rgba(255,255,255,0.6)',
                        }}
                      >
                        <Text fz={13} lh={1.5} style={{ whiteSpace: 'pre-line' }}>{m.text}</Text>
                      </Box>
                    ))}
                    {thinking && (
                      <Group gap={7} pl={2}>
                        <Loader size="xs" color="forest" type="dots" />
                        <Text fz={12} c="dimmed">Myth is thinking…</Text>
                      </Group>
                    )}
                  </Stack>
                </Box>
              )}
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lastResult && !open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}
          >
            <Box className="glass" px={18} py={10} style={{ borderRadius: 18, display: 'inline-block', maxWidth: '100%' }}>
              {lastResult.count > 1 && (
                <Text fz={12.5} fw={700} c="#0f5132" mb={4}>{lastResult.count} items captured</Text>
              )}
              {lastResult.msgs.map((m, i) => (
                <Text key={i} fz={13.5} fw={600} c="#0f5132">✓ {m}</Text>
              ))}
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      {!lastResult && !open && (
        chatMode ? (
          <Group justify="center" gap={8} mt={10} px={4}>
            {CHAT_HINTS.map((h) => (
              <Chip
                key={h}
                size="xs"
                variant="light"
                checked={false}
                onClick={() => submit(h)}
                styles={{ label: { background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(12px)', color: '#0e2018', fontWeight: 600, border: '1px solid rgba(255,255,255,0.9)' } }}
              >
                {h}
              </Chip>
            ))}
          </Group>
        ) : (
          /* plan mode: today's plan lives here, where the example chips used to be */
          <DayPlan />
        )
      )}
    </Box>
  );
}
