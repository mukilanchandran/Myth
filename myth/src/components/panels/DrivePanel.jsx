// Drive — a private vault inside Myth.
// Paste screenshots straight from the clipboard (Ctrl+V), drag & drop or upload
// any file, keep passwords and links — everything titled, filterable,
// pinnable and exportable. Files live in IndexedDB, metadata in the store.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Stack, Group, Text, Box, TextInput, ActionIcon, Button, Badge, Tooltip,
  Modal, SimpleGrid, Image, Chip, PasswordInput, Menu, Kbd, Progress, Textarea,
} from '@mantine/core';
import {
  IconUpload, IconTrash, IconDownload, IconPhoto, IconFile, IconFileTypePdf,
  IconLock, IconLink, IconSearch, IconPin, IconPinnedFilled, IconCopy,
  IconClipboardPlus, IconFileExport, IconPlus, IconExternalLink, IconDots,
  IconEdit, IconDatabase, IconFileText,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useStore, uid } from '../../store/useStore';
import { putBlob, getBlob, deleteBlob, downloadBlob } from '../../store/fileStore';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Screenshots' },
  { value: 'file', label: 'Files & docs' },
  { value: 'text', label: 'Text & chats' },
  { value: 'password', label: 'Passwords' },
  { value: 'link', label: 'Links' },
];

function kindIcon(item) {
  if (item.kind === 'image') return <IconPhoto size={16} color="#7048e8" />;
  if (item.kind === 'password') return <IconLock size={16} color="#e8590c" />;
  if (item.kind === 'link') return <IconLink size={16} color="#1971c2" />;
  if (item.kind === 'text') return <IconFileText size={16} color="#0ca678" />;
  if (item.type === 'application/pdf') return <IconFileTypePdf size={16} color="#e03131" />;
  return <IconFile size={16} color="#495057" />;
}

// clipboard images arrive named "image.png" — give them a real title
const GENERIC_NAME = /^(image|unnamed|blob|clipboard|screenshot|capture)?$/i;

// image thumbnail backed by the IndexedDB blob
function Thumb({ item, onClick }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let u = null;
    getBlob(item.blobId).then((b) => {
      if (alive && b) { u = URL.createObjectURL(b); setUrl(u); }
    });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [item.blobId]);
  return (
    <Box
      onClick={onClick}
      style={{ borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: 'rgba(0,0,0,0.05)', aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}
    >
      {url ? <Image src={url} h="100%" w="100%" fit="cover" /> : <IconPhoto size={22} color="#adb5bd" />}
    </Box>
  );
}

const copyText = async (text, what = 'Copied') => {
  try {
    await navigator.clipboard.writeText(text);
    notifications.show({ color: 'teal', message: `${what} to clipboard`, autoClose: 1600 });
  } catch {
    notifications.show({ color: 'red', message: 'Clipboard not available' });
  }
};

