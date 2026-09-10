// Two small pieces of the sync experience:
//   • ConnectBanner — on a device that has no sync key yet: paste the
//     passphrase once and this device joins the same data as the others.
//   • ConflictDialog — the first connection when both this device and the
//     cloud already hold data: keep which copy?
import { useState } from 'react';
import { Modal, Text, Group, Button, PasswordInput, Stack } from '@mantine/core';
import { IconCloud, IconCloudUpload, IconCloudDownload, IconX } from '@tabler/icons-react';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import * as cloud from '../cloud/netlify';
import { autoSync } from '../cloud/autoSync';

export function ConnectBanner() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('myth-connect-dismissed') === '1');
  if (cloud.isConfigured(settings) || hidden) return null;

  const connect = async () => {
    const k = key.trim();
    if (k.length < 12) { setErr('The passphrase is at least 12 characters.'); return; }
    setBusy(true); setErr('');
    try {
      await cloud.connect({ ...settings, cloudKey: k }); // validates before anything is stored
      setSettings({ cloudKey: k }); // auto-sync picks this up and pulls
    } catch (e) {
      setErr(e.message.includes('401') || /key/i.test(e.message) ? 'That passphrase was not accepted.' : e.message);
    } finally { setBusy(false); }
  };
  const dismiss = () => { sessionStorage.setItem('myth-connect-dismissed', '1'); setHidden(true); };

  return (
    <motion.div className="connect-banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <IconCloud size={20} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <Text fw={700} fz={13.5}>See your data on this device</Text>
        <Text fz={12} c="dimmed">Paste your sync passphrase once — everything you add anywhere shows up here automatically.</Text>
        <Group gap={6} mt={6} wrap="nowrap">
          <PasswordInput size="xs" radius="xl" style={{ flex: 1, maxWidth: 320 }} placeholder="sync passphrase" value={key} onChange={(e) => setKey(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} />
          <Button size="xs" radius="xl" color="forest" loading={busy} onClick={connect}>Connect</Button>
        </Group>
        {err && <Text fz={11.5} c="red" mt={4}>{err}</Text>}
      </div>
      <button type="button" className="connect-close" onClick={dismiss} aria-label="Not now"><IconX size={15} /></button>
    </motion.div>
  );
}

export function ConflictDialog() {
  const conflict = useStore((s) => s.syncConflict);
  if (!conflict) return null;
  const pick = (side) => autoSync()?.resolveConflict(side);
  return (
    <Modal opened onClose={() => {}} withCloseButton={false} radius="xl" centered title={<Text fw={800} fz={18}>Which copy should this device use?</Text>}>
      <Stack gap="sm">
        <Text fz={13.5}>This device and the cloud both have data. Pick the one to keep — the other is replaced everywhere. This is asked only once.</Text>
        <Group grow>
          <Button radius="xl" color="forest" leftSection={<IconCloudDownload size={16} />} onClick={() => pick('cloud')} styles={{ root: { height: 'auto', padding: '10px 12px' }, label: { display: 'block', whiteSpace: 'normal', textAlign: 'center' } }}>
            Use the cloud copy<br /><span style={{ fontWeight: 500, fontSize: 11.5, opacity: 0.85 }}>{conflict.cloudCount} items · saved {dayjs(conflict.cloudUpdatedAt).format('MMM D, HH:mm')}</span>
          </Button>
          <Button radius="xl" variant="light" color="gray" leftSection={<IconCloudUpload size={16} />} onClick={() => pick('local')} styles={{ root: { height: 'auto', padding: '10px 12px' }, label: { display: 'block', whiteSpace: 'normal', textAlign: 'center' } }}>
            Keep this device's data<br /><span style={{ fontWeight: 500, fontSize: 11.5, opacity: 0.85 }}>{conflict.localCount} items · overwrites the cloud</span>
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
