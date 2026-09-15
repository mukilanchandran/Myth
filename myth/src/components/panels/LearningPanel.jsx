// Learning pipeline: want to learn → learning → applied → taught. Each item
// can carry notes, files (a PDF you handed the assistant, a study sheet Myth
// wrote) and links — everything you need to learn it lives on the card.
import { useState } from 'react';
import { Stack, Group, Text, Box, TextInput, Button, ActionIcon, SimpleGrid, Tooltip, Textarea, Anchor } from '@mantine/core';
import { IconArrowLeft, IconArrowRight, IconX, IconPlus, IconPaperclip, IconNotes, IconLink, IconFileTypePdf, IconFileText, IconPhoto, IconDownload, IconSparkles } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, uid } from '../../store/useStore';
import { useUI } from '../../store/useUI';
import { putBlob, deleteBlob, downloadBlob } from '../../store/fileStore';

const STAGES = ['Want to learn', 'Learning', 'Applied', 'Taught / Shared'];
const STAGE_COLORS = ['#8a9691', '#1971c2', '#0D2D1C', '#7048e8'];
const fileIcon = (f) => (/pdf/.test(f.type ?? '') ? IconFileTypePdf : /^image\//.test(f.type ?? '') ? IconPhoto : IconFileText);

function LearningCard({ l, si, files }) {
  const { moveLearning, deleteLearning, updateLearning, attachToLearning, addFileMeta, deleteFileMeta } = useStore();
  const openAssistant = useUI((s) => s.openAssistant);
  const [notes, setNotes] = useState(null); // null = closed, string = editing
  const [link, setLink] = useState(null);
  const mine = (l.fileIds ?? []).map((id) => files.find((f) => f.id === id)).filter(Boolean);

  const attach = async (list) => {
    for (const file of Array.from(list ?? [])) {
      const id = uid();
      await putBlob(id, file);
      addFileMeta({ id, name: file.name, size: file.size, type: file.type, projectId: null, learningId: l.id, source: 'learning', title: file.name.replace(/\.[a-z0-9]+$/i, '') });
      attachToLearning(l.id, id);
    }
  };
  const removeFile = (f) => { deleteBlob(f.id).catch(() => {}); deleteFileMeta(f.id); };

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.18 }}>
      <Box p={10} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5ebe7' }}>
        <Text fz={13.5} fw={600} lh={1.35}>{l.title}</Text>
        {l.notes && notes === null && <Text fz={12} c="dimmed" lh={1.4} mt={4} lineClamp={3} style={{ whiteSpace: 'pre-line' }}>{l.notes}</Text>}
        {notes !== null && (
          <Stack gap={4} mt={6}>
            <Textarea autosize minRows={2} maxRows={8} size="xs" radius="md" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} placeholder="What to remember, where you are, what's next…" data-autofocus />
            <Group gap={4} justify="flex-end">
              <Button size="compact-xs" variant="subtle" color="gray" radius="xl" onClick={() => setNotes(null)}>Cancel</Button>
              <Button size="compact-xs" color="forest" radius="xl" onClick={() => { updateLearning(l.id, { notes: notes.trim() }); setNotes(null); }}>Save</Button>
            </Group>
          </Stack>
        )}
        {(mine.length > 0 || (l.links ?? []).length > 0) && (
          <Group gap={5} mt={6}>
            {mine.map((f) => {
              const Icon = fileIcon(f);
              return (
                <Group key={f.id} gap={4} wrap="nowrap" px={7} py={3} style={{ borderRadius: 999, background: 'rgba(13,45,28,0.07)', border: '1px solid rgba(13,45,28,0.1)', maxWidth: 200 }}>
                  <Icon size={12} style={{ flexShrink: 0 }} />
                  <Text fz={11} fw={600} truncate style={{ cursor: 'pointer', flex: 1 }} onClick={() => downloadBlob(f.id, f.name)} title="Download">{f.title || f.name}</Text>
                  <IconDownload size={10} style={{ opacity: 0.6, cursor: 'pointer', flexShrink: 0 }} onClick={() => downloadBlob(f.id, f.name)} />
                  <button type="button" onClick={() => removeFile(f)} aria-label="Remove file" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', lineHeight: 1, fontSize: 12, color: '#6f7f76' }}>×</button>
                </Group>
              );
            })}
            {(l.links ?? []).map((k, i) => (
              <Anchor key={i} href={k.url} target="_blank" rel="noreferrer" fz={11} fw={600} px={7} py={3} style={{ borderRadius: 999, background: 'rgba(25,113,194,0.08)', border: '1px solid rgba(25,113,194,0.15)', textDecoration: 'none', color: '#1971c2', maxWidth: 200, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <IconLink size={11} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.title || k.url}</span>
              </Anchor>
            ))}
          </Group>
        )}
        {link !== null && (
          <Group gap={4} mt={6} wrap="nowrap">
            <TextInput size="xs" radius="md" style={{ flex: 1 }} placeholder="https://…" value={link} onChange={(e) => setLink(e.currentTarget.value)} data-autofocus
              onKeyDown={(e) => { if (e.key === 'Enter' && link.trim()) { const url = /^https?:\/\//i.test(link) ? link.trim() : `https://${link.trim()}`; updateLearning(l.id, { links: [...(l.links ?? []), { title: url.replace(/^https?:\/\//, '').split('/')[0], url }] }); setLink(null); } if (e.key === 'Escape') setLink(null); }} />
            <Button size="compact-xs" color="forest" radius="xl" disabled={!link.trim()} onClick={() => { const url = /^https?:\/\//i.test(link) ? link.trim() : `https://${link.trim()}`; updateLearning(l.id, { links: [...(l.links ?? []), { title: url.replace(/^https?:\/\//, '').split('/')[0], url }] }); setLink(null); }}>Add</Button>
          </Group>
        )}
        <Group gap={4} mt={8} wrap="nowrap">
          {si > 0 && (
            <Tooltip label={`Back to ${STAGES[si - 1]}`}>
              <ActionIcon size="sm" radius="xl" variant="light" color="gray" onClick={() => moveLearning(l.id, -1)}><IconArrowLeft size={13} /></ActionIcon>
            </Tooltip>
          )}
          {si < 3 && (
            <Tooltip label={`Move to ${STAGES[si + 1]}`}>
              <ActionIcon size="sm" radius="xl" variant="light" color="forest" onClick={() => moveLearning(l.id, 1)}><IconArrowRight size={13} /></ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Notes"><ActionIcon size="sm" radius="xl" variant="subtle" color="gray" onClick={() => setNotes(notes === null ? (l.notes ?? '') : null)}><IconNotes size={13} /></ActionIcon></Tooltip>
          <Tooltip label="Attach a file (PDF, notes, slides…)">
            <ActionIcon size="sm" radius="xl" variant="subtle" color="gray" component="label"><IconPaperclip size={13} /><input type="file" hidden multiple onChange={(e) => { attach(e.target.files); e.target.value = ''; }} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Add a link"><ActionIcon size="sm" radius="xl" variant="subtle" color="gray" onClick={() => setLink(link === null ? '' : null)}><IconLink size={13} /></ActionIcon></Tooltip>
          <Tooltip label="Ask Myth to write a study sheet for this and attach it">
            <ActionIcon size="sm" radius="xl" variant="subtle" color="grape" onClick={() => openAssistant(`Create a study sheet on ${l.title} and add it to learning under ${l.title}`)}><IconSparkles size={13} /></ActionIcon>
          </Tooltip>
          <ActionIcon size="sm" radius="xl" variant="light" color="red" ml="auto" onClick={() => { mine.forEach(removeFile); deleteLearning(l.id); }}><IconX size={13} /></ActionIcon>
        </Group>
      </Box>
    </motion.div>
  );
}

export default function LearningPanel() {
  const { learning, addLearning, files } = useStore();
  const openAssistant = useUI((s) => s.openAssistant);
  const [title, setTitle] = useState('');

  const add = () => {
    if (!title.trim()) return;
    addLearning(title.trim());
    setTitle('');
  };

  const applied = learning.filter((l) => l.stage >= 2).length;
  const inProgress = learning.filter((l) => l.stage === 1).length;
  const queued = learning.filter((l) => l.stage === 0).length;

  return (
    <Stack gap="md">
      <Text fz={13} c="dimmed" mt={-6}>Nothing counts as learned until it reaches Applied. Each card holds its notes, files and links — or ask Myth AI to write a study sheet and it lands here.</Text>

      <Group gap="xs">
        <TextInput
          style={{ flex: 1 }} radius="xl" placeholder="What do you want to learn next?"
          value={title} onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button radius="xl" color="forest" leftSection={<IconPlus size={15} />} onClick={add}>Add</Button>
        <Tooltip label="Hand Myth AI a PDF or a topic — “add this file to learning”, “make me a cheat sheet on SQL joins and save it here”">
          <Button radius="xl" variant="light" color="grape" leftSection={<IconSparkles size={15} />} onClick={() => openAssistant()}>Ask Myth</Button>
        </Tooltip>
      </Group>

      <SimpleGrid cols={2} spacing="sm">
        {STAGES.map((stage, si) => {
          const items = learning.filter((l) => l.stage === si);
          return (
            <Box key={stage} p="sm" style={{ background: '#f7faf8', borderRadius: 16, border: '1px solid #e9eeeb', minHeight: 120 }}>
              <Group justify="space-between" mb={8}>
                <Text fz={11.5} fw={800} tt="uppercase" lts={0.6} c={STAGE_COLORS[si]}>{stage}</Text>
                <Text fz={11.5} fw={700} c="dimmed">{items.length}</Text>
              </Group>
              <Stack gap={6}>
                {items.length === 0 && <Text fz={12} c="dimmed">—</Text>}
                <AnimatePresence>
                  {items.map((l) => <LearningCard key={l.id} l={l} si={si} files={files} />)}
                </AnimatePresence>
              </Stack>
            </Box>
          );
        })}
      </SimpleGrid>

      <div>
        <Text fw={700} fz={14} mb={8}>Learning score</Text>
        <SimpleGrid cols={3} spacing="sm">
          {[
            { n: applied, label: 'Applied in real work', color: '#0D2D1C' },
            { n: inProgress, label: 'In progress', color: '#1971c2' },
            { n: queued, label: 'In the queue', color: '#8a9691' },
          ].map((s) => (
            <Box key={s.label} p="md" style={{ background: '#f7faf8', borderRadius: 16, border: '1px solid #e9eeeb' }}>
              <Text fz={26} fw={900} c={s.color} lh={1}>{s.n}</Text>
              <Text fz={12} c="dimmed" mt={4}>{s.label}</Text>
            </Box>
          ))}
        </SimpleGrid>
      </div>
    </Stack>
  );
}
