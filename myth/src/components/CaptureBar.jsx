// The home bar ("deck"): one input with a small Myth AI / Planner switch inside it.
//   Myth AI  — ask anything, capture anything, hand it files. Today's plan sits
//              under the bar; the Myth AI box (chat/InlineChat.jsx) appears only
//              once something has been asked, and closes back to just the plan.
//   Planner  — describe a trip, exam, goal or launch in a sentence (or use the
//              composer under the bar); the plan opens inline under it.
// "/plan …" or "/chat …" switches tab and sends in one go; Ctrl + . cycles tabs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { Box, TextInput, ActionIcon, Text, Tooltip } from '@mantine/core';
import { IconMicrophone, IconMicrophoneFilled, IconSend, IconSparkles, IconCompass } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { askAssistant } from '../ai/assistant';
import { detectMode } from '../ai/planner';
import { startPlannerSession, conversePlanner } from '../ai/plannerSession';
import { useChatFiles } from './chat/useChatFiles';
import { AttachButton, FileTray } from './chat/FileTray';
import InlineChat from './chat/InlineChat';
import DayPlan from './DayPlan';
import PlanComposer from './planner/PlanComposer';
import './deck.css';

const TABS = [
  { key: 'chat', label: 'Myth AI', hint: 'Ask, capture, create — anything', icon: IconSparkles, a: '#0D2D1C', b: '#1f7a4d', ink: '#ffffff' },
  { key: 'planner', label: 'Planner', hint: 'Trips, exams, goals, launches', icon: IconCompass, a: '#f9c04a', b: '#ee9d10', ink: '#1a1408' },
];

const CHAT_HINTS = [
  'What should I do now?',
  'Add task: pay rent on the 1st',
  'Meeting with Ravi tomorrow 10am',
  'Spent 250 on lunch',
  'Make a cheat sheet on SQL joins and add it to learning',
  "What's overdue?",
];

// "/plan trip to Goa" → planner tab + send; "/chat …" or "/ai …" → Myth AI tab + send
const SLASH = /^\/(chat|ai|bot|plan(?:ner)?|trip)\b\s*/i;
const slashMode = (word) => (/^(plan|planner|trip)$/i.test(word) ? 'planner' : 'chat');