export default function DrivePanel() {
  const drive = useStore((s) => s.drive);
  const addDriveItem = useStore((s) => s.addDriveItem);
  const updateDriveItem = useStore((s) => s.updateDriveItem);
  const deleteDriveItem = useStore((s) => s.deleteDriveItem);

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [staged, setStaged] = useState(null); // [{file, title, isImage}] waiting for titles
  const [pwModal, setPwModal] = useState(false);
  const [pwForm, setPwForm] = useState({ title: '', username: '', secret: '' });
  const [linkModal, setLinkModal] = useState(false);
  const [linkForm, setLinkForm] = useState({ title: '', url: '' });
  const [textForm, setTextForm] = useState(null); // {id?, title, body} — null = closed
  const [preview, setPreview] = useState(null);
  const [renaming, setRenaming] = useState(null); // {id, title}
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef(null);

  // ---- intake: stage files so the user can title them before saving ----
  const stageFiles = (list) => {
    const files = Array.from(list ?? []).filter(Boolean);
    if (!files.length) return;
    setStaged(files.map((file) => {
      const base = (file.name ?? '').replace(/\.[a-z0-9]+$/i, '');
      return {
        file,
        isImage: file.type.startsWith('image/'),
        title: GENERIC_NAME.test(base) ? `Screenshot ${dayjs().format('MMM D, h.mm A')}` : base,
      };
    }));
  };

  const saveStaged = async () => {
    for (const s of staged) {
      const blobId = uid();
      await putBlob(blobId, s.file);
      addDriveItem({
        kind: s.isImage ? 'image' : 'file',
        title: s.title.trim() || s.file.name || 'Untitled',
        name: s.file.name || `${s.title || 'screenshot'}.png`,
        size: s.file.size, type: s.file.type, blobId,
      });
    }
    notifications.show({ color: 'teal', message: `${staged.length} item${staged.length > 1 ? 's' : ''} saved to Drive` });
    setStaged(null);
  };

  // ---- paste anything while Drive is open: screenshots become images,
  // plain text (a chat, a snippet, anything copied) becomes a text note ----
  useEffect(() => {
    const onPaste = (e) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.kind === 'file')
        .map((i) => i.getAsFile())
        .filter(Boolean);
      if (files.length) { e.preventDefault(); stageFiles(files); return; }
      // don't hijack pastes into inputs — only bare-page pastes become notes
      const el = e.target;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      const text = e.clipboardData?.getData('text');
      if (!typing && text?.trim()) {
        e.preventDefault();
        setTextForm({ title: text.trim().split('\n')[0].slice(0, 60), body: text });
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // ---- drag & drop ----
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return undefined;
    const over = (e) => { e.preventDefault(); setDragOver(true); };
    const leave = () => setDragOver(false);
    const drop = (e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer?.files); };
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop); };
  }, []);

  const openPreview = async (item) => {
    if (item.kind !== 'image') { downloadBlob(item.blobId, item.name); return; }
    const blob = await getBlob(item.blobId);
    if (blob) setPreview({ url: URL.createObjectURL(blob), title: item.title });
  };

  const removeItem = (item) => {
    if (item.blobId) deleteBlob(item.blobId);
    deleteDriveItem(item.id);
  };

  // ---- export: one JSON with every entry (passwords included) ----
  const exportVault = () => {
    const payload = {
      exported: new Date().toISOString(),
      note: 'Files themselves stay in your browser — download them individually.',
      items: drive.map(({ blobId, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `myth-drive-${dayjs().format('YYYY-MM-DD')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drive
      .filter((d) => filter === 'all' || d.kind === filter)
      .filter((d) => !q || [d.title, d.name, d.username, d.url, d.body].some((f) => f?.toLowerCase().includes(q)))
      .sort((a, b) => (a.pinned === b.pinned ? new Date(b.created) - new Date(a.created) : a.pinned ? -1 : 1));
  }, [drive, filter, query]);

  const images = visible.filter((d) => d.kind === 'image');
  const rows = visible.filter((d) => d.kind !== 'image');
  const usedBytes = drive.reduce((n, d) => n + (d.size ?? 0), 0);

  const rowMenu = (item) => (
    <Menu position="bottom-end" radius="md" shadow="md">
      <Menu.Target>
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={(e) => e.stopPropagation()}><IconDots size={14} /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setRenaming({ id: item.id, title: item.title })}>Rename</Menu.Item>
        <Menu.Item leftSection={item.pinned ? <IconPinnedFilled size={14} /> : <IconPin size={14} />} onClick={() => updateDriveItem(item.id, { pinned: !item.pinned })}>
          {item.pinned ? 'Unpin' : 'Pin to top'}
        </Menu.Item>
        {item.blobId && <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => downloadBlob(item.blobId, item.name)}>Download</Menu.Item>}
        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => removeItem(item)}>Delete</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <Stack gap="sm" ref={dropRef} style={{ minHeight: '100%', outline: dragOver ? '2px dashed #12a150' : 'none', outlineOffset: -2, borderRadius: 16 }}>
      {/* actions */}
      <Group gap="xs">
        <Button size="xs" radius="xl" variant="gradient" gradient={{ from: '#12a150', to: '#0f766e' }} leftSection={<IconUpload size={14} />} component="label">
          Upload
          <input type="file" hidden multiple onChange={(e) => { stageFiles(e.target.files); e.target.value = ''; }} />
        </Button>
        <Button size="xs" radius="xl" variant="light" color="teal" leftSection={<IconFileText size={14} />} onClick={() => setTextForm({ title: '', body: '' })}>
          Text
        </Button>
        <Button size="xs" radius="xl" variant="light" color="orange" leftSection={<IconLock size={14} />} onClick={() => setPwModal(true)}>
          Password
        </Button>
        <Button size="xs" radius="xl" variant="light" color="blue" leftSection={<IconLink size={14} />} onClick={() => setLinkModal(true)}>
          Link
        </Button>
        <Tooltip label="Export everything as JSON (passwords & links included)">
          <Button size="xs" radius="xl" variant="light" color="gray" leftSection={<IconFileExport size={14} />} onClick={exportVault} disabled={!drive.length}>
            Export
          </Button>
        </Tooltip>
      </Group>

      <Group gap={8} align="center">
        <IconClipboardPlus size={15} color="#0f766e" />
        <Text fz={12} c="dimmed"><Kbd size="xs">Ctrl</Kbd>+<Kbd size="xs">V</Kbd> pastes screenshots or copied text straight into the vault; files can be dropped anywhere here.</Text>
      </Group>

      {/* search + filters */}
      <TextInput
        size="sm" radius="xl" placeholder="Search titles, usernames, links…"
        leftSection={<IconSearch size={15} />}
        value={query} onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Chip.Group multiple={false} value={filter} onChange={setFilter}>
        <Group gap={6}>
          {FILTERS.map((f) => (
            <Chip key={f.value} value={f.value} size="xs" variant="light" color="forest">{f.label}</Chip>
          ))}
        </Group>
      </Chip.Group>

      {/* screenshots grid */}
      {images.length > 0 && (
        <>
          <Text fz={12.5} fw={700} c="dimmed" mt={4}>Screenshots & images</Text>
          <SimpleGrid cols={3} spacing={8}>
            {images.map((item) => (
              <Box key={item.id} pos="relative">
                <Thumb item={item} onClick={() => openPreview(item)} />
                <Group gap={4} justify="space-between" mt={4} wrap="nowrap">
                  <Text fz={11.5} fw={600} truncate style={{ flex: 1 }}>
                    {item.pinned && <IconPinnedFilled size={10} color="#e8590c" style={{ marginRight: 3 }} />}
                    {item.title}
                  </Text>
                  {rowMenu(item)}
                </Group>
              </Box>
            ))}
          </SimpleGrid>
        </>
      )}

      {/* files / passwords / links list */}
      <Stack gap={6} mt={images.length ? 4 : 0}>
        {rows.map((item) => (
          <Group
            key={item.id} gap={10} wrap="nowrap" className="glass" p={10}
            style={{ borderRadius: 12, cursor: item.kind === 'file' || item.kind === 'text' ? 'pointer' : 'default' }}
            onClick={() => {
              if (item.kind === 'file') openPreview(item);
              if (item.kind === 'text') setTextForm({ id: item.id, title: item.title, body: item.body ?? '' });
            }}
          >
            {kindIcon(item)}
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group gap={5} wrap="nowrap">
                {item.pinned && <IconPinnedFilled size={11} color="#e8590c" />}
                <Text fz={13.5} fw={600} truncate>{item.title}</Text>
              </Group>
              {item.kind === 'password' && <Text fz={11.5} c="dimmed" truncate>{item.username || '—'}</Text>}
              {item.kind === 'link' && <Text fz={11.5} c="dimmed" truncate>{item.url}</Text>}
              {item.kind === 'text' && <Text fz={11.5} c="dimmed" lineClamp={1}>{item.body}</Text>}
              {item.kind === 'file' && <Text fz={11.5} c="dimmed">{item.name} · {((item.size ?? 0) / 1024).toFixed(0)} KB</Text>}
            </Box>
            {item.kind === 'text' && (
              <Tooltip label="Copy text">
                <ActionIcon size="sm" variant="subtle" onClick={(e) => { e.stopPropagation(); copyText(item.body ?? '', 'Text copied'); }}>
                  <IconCopy size={14} />
                </ActionIcon>
              </Tooltip>
            )}
            {item.kind === 'password' && (
              <>
                <PasswordInput
                  size="xs" radius="md" w={130} value={item.secret} readOnly variant="filled"
                  onClick={(e) => e.stopPropagation()}
                />
                <Tooltip label="Copy password">
                  <ActionIcon size="sm" variant="subtle" onClick={() => copyText(item.secret, 'Password copied')}><IconCopy size={14} /></ActionIcon>
                </Tooltip>
              </>
            )}
            {item.kind === 'link' && (
              <>
                <Tooltip label="Open link">
                  <ActionIcon size="sm" variant="subtle" component="a" href={item.url} target="_blank" rel="noreferrer"><IconExternalLink size={14} /></ActionIcon>
                </Tooltip>
                <Tooltip label="Copy link">
                  <ActionIcon size="sm" variant="subtle" onClick={() => copyText(item.url, 'Link copied')}><IconCopy size={14} /></ActionIcon>
                </Tooltip>
              </>
            )}
            {rowMenu(item)}
          </Group>
        ))}
      </Stack>

      {visible.length === 0 && (
        <Stack align="center" py="xl" gap={6}>
          <IconDatabase size={30} color="#adb5bd" />
          <Text fz={13.5} c="dimmed" ta="center">
            {drive.length === 0
              ? 'Your vault is empty. Paste a screenshot or copied text, upload files, save a password or link — everything stays in this browser only.'
              : 'Nothing matches this filter.'}
          </Text>
        </Stack>
      )}

      {drive.length > 0 && (
        <Group gap={8} mt="auto" pt="sm">
          <IconDatabase size={13} color="#868e96" />
          <Text fz={11.5} c="dimmed">{drive.length} items · {(usedBytes / 1024 / 1024).toFixed(1)} MB stored locally</Text>
          <Progress value={Math.min(100, (usedBytes / (200 * 1024 * 1024)) * 100)} size={4} radius="xl" w={90} color="forest" />
        </Group>
      )}

      {/* title-before-save dialog */}
      <Modal
        opened={!!staged} onClose={() => setStaged(null)} radius="xl" centered
        title={<Text fw={800} fz={17}>Name {staged?.length > 1 ? 'these' : 'this'} before saving</Text>}
      >
        <Stack gap="sm">
          {staged?.map((s, i) => (
            <Group key={i} gap={10} wrap="nowrap">
              {s.isImage ? <IconPhoto size={18} color="#7048e8" /> : <IconFile size={18} color="#495057" />}
              <TextInput
                style={{ flex: 1 }} radius="md" size="sm" value={s.title} data-autofocus={i === 0}
                onChange={(e) => setStaged(staged.map((x, j) => (j === i ? { ...x, title: e.currentTarget.value } : x)))}
                onKeyDown={(e) => e.key === 'Enter' && saveStaged()}
              />
            </Group>
          ))}
          <Button radius="xl" color="forest" onClick={saveStaged}>Save to Drive</Button>
        </Stack>
      </Modal>

      {/* text / chat / anything note — create, view & edit */}
      <Modal
        opened={!!textForm} onClose={() => setTextForm(null)} radius="xl" centered size="lg"
        title={<Text fw={800} fz={17}>{textForm?.id ? 'Edit text' : 'Save text — a chat, a snippet, anything'}</Text>}
      >
        <Stack gap="sm">
          <TextInput
            label="Title" placeholder="e.g. Client WhatsApp chat, API key notes…" radius="md" data-autofocus={!textForm?.body}
            value={textForm?.title ?? ''} onChange={(e) => setTextForm({ ...textForm, title: e.currentTarget.value })}
          />
          <Textarea
            label="Content" placeholder="Paste or type anything…" radius="md" autosize minRows={6} maxRows={16}
            value={textForm?.body ?? ''} onChange={(e) => setTextForm({ ...textForm, body: e.currentTarget.value })}
          />
          <Group justify="space-between">
            {textForm?.id ? (
              <Button variant="subtle" color="gray" size="xs" radius="xl" leftSection={<IconCopy size={13} />}
                onClick={() => copyText(textForm.body ?? '', 'Text copied')}>
                Copy all
              </Button>
            ) : <span />}
            <Button
              radius="xl" color="forest" disabled={!textForm?.body?.trim()}
              onClick={() => {
                const title = textForm.title.trim() || textForm.body.trim().split('\n')[0].slice(0, 60);
                if (textForm.id) updateDriveItem(textForm.id, { title, body: textForm.body });
                else addDriveItem({ kind: 'text', title, body: textForm.body });
                setTextForm(null);
              }}
            >
              {textForm?.id ? 'Save changes' : 'Save to Drive'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* new password */}
      <Modal opened={pwModal} onClose={() => setPwModal(false)} radius="xl" centered title={<Text fw={800} fz={17}>Save a password</Text>}>
        <Stack gap="sm">
          <TextInput label="What is it for?" placeholder="e.g. Figma team account" radius="md" data-autofocus
            value={pwForm.title} onChange={(e) => setPwForm({ ...pwForm, title: e.currentTarget.value })} />
          <TextInput label="Username / email" placeholder="you@company.com" radius="md"
            value={pwForm.username} onChange={(e) => setPwForm({ ...pwForm, username: e.currentTarget.value })} />
          <PasswordInput label="Password" radius="md"
            value={pwForm.secret} onChange={(e) => setPwForm({ ...pwForm, secret: e.currentTarget.value })} />
          <Text fz={11.5} c="dimmed">Stored only in this browser — never uploaded anywhere.</Text>
          <Button radius="xl" color="forest" disabled={!pwForm.title.trim() || !pwForm.secret}
            onClick={() => { addDriveItem({ kind: 'password', ...pwForm, title: pwForm.title.trim() }); setPwForm({ title: '', username: '', secret: '' }); setPwModal(false); }}>
            Save password
          </Button>
        </Stack>
      </Modal>

      {/* new link */}
      <Modal opened={linkModal} onClose={() => setLinkModal(false)} radius="xl" centered title={<Text fw={800} fz={17}>Save a link</Text>}>
        <Stack gap="sm">
          <TextInput label="Title" placeholder="e.g. Client brand guidelines" radius="md" data-autofocus
            value={linkForm.title} onChange={(e) => setLinkForm({ ...linkForm, title: e.currentTarget.value })} />
          <TextInput label="URL" placeholder="https://…" radius="md"
            value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.currentTarget.value })} />
          <Button radius="xl" color="forest" disabled={!linkForm.url.trim()}
            onClick={() => {
              const url = /^https?:\/\//i.test(linkForm.url) ? linkForm.url : `https://${linkForm.url}`;
              addDriveItem({ kind: 'link', title: linkForm.title.trim() || url, url });
              setLinkForm({ title: '', url: '' });
              setLinkModal(false);
            }}>
            Save link
          </Button>
        </Stack>
      </Modal>

      {/* rename */}
      <Modal opened={!!renaming} onClose={() => setRenaming(null)} radius="xl" centered size="sm" title={<Text fw={800} fz={16}>Rename</Text>}>
        <Stack gap="sm">
          <TextInput radius="md" data-autofocus value={renaming?.title ?? ''}
            onChange={(e) => setRenaming({ ...renaming, title: e.currentTarget.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && renaming.title.trim()) { updateDriveItem(renaming.id, { title: renaming.title.trim() }); setRenaming(null); } }} />
          <Button radius="xl" color="forest" disabled={!renaming?.title?.trim()}
            onClick={() => { updateDriveItem(renaming.id, { title: renaming.title.trim() }); setRenaming(null); }}>
            Save
          </Button>
        </Stack>
      </Modal>

      {/* image preview */}
      <Modal
        opened={!!preview} onClose={() => { URL.revokeObjectURL(preview?.url); setPreview(null); }}
        title={preview?.title} size="lg" radius="lg"
      >
        {preview && <Image src={preview.url} radius="md" />}
      </Modal>
    </Stack>
  );
}
