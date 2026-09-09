// Small animated spot illustrations for empty states: a floating card with a
// glyph and a couple of orbiting dots. Same family as the hero landscape.
import { motion } from 'framer-motion';

const GLYPHS = {
  tasks: (c) => (<g stroke={c} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M44 62 l10 10 l22 -24" /></g>),
  projects: (c) => (<g fill={c}><path d="M36 46 h16 l6 6 h26 a4 4 0 0 1 4 4 v22 a4 4 0 0 1 -4 4 H36 a4 4 0 0 1 -4 -4 V50 a4 4 0 0 1 4 -4 Z" /><rect x="32" y="60" width="56" height="22" rx="4" fill="#fff" opacity="0.35" /></g>),
  notes: (c) => (<g stroke={c} strokeWidth="4" strokeLinecap="round"><path d="M42 52 h36" /><path d="M42 64 h36" /><path d="M42 76 h22" /></g>),
  habits: (c) => (<g fill={c}><path d="M60 40 c12 12 18 20 18 30 a18 18 0 0 1 -36 0 c0 -8 4 -12 8 -16 c0 6 3 9 6 9 c-2 -8 0 -16 4 -23 Z" /></g>),
  journal: (c) => (<g stroke={c} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M40 78 l6 -20 l26 -26 l14 14 l-26 26 z" /><path d="M66 38 l14 14" /></g>),
  calendar: (c) => (<g stroke={c} strokeWidth="4" fill="none" strokeLinecap="round"><rect x="36" y="44" width="48" height="40" rx="6" /><path d="M36 58 h48" /><path d="M48 38 v10 M72 38 v10" /></g>),
  generic: (c) => (<g fill={c}><path d="M60 36 l6 16 l16 6 l-16 6 l-6 16 l-6 -16 l-16 -6 l16 -6 z" /></g>),
};

export default function Spot({ kind = 'generic', color = '#0D2D1C', size = 120 }) {
  const glyph = GLYPHS[kind] ?? GLYPHS.generic;
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 120 108" aria-hidden="true">
      <defs>
        <linearGradient id={`sp-${kind}`} x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#eef4f0" /></linearGradient>
      </defs>
      <ellipse cx="60" cy="98" rx="34" ry="5" fill="#0f1f17" opacity="0.08" />
      <motion.g animate={{ y: [0, -6, 0], rotate: [-1.5, 1.5, -1.5] }} transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }} style={{ transformOrigin: '60px 60px' }}>
        <rect x="26" y="26" width="68" height="64" rx="16" fill={`url(#sp-${kind})`} stroke="#e3ebe6" />
        <rect x="26" y="26" width="68" height="14" rx="8" fill={color} opacity="0.14" />
        {glyph(color)}
      </motion.g>
      <motion.circle cx="22" cy="40" r="5" fill={color} opacity="0.55" animate={{ y: [0, -8, 0] }} transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.circle cx="100" cy="30" r="3.5" fill="#f6b12b" opacity="0.9" animate={{ y: [0, 7, 0] }} transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }} />
      <motion.circle cx="104" cy="70" r="2.5" fill={color} opacity="0.5" animate={{ y: [0, -5, 0] }} transition={{ duration: 2.9, repeat: Infinity, ease: 'easeInOut', delay: 1.1 }} />
    </svg>
  );
}
