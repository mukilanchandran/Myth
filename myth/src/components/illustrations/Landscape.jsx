// An animated landscape for the hero: layered mountains, pines, drifting
// clouds, bobbing orbs and a sun or moon depending on the hour. Pure SVG +
// framer-motion transforms (GPU-cheap), with a light parallax on mouse move.
import { useMemo } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

const PALETTES = {
  day: { sky1: 'rgba(255,255,255,0.06)', sun: '#f9c04a', glow: 'rgba(249,192,74,0.28)', back: '#254b39', mid: '#2f6a4d', front: '#3f8c63', ground: '#4c9a6b', tree: '#1f5a3f', treeLight: '#2f7a53', mist: 'rgba(255,255,255,0.35)', orb: '#bfe8cf' },
  night: { sky1: 'rgba(255,255,255,0.03)', sun: '#e8eef2', glow: 'rgba(232,238,242,0.18)', back: '#17352a', mid: '#1f4a38', front: '#2a6248', ground: '#2f6e50', tree: '#143d2c', treeLight: '#1e5a40', mist: 'rgba(255,255,255,0.2)', orb: '#9bc7b0' },
};

const Tree = ({ x, y, s = 1, c1, c2 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="-2" y="18" width="4" height="10" rx="1" fill="#3b2a1d" />
    <path d="M0 -26 L14 0 H-14 Z" fill={c1} />
    <path d="M0 -16 L17 12 H-17 Z" fill={c2} />
    <path d="M0 -4 L20 22 H-20 Z" fill={c1} />
  </g>
);

const drift = (dur, from, to) => ({ x: [from, to, from], transition: { duration: dur, repeat: Infinity, ease: 'easeInOut' } });
const bob = (dur, amp, delay = 0) => ({ y: [0, -amp, 0], transition: { duration: dur, repeat: Infinity, ease: 'easeInOut', delay } });

export default function Landscape({ hour = 12 }) {
  const p = hour >= 19 || hour < 6 ? PALETTES.night : PALETTES.day;
  const night = p === PALETTES.night;
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 18 });
  const sy = useSpring(my, { stiffness: 60, damping: 18 });
  const back = { x: useTransform(sx, (v) => v * 6), y: useTransform(sy, (v) => v * 3) };
  const mid = { x: useTransform(sx, (v) => v * 12), y: useTransform(sy, (v) => v * 6) };
  const front = { x: useTransform(sx, (v) => v * 20), y: useTransform(sy, (v) => v * 9) };
  const stars = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ x: 20 + ((i * 97) % 440), y: 14 + ((i * 53) % 110), r: 0.8 + (i % 3) * 0.5 })), []);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width - 0.5) * -1);
    my.set(((e.clientY - r.top) / r.height - 0.5) * -1);
  };

  return (
    <div onMouseMove={onMove} onMouseLeave={() => { mx.set(0); my.set(0); }} style={{ width: '100%', height: '100%' }}>
      <svg viewBox="0 0 480 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <radialGradient id="lsGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor={p.glow} /><stop offset="100%" stopColor="transparent" /></radialGradient>
          <linearGradient id="lsMist" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="transparent" /><stop offset="100%" stopColor={p.mist} /></linearGradient>
          <filter id="lsBlur"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <rect width="480" height="320" fill={p.sky1} />
        {night && stars.map((s, i) => <motion.circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2 + (i % 4), repeat: Infinity, delay: i * 0.2 }} />)}

        {/* sun / moon */}
        <motion.g style={back} animate={bob(9, 4)}>
          <circle cx="372" cy="78" r="70" fill="url(#lsGlow)" />
          <circle cx="372" cy="78" r="26" fill={p.sun} />
          {night && <circle cx="384" cy="70" r="22" fill="#0f1f17" opacity="0.9" />}
        </motion.g>

        {/* clouds */}
        <motion.g animate={drift(26, -12, 18)} opacity="0.85">
          <g fill="#f4f8f5">
            <ellipse cx="120" cy="86" rx="34" ry="12" /><ellipse cx="102" cy="80" rx="18" ry="12" /><ellipse cx="138" cy="78" rx="20" ry="13" />
          </g>
        </motion.g>
        <motion.g animate={drift(34, 14, -16)} opacity="0.7">
          <g fill="#f4f8f5">
            <ellipse cx="300" cy="126" rx="28" ry="9" /><ellipse cx="288" cy="120" rx="14" ry="9" /><ellipse cx="312" cy="119" rx="16" ry="10" />
          </g>
        </motion.g>

        {/* floating orbs */}
        <motion.circle cx="66" cy="150" r="9" fill={p.orb} opacity="0.9" animate={bob(5, 10)} />
        <motion.circle cx="430" cy="160" r="6" fill={p.orb} opacity="0.8" animate={bob(6.5, 12, 0.8)} />
        <motion.circle cx="250" cy="60" r="4" fill={p.orb} opacity="0.7" animate={bob(4.5, 8, 1.4)} />

        {/* mountains */}
        <motion.g style={back}>
          <path d="M-20 250 L70 140 L120 190 L170 120 L230 210 L290 150 L350 215 L400 160 L500 250 Z" fill={p.back} />
          <path d="M148 150 L170 120 L192 152 L178 146 L166 158 Z" fill="#dfe9e3" opacity="0.85" />
        </motion.g>
        <motion.g style={mid}>
          <path d="M-20 280 L40 210 L100 245 L160 190 L230 258 L300 205 L370 262 L440 215 L500 280 Z" fill={p.mid} />
          <path d="M148 197 L160 190 L174 202 L162 198 L154 208 Z" fill="#e9f1ec" opacity="0.7" />
        </motion.g>
        <motion.rect x="0" y="180" width="480" height="90" fill="url(#lsMist)" animate={{ opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />

        {/* front hills, trees, camp */}
        <motion.g style={front}>
          <path d="M-20 320 L-20 282 Q80 240 180 275 T380 262 T500 290 L500 320 Z" fill={p.front} />
          <path d="M-20 320 L-20 300 Q120 268 240 300 T500 296 L500 320 Z" fill={p.ground} />
          <Tree x={60} y={268} s={1.1} c1={p.tree} c2={p.treeLight} />
          <Tree x={96} y={276} s={0.8} c1={p.tree} c2={p.treeLight} />
          <Tree x={150} y={266} s={1.25} c1={p.tree} c2={p.treeLight} />
          <Tree x={205} y={280} s={0.9} c1={p.tree} c2={p.treeLight} />
          <Tree x={330} y={270} s={1.1} c1={p.tree} c2={p.treeLight} />
          <Tree x={372} y={278} s={0.85} c1={p.tree} c2={p.treeLight} />
          <Tree x={430} y={266} s={1.2} c1={p.tree} c2={p.treeLight} />
          {/* a tent and a lantern */}
          <path d="M250 292 L272 258 L294 292 Z" fill="#f3f6f4" />
          <path d="M272 258 L294 292 L280 292 Z" fill="#d9e2dc" />
          <path d="M266 292 L272 278 L278 292 Z" fill="#1a1408" opacity="0.6" />
          <motion.g animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 2.2, repeat: Infinity }}>
            <circle cx="310" cy="284" r="9" fill="url(#lsGlow)" />
            <rect x="307" y="278" width="6" height="9" rx="2" fill="#f9c04a" />
          </motion.g>
          <ellipse cx="240" cy="306" rx="150" ry="6" fill="#000" opacity="0.12" filter="url(#lsBlur)" />
        </motion.g>
      </svg>
    </div>
  );
}
