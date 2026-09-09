// MythBot — the animated 3D-style mascot used wherever the AI is addressed
// (capture-bar chat toggle, inline chat header, assistant drawer).
//
// Pure SVG + CSS: a glossy rounded head with a dark screen, glowing eyes that
// blink, an antenna that bobs, a waving arm, a status bar on the chest and a
// ground shadow that shrinks as it floats. The whole rig lives in a perspective
// box and tilts toward the pointer, so it reads as a small 3D object rather
// than a flat icon. `active` (chat mode on) wakes it up: brighter eyes, screen
// glow, a livelier bounce.
import { useRef } from 'react';
import './mythBot.css';

let idSeq = 0;

export default function MythBot({ size = 26, active = false, mood = 'idle', className = '', style }) {
  const rigRef = useRef(null);
  const uid = useRef(`mb${++idSeq}`).current;

  // pointer-follow tilt ("4D"): the rig leans toward the cursor and springs back
  const onMove = (e) => {
    const el = rigRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    el.style.setProperty('--tilt-y', `${Math.max(-1, Math.min(1, dx)) * 22}deg`);
    el.style.setProperty('--tilt-x', `${Math.max(-1, Math.min(1, -dy)) * 14}deg`);
  };
  const onLeave = () => {
    const el = rigRef.current;
    if (!el) return;
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--tilt-x', '0deg');
  };

  return (
    <span
      className={`mythbot ${active ? 'is-active' : ''} mood-${mood} ${className}`}
      style={{ width: size, height: size, ...style }}
      onMouseMove={onMove} onMouseLeave={onLeave}
      aria-hidden="true"
    >
      <span className="mythbot-rig" ref={rigRef}>
        <svg viewBox="4 0 56 72" width={size} height={size} className="mythbot-svg">
          <defs>
            <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.55" stopColor="#e9eef1" />
              <stop offset="1" stopColor="#b9c4cc" />
            </linearGradient>
            <linearGradient id={`${uid}-screen`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2a3540" />
              <stop offset="1" stopColor="#0e151c" />
            </linearGradient>
            <radialGradient id={`${uid}-gloss`} cx="0.3" cy="0.2" r="0.8">
              <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-eye`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.6" stopColor="#bff4ff" />
              <stop offset="1" stopColor="#5fd4ff" stopOpacity="0.4" />
            </radialGradient>
            <linearGradient id={`${uid}-ball`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffe066" />
              <stop offset="1" stopColor="#f59f00" />
            </linearGradient>
          </defs>

          {/* ground shadow */}
          <ellipse className="mythbot-shadow" cx="32" cy="69" rx="14" ry="2.6" fill="#000" opacity="0.22" />

          {/* legs */}
          <g className="mythbot-legs">
            <rect x="22" y="54" width="7" height="10" rx="3" fill="#6b7883" />
            <rect x="35" y="54" width="7" height="10" rx="3" fill="#6b7883" />
            <rect x="20" y="61" width="11" height="5" rx="2.5" fill="#4d5963" />
            <rect x="33" y="61" width="11" height="5" rx="2.5" fill="#4d5963" />
          </g>

          {/* arms */}
          <g className="mythbot-arm mythbot-arm-l">
            <rect x="8" y="40" width="7" height="14" rx="3.5" fill={`url(#${uid}-body)`} stroke="#8d9aa5" strokeWidth="1" />
            <circle cx="11.5" cy="55" r="3.2" fill="#6b7883" />
          </g>
          <g className="mythbot-arm mythbot-arm-r">
            <rect x="49" y="40" width="7" height="14" rx="3.5" fill={`url(#${uid}-body)`} stroke="#8d9aa5" strokeWidth="1" />
            <circle cx="52.5" cy="55" r="3.2" fill="#6b7883" />
          </g>

          {/* body */}
          <g className="mythbot-body">
            <rect x="15" y="38" width="34" height="19" rx="7" fill={`url(#${uid}-body)`} stroke="#8d9aa5" strokeWidth="1" />
            <rect className="mythbot-status" x="22" y="46" width="14" height="3" rx="1.5" fill="#12a150" />
            <rect x="38" y="46" width="4" height="3" rx="1.5" fill="#6b7883" />
          </g>

          {/* antenna */}
          <g className="mythbot-antenna">
            <rect x="30.5" y="4" width="3" height="9" rx="1.5" fill="#6b7883" />
            <circle className="mythbot-ball" cx="32" cy="4" r="4" fill={`url(#${uid}-ball)`} stroke="#c77d00" strokeWidth="0.8" />
          </g>

          {/* head */}
          <g className="mythbot-head">
            <rect x="9" y="11" width="46" height="30" rx="10" fill={`url(#${uid}-body)`} stroke="#8d9aa5" strokeWidth="1" />
            {/* ears */}
            <rect x="5" y="21" width="5" height="10" rx="2.5" fill="#6b7883" />
            <rect x="54" y="21" width="5" height="10" rx="2.5" fill="#6b7883" />
            {/* screen */}
            <rect className="mythbot-screen" x="15" y="16" width="34" height="20" rx="6" fill={`url(#${uid}-screen)`} />
            {/* eyes */}
            <g className="mythbot-eyes">
              <ellipse className="mythbot-eye" cx="25" cy="25" rx="3.4" ry="4" fill={`url(#${uid}-eye)`} />
              <ellipse className="mythbot-eye" cx="39" cy="25" rx="3.4" ry="4" fill={`url(#${uid}-eye)`} />
            </g>
            {/* smile */}
            <path className="mythbot-smile" d="M28 31 Q32 34 36 31" fill="none" stroke="#9cf0ff" strokeWidth="1.6" strokeLinecap="round" />
            {/* cheeks */}
            <circle cx="20" cy="30" r="1.6" fill="#ff8787" opacity="0.7" />
            <circle cx="44" cy="30" r="1.6" fill="#ff8787" opacity="0.7" />
            {/* gloss */}
            <rect x="9" y="11" width="46" height="30" rx="10" fill={`url(#${uid}-gloss)`} />
          </g>
        </svg>
      </span>
    </span>
  );
}