function DeckTabs({ value, onChange, compact = false, thinking = false, plans = 0 }) {
  const active = Math.max(0, TABS.findIndex((t) => t.key === value));

  // Ctrl/Cmd + . cycles the tabs
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        onChange(TABS[(active + 1) % TABS.length].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onChange]);

  return (
    <div className="deck-switch" role="tablist" aria-label="Home bar mode">
      {TABS.map((t, i) => {
        const on = i === active;
        const Icon = t.icon;
        return (
          <Tooltip key={t.key} label={`${t.label} — ${t.hint}${compact ? '' : ' · Ctrl + .'}`} openDelay={400}>
            <button
              type="button" role="tab" aria-selected={on} aria-label={t.label} className="deck-tab" data-active={on || undefined}
              style={{ '--a': t.a, '--b': t.b, '--ink': t.ink }} onClick={() => onChange(t.key)}
            >
              {on && <motion.span layoutId="deck-tab-fill" className="deck-tab-fill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <span className={`deck-tab-icon${on && thinking && t.key === 'chat' ? ' is-thinking' : ''}`}>
                <Icon size={14} stroke={2.4} />
              </span>
              {!compact && <span className="deck-tab-text">{t.label}</span>}
              {t.key === 'chat' && thinking && <span className="deck-tab-dot" aria-label="Myth is thinking" />}
              {t.key === 'planner' && plans > 0 && <span className="deck-tab-count" title={`${plans} plan${plans === 1 ? '' : 's'}`}>{plans}</span>}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export default function CaptureBar({ mode = 'chat', onMode, onExpand, onChatOpen }) {
  const [value, setValue] = useState('');
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState(null); // the planner's one-line reply when nothing could be planned
  const [open, setOpen] = useState(false); // the Myth AI box shows the conversation
  const recRef = useRef(null);
  const files = useChatFiles();

  const pushChat = useStore((s) => s.pushChat);
  const updateChat = useStore((s) => s.updateChat);
  const startNewChat = useStore((s) => s.startNewChat);
  const sessions = useStore((s) => s.plannerSessions ?? []);
  const focusId = useUI((s) => s.plannerFocusId);
  const setFocus = useUI((s) => s.setPlannerFocus);
  const focused = useMemo(() => sessions.find((s) => s.id === focusId) ?? null, [sessions, focusId]);

  const chatMode = mode === 'chat';
  const planMode = mode === 'planner';
  const tab = TABS.find((t) => t.key === mode) ?? TABS[0];
  // phones: smaller controls, shorter placeholders — the text field keeps its room
  const mobile = useMediaQuery('(max-width: 768px)');

  // let the shell know the conversation is taking over the page
  useEffect(() => { onChatOpen?.(open && chatMode); }, [open, chatMode, onChatOpen]);

  // Myth AI always opens fresh — the previous talk moves into history (kept 3 days)
  const switchMode = (next) => {
    if (next === mode) return;
    if (next === 'chat') startNewChat();
    if (mode === 'chat') setOpen(false);
    onMode?.(next);
  };

  const ask = async (q, attached = []) => {
    if (thinking) return;
    setOpen(true);
    pushChat({ role: 'user', text: q || `Here ${attached.length === 1 ? 'is a file' : 'are some files'}.`, files: attached });
    setThinking(true);
    let aiId = null; // created on the first streamed token
    const onToken = (textSoFar) => {
      if (!textSoFar) return;
      if (aiId) updateChat(aiId, { text: textSoFar });
      else aiId = pushChat({ role: 'ai', text: textSoFar });
    };
    try {
      const answer = await askAssistant(q || 'I attached a file. Tell me what it is about in two lines and what you could do with it.', useStore, onToken, { files: attached });
      if (aiId) updateChat(aiId, { text: answer });
      else pushChat({ role: 'ai', text: answer });
    } catch (e) {
      pushChat({ role: 'ai', text: `Something went wrong, Boss: ${e.message}` });
    } finally {
      setThinking(false);
    }
  };

  // Planner tab: a follow-up refines the plan on screen; a new kind of plan
  // (or "new plan") starts another session
  const plan = (text) => {
    const { mode: detected } = detectMode(text);
    const wantsNew = /\b(?:new|another|fresh)\s+(?:plan|trip|session)\b/i.test(text);
    const tripSentence = detected === 'trip' && /\bfrom\b[\s\S]*\bto\b|\btrip\s+to\b|\bweekend\s+in\b/i.test(text);
    if (focused && !wantsNew && (!detected || (detected === focused.mode && !tripSentence))) {
      const { reset } = conversePlanner(focused, text, useStore);
      if (reset) setFocus(null);
      return;
    }
    const { session, reply } = startPlannerSession(text, useStore);
    if (session) { setFocus(session.id); return; }
    setNotice(reply);
    setTimeout(() => setNotice(null), 5000);
  };

  const submit = (text) => {
    let t = (text ?? value).trim();
    if (thinking || files.busy) return;

    const slash = t.match(SLASH);
    if (slash) {
      const next = slashMode(slash[1]);
      switchMode(next);
      t = t.replace(SLASH, '').trim();
      setValue('');
      if (!t) return;
      if (next === 'planner') { plan(t); return; }
      ask(t, files.take());
      return;
    }

    // files alone are a message too ("here is a file")
    if (!t && !(chatMode && files.pending.length)) return;
    setValue('');
    if (planMode) { plan(t); return; }
    ask(t, files.take());
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

  const placeholder = listening ? 'Listening… speak now'
    : chatMode
      ? (files.pending.length ? 'What should I do with it? e.g. "add this to learning"'
        : mobile ? 'Ask Myth anything…' : 'Ask me anything, or tell me what to add where…')
      : focused
        ? (focused.mode === 'trip'
          ? 'Change the plan… ("budget 40k", "make it 3 people", "start trip")'
          : 'Change the plan… ("move it to March", "go live", "new plan")')
        : mobile ? 'Plan a trip, event, exam, diet…' : 'Plan anything — "Chennai to Goa 20–24 Dec for 2", "GATE exam in Feb", "save 1 lakh by March"…';

  return (
    <div className={`deck${planMode ? ' is-wide' : ''}`} style={{ '--a': tab.a, '--b': tab.b }}>
      <div className="deck-bar">
        <DeckTabs value={mode} onChange={switchMode} compact={mobile} thinking={thinking} plans={sessions.length} />
        <TextInput
          className="capture-input"
          variant="unstyled"
          size={mobile ? 'md' : 'lg'}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          onPaste={(e) => {
            if (!chatMode) return;
            const pasted = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
            if (pasted.length) { e.preventDefault(); files.ingest(pasted); }
          }}
        />
        {chatMode && <AttachButton onFiles={files.ingest} size={mobile ? 34 : 40} />}
        <Tooltip label={listening ? 'Stop listening' : chatMode ? 'Speak — ask Myth, or tell it what to add' : 'Speak — describe the plan'}>
          <ActionIcon
            size={mobile ? 40 : 50} radius="xl"
            variant={listening ? 'filled' : 'light'} color={listening ? 'red' : 'forest'}
            className={listening ? 'pulse-soft' : ''} onClick={toggleVoice} aria-label="Speak"
          >
            {listening ? <IconMicrophoneFilled size={20} /> : <IconMicrophone size={20} />}
          </ActionIcon>
        </Tooltip>
        <ActionIcon
          size={mobile ? 40 : 50} radius="xl" variant="gradient" gradient={{ from: tab.a, to: tab.b }}
          loading={thinking || files.busy} onClick={() => submit()} aria-label={planMode ? 'Plan it' : 'Send'}
        >
          {planMode ? <IconCompass size={20} color={tab.ink} /> : <IconSend size={19} />}
        </ActionIcon>
      </div>

      {chatMode && <FileTray pending={files.pending} onRemove={files.remove} />}
      {/* today's plan sits right under the bar; the conversation appears only once something is asked */}
      {chatMode && <div className="plan-card"><DayPlan /></div>}
      {chatMode && open && (
        <InlineChat thinking={thinking} onExpand={onExpand} onClose={() => setOpen(false)} onAsk={(q) => submit(q)} hints={CHAT_HINTS} />
      )}

      <AnimatePresence>
        {planMode && notice && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
            <Box className="glass" px={18} py={10} style={{ borderRadius: 18, display: 'inline-block', maxWidth: '100%' }}>
              <Text fz={13.5} fw={600} c="#0f5132">{notice}</Text>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Planner tab with nothing on screen yet: the composer and examples are the empty state */}
      {planMode && !notice && !focused && <PlanComposer onStart={(s) => setFocus(s.id)} />}
    </div>
  );
}
