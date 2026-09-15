// One chat bubble: light Markdown (bold, bullets), the files attached to the
// message (tap to download) and the ✅ / ⚠️ lines from actions Myth ran.
import { Box, Text, Group } from '@mantine/core';
import { IconPaperclip, IconFileTypePdf, IconPhoto, IconFileText, IconDownload } from '@tabler/icons-react';
import { downloadBlob } from '../../store/fileStore';

const fileIcon = (f) => (/pdf/.test(f.type ?? '') ? IconFileTypePdf : /^image\//.test(f.type ?? '') ? IconPhoto : /^text\/|json|csv|markdown/.test(f.type ?? '') ? IconFileText : IconPaperclip);

// **bold** and `code` inside a line
function inline(s) {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (/^\*\*.*\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>;
    if (/^`.*`$/.test(p)) return <code key={i} style={{ fontSize: '0.92em', background: 'rgba(0,0,0,0.06)', borderRadius: 4, padding: '0 4px' }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

export function FileChip({ f, light = false, onRemove }) {
  const Icon = fileIcon(f);
  return (
    <Group
      gap={5} wrap="nowrap" px={8} py={4}
      style={{ borderRadius: 999, background: light ? 'rgba(255,255,255,0.18)' : 'rgba(13,45,28,0.08)', border: light ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(13,45,28,0.12)', cursor: 'pointer', maxWidth: 240 }}
      onClick={() => downloadBlob(f.id, f.name)} title={`${f.name} · ${Math.round((f.size ?? 0) / 1024)} KB — click to download`}
    >
      <Icon size={13} style={{ flexShrink: 0 }} />
      <Text fz={11.5} fw={600} truncate style={{ flex: 1 }}>{f.name}</Text>
      {f.busy ? <Text fz={10} c={light ? '#fff' : 'dimmed'}>reading…</Text> : onRemove ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(f.id); }} aria-label="Remove" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', lineHeight: 1, fontSize: 13 }}>×</button>
      ) : <IconDownload size={11} style={{ opacity: 0.6, flexShrink: 0 }} />}
    </Group>
  );
}

export default function ChatMessage({ m, fz = 13.5 }) {
  const user = m.role === 'user';
  const lines = String(m.text ?? '').split('\n');
  return (
    <Box
      py={8} px={12} maw="88%"
      style={{
        borderRadius: 16, marginLeft: user ? 'auto' : 0, width: 'fit-content',
        background: user ? 'linear-gradient(135deg,#0D2D1C,#1b5a38)' : 'rgba(255,255,255,0.85)',
        color: user ? '#fff' : '#16281f', border: '1px solid rgba(255,255,255,0.6)',
      }}
    >
      {lines.map((l, i) => {
        if (/^\s*(?:✅|⚠️)/.test(l)) {
          const ok = l.trim().startsWith('✅');
          return (
            <Text key={i} fz={fz - 1} fw={600} lh={1.45} mt={i ? 4 : 0} c={ok ? '#0f5132' : '#c2410c'} style={{ background: ok ? 'rgba(61,220,132,0.14)' : 'rgba(240,140,0,0.14)', borderRadius: 8, padding: '3px 8px' }}>
              {inline(l.trim())}
            </Text>
          );
        }
        const bullet = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        const head = l.match(/^#{1,3}\s+(.*)$/);
        if (head) return <Text key={i} fz={fz + 0.5} fw={800} lh={1.5} mt={i ? 6 : 0}>{inline(head[1])}</Text>;
        if (bullet) return <Text key={i} fz={fz} lh={1.5} pl={12} style={{ textIndent: -10 }}>• {inline(bullet[1])}</Text>;
        if (!l.trim()) return <div key={i} style={{ height: 6 }} />;
        return <Text key={i} fz={fz} lh={1.5}>{inline(l)}</Text>;
      })}
      {m.files?.length > 0 && (
        <Group gap={6} mt={6}>
          {m.files.map((f) => <FileChip key={f.id} f={f} light={user} />)}
        </Group>
      )}
    </Box>
  );
}
