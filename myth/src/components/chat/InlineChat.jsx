// The Myth AI box under the home bar: a white card with the bot, the chat
// actions and the conversation. It appears once something has been asked and
// closes back to nothing — the bar above owns the input and the sending, and
// today's plan lives under the bar on its own.
import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Loader, Text, Tooltip } from '@mantine/core';
import { IconPlus, IconHistory, IconArrowsDiagonal, IconX, IconTrash } from '@tabler/icons-react';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import { useStore } from '../../store/useStore';
import MythBot from '../MythBot';
import ChatMessage from './ChatMessage';
import './inlineChat.css';

export default function InlineChat({ thinking = false, onExpand, onClose, onAsk, hints = [] }) {
  const chat = useStore((s) => s.chat);
  const chatHistory = useStore((s) => s.chatHistory);
  const startNewChat = useStore((s) => s.startNewChat);
  const loadChatSession = useStore((s) => s.loadChatSession);
  const deleteChatSession = useStore((s) => s.deleteChatSession);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef(null);

  // a new message always brings the conversation back
  useEffect(() => { setShowHistory(false); }, [chat.length]);

  // keep the newest message in view without scrolling the page itself
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, thinking, showHistory]);

  const sub = thinking ? 'Thinking…'
    : showHistory ? 'Past chats — kept for 3 days'
      : chat.length ? `${chat.length} message${chat.length === 1 ? '' : 's'} · ask on, or drop a file in`
        : 'Ask anything — I answer, and I act';
  const sessionLabel = (h) => h.messages.find((m) => m.role === 'user')?.text ?? 'Conversation';

  return (
    <motion.section
      className={`aibox is-open${thinking ? ' is-thinking' : ''}`} aria-label="Myth AI"
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="aibox-head">
        <div className="aibox-title">
          <MythBot size={30} active mood={thinking ? 'thinking' : 'idle'} />
          <span><b>Myth AI</b><small>{sub}</small></span>
        </div>
        <div className="aibox-actions">
          <Tooltip label="New chat (this one is kept in history for 3 days)">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => { startNewChat(); setShowHistory(false); }} aria-label="New chat">
              <IconPlus size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="History — old chats auto-delete after 3 days">
            <ActionIcon
              size="sm" variant={showHistory ? 'light' : 'subtle'} color={showHistory ? 'forest' : 'gray'} aria-label="Chat history"
              onClick={() => setShowHistory((v) => !v)}
            >
              <IconHistory size={14} />
            </ActionIcon>
          </Tooltip>
          {onExpand && (
            <Tooltip label="Open full chat">
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={onExpand} aria-label="Open full chat"><IconArrowsDiagonal size={14} /></ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Close — the chat stays in history">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={onClose} aria-label="Close">
              <IconX size={15} />
            </ActionIcon>
          </Tooltip>
        </div>
      </header>

      <div className="aibox-body">
        {showHistory ? (
              <div className="scroll-y aibox-messages">
                {chatHistory.length === 0 ? (
                  <Text fz={12.5} c="dimmed" ta="center" py={16}>No past chats — history keeps conversations for 3 days, then clears itself.</Text>
                ) : (
                  <div className="aibox-history">
                    {chatHistory.map((h) => (
                      <div
                        key={h.id} className="aibox-history-row" role="button" tabIndex={0}
                        onClick={() => { loadChatSession(h.id); setShowHistory(false); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { loadChatSession(h.id); setShowHistory(false); } }}
                      >
                        <IconHistory size={13} color="#1b5a38" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text fz={12.5} fw={600} c="#16281f" truncate>{sessionLabel(h)}</Text>
                          <Text fz={10.5} c="dimmed">{dayjs(h.ts).format('ddd, MMM D · h:mm A')} · {h.messages.length} messages</Text>
                        </div>
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Delete chat" onClick={(e) => { e.stopPropagation(); deleteChatSession(h.id); }}>
                          <IconTrash size={12} />
                        </ActionIcon>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div ref={scrollRef} className="scroll-y aibox-messages">
                {chat.length === 0 && !thinking && (
                  <div className="aibox-empty">
                    <p>Fresh chat, Boss. Ask me anything, drop a file in and say where it goes, or try one of these:</p>
                    <div className="aibox-chips">
                      {hints.map((h) => <button key={h} type="button" className="aibox-chip" onClick={() => onAsk?.(h)}>{h}</button>)}
                    </div>
                  </div>
                )}
                <div className="aibox-thread">
                  {chat.slice(-14).map((m) => (
                    <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                      <ChatMessage m={m} fz={13} />
                    </motion.div>
                  ))}
                  {thinking && (
                    <div className="aibox-thinking"><Loader size="xs" color="forest" type="dots" /> Myth is thinking…</div>
                  )}
                </div>
              </div>
            )}
      </div>
    </motion.section>
  );
}
