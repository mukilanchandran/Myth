import { useEffect, useState } from 'react';
import { Stack, Group, Text, TextInput, Switch, Box, Button, Divider, Code, PasswordInput, Badge, Select, Anchor } from '@mantine/core';
import { IconDownload, IconUpload, IconTrash, IconRefresh, IconSparkles, IconExternalLink, IconBellRinging, IconBellCheck, IconDatabase, IconFiles } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useStore } from '../../store/useStore';
import {
  notifyStatus, enableNotifications, showSystemNotification, isStandalone,
  enableBackgroundPush, disableBackgroundPush, getPushSubscription,
} from '../../notify';
import { detectAI, streamChat, pickModel, OLLAMA_DEFAULT } from '../../ai/ollama';
import { PROVIDERS, providerFor } from '../../ai/providers';
import * as cloud from '../../cloud/netlify';
import NotificationPrefs from './NotificationPrefs';

function NotificationSection({ settings, setSettings }) {
  const enabled = settings.notifications;
  const [status, setStatus] = useState(notifyStatus());
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => { getPushSubscription().then((s) => setPushOn(!!s)); }, []);

  const togglePush = async () => {
    setPushBusy(true);
    if (pushOn) {
      await disableBackgroundPush(settings);
      setPushOn(false);
      notifications.show({ color: 'gray', message: 'Background push disabled on this device.' });
    } else {
      const res = await enableBackgroundPush(settings);
      if (res.ok) {
        setPushOn(true);
        notifications.show({ color: 'green', title: 'Background push on', message: 'Daily digests will now arrive even when the app is closed.' });
      } else {
        notifications.show({ color: 'orange', title: 'Not enabled', message: res.reason, autoClose: 9000 });
      }
    }
    setPushBusy(false);
  };

  // Round-trips through the server so it proves the whole chain: VAPID keys → push service → this device.
  const testPush = async () => {
    setTestBusy(true);
    try {
      const r = await cloud.sendTestPush(settings);
      notifications.show({
        color: r.sent ? 'green' : 'orange',
        title: 'Test push',
        message: r.sent
          ? `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'} — it should appear in a moment.`
          : 'No registered device received it — enable background push on a device first.',
      });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Test push failed', message: e.message, autoClose: 9000 });
    } finally { setTestBusy(false); }
  };

  const enable = async () => {
    setBusy(true);
    const res = await enableNotifications();
    setStatus(notifyStatus());
    setBusy(false);
    if (res.ok) notifications.show({ color: 'green', title: 'Notifications on', message: 'You should have just received a test notification.' });
    else notifications.show({ color: 'orange', title: 'Not enabled yet', message: res.reason, autoClose: 9000 });
  };

  const statusMeta = {
    granted: { color: 'green', label: 'Enabled on this device' },
    default: { color: 'yellow', label: 'Not enabled yet' },
    denied: { color: 'red', label: 'Blocked in system settings' },
    'needs-install': { color: 'orange', label: 'Install to Home Screen first' },
    unsupported: { color: 'gray', label: 'Not supported in this browser' },
  }[status] ?? { color: 'gray', label: status };

  return (
    <Box className="glass" p="md" style={{ borderRadius: 16 }}>
      <Group justify="space-between" mb={4}>
        <Text fw={700} fz={14}>Device notifications</Text>
        <Badge variant="light" size="sm" color={statusMeta.color}>{statusMeta.label}</Badge>
      </Group>
      <Text fz={12.5} c="dimmed" mb="sm">
        Get reminders on your lock screen like a regular app — due tasks, meetings, birthdays and habit nudges,
        plus a red badge count on the app icon.
      </Text>
      {status === 'granted' ? (
        <Button
          size="xs" radius="xl" variant="light" color="forest" leftSection={<IconBellCheck size={14} />}
          onClick={() => showSystemNotification('Myth 🔔', 'Test notification — everything is working, Boss.')}
        >
          Send a test notification
        </Button>
      ) : (
        <Button
          size="xs" radius="xl" variant="gradient" gradient={{ from: '#0D2D1C', to: '#1b5a38' }}
          leftSection={<IconBellRinging size={14} />} loading={busy} onClick={enable}
          disabled={status === 'unsupported'}
        >
          Enable notifications on this device
        </Button>
      )}
      {!enabled && (
        <Text fz={11.5} c="orange.7" mt={6}>The "Daily digest & smart reminders" switch above is off — turn it on so there is something to deliver.</Text>
      )}
      {status === 'needs-install' && (
        <Text fz={11.5} c="dimmed" mt={6}>
          iPhone: open in Safari → Share → <b>Add to Home Screen</b> → open Myth from the icon → tap this button. Requires iOS 16.4+.
        </Text>
      )}
      {status === 'denied' && (
        <Text fz={11.5} c="dimmed" mt={6}>
          {isStandalone() ? 'iPhone: Settings → Notifications → Myth → Allow Notifications.' : 'Allow notifications for this site in your browser settings.'}
        </Text>
      )}

      {status === 'granted' && (
        <>
          <Divider my="sm" />
          <Group justify="space-between" mb={4}>
            <Text fw={700} fz={13}>Background push — even when the app is closed</Text>
            <Badge variant="light" size="sm" color={pushOn ? 'green' : 'gray'}>{pushOn ? 'active on this device' : 'off'}</Badge>
          </Group>
          <Text fz={12} c="dimmed" mb={8}>
            A daily digest (8:30 AM & 7 PM IST) from your synced cloud data. Needs the one-time server setup in
            {' '}<Code fz={11}>PUSH-SETUP.md</Code> and Cloud storage connected below.
          </Text>
          <TextInput
            size="xs" radius="md" label="Push public key (VAPID)" placeholder="B… (from npx web-push generate-vapid-keys)"
            defaultValue={settings.vapidPublicKey ?? ''}
            onBlur={(e) => setSettings({ vapidPublicKey: e.currentTarget.value.trim() })}
            mb={8}
          />
          <Group gap="xs">
            <Button
              size="xs" radius="xl" loading={pushBusy}
              variant={pushOn ? 'light' : 'gradient'} color={pushOn ? 'gray' : undefined}
              gradient={{ from: '#0D2D1C', to: '#1b5a38' }}
              leftSection={<IconBellRinging size={14} />}
              onClick={togglePush}
            >
              {pushOn ? 'Disable background push' : 'Enable background push on this device'}
            </Button>
            {pushOn && (
              <Button size="xs" radius="xl" variant="subtle" loading={testBusy} onClick={testPush}>
                Send test push
              </Button>
            )}
          </Group>
        </>
      )}
    </Box>
  );
}

// "1.4 MB" / "312 KB" / "2.1 GB" — friendly byte formatting for the meters.
const fmtBytes = (b) => {
  if (!b) return '0 KB';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 2 : 1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

// Usage snapshot. Netlify Blobs has no fixed free storage quota — storage and
// transfer draw on the plan's monthly credits (Free: 300) — so this shows plain
// sizes rather than meters against a ceiling.
function StorageStatusCard({ status, loading, onRefresh, localFileCount }) {
  if (!status && !loading) return null;
  const db = status?.db;
  const files = status?.files;
  const notSynced = files && localFileCount > files.count;
  return (
    <Box p="sm" style={{ borderRadius: 12, background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.55)' }}>
      <Group justify="space-between" mb={8}>
        <Text fw={700} fz={13}>Storage status — Netlify Blobs</Text>
        <Button size="compact-xs" radius="xl" variant="subtle" leftSection={<IconRefresh size={12} />} loading={loading} onClick={onRefresh}>
          Refresh
        </Button>
      </Group>
      {!status ? (
        <Text fz={12} c="dimmed">Measuring cloud usage…</Text>
      ) : (
        <Stack gap={8}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconDatabase size={13} color="#1b5a38" />
              <Text fz={12} fw={600}>Platform data (backup)</Text>
            </Group>
            <Text fz={11.5} c="dimmed" ta="right">{fmtBytes(db.cloudBytes)} in cloud · {fmtBytes(db.localBytes)} on this device</Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconFiles size={13} color="#7048e8" />
              <Text fz={12} fw={600}>Documents ({files.count} file{files.count === 1 ? '' : 's'})</Text>
            </Group>
            <Text fz={11.5} c="dimmed" ta="right">{fmtBytes(files.bytes)}{files.largestBytes ? ` · largest ${fmtBytes(files.largestBytes)}` : ''}</Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconBellRinging size={13} color="#e8590c" />
              <Text fz={12} fw={600}>Background push</Text>
            </Group>
            <Text fz={11.5} c="dimmed" ta="right">
              {status.devices} device{status.devices === 1 ? '' : 's'} registered · server {status.pushReady ? 'ready' : 'not set up (PUSH-SETUP.md)'}
            </Text>
          </Group>
          {notSynced && (
            <Text fz={11.5} c="dimmed">{localFileCount - files.count} file{localFileCount - files.count === 1 ? '' : 's'} on this device not in the cloud yet — press "Upload to cloud".</Text>
          )}
          <Text fz={11} c="dimmed">
            No fixed storage cap on Netlify's Free plan — uploads and downloads draw on its 300 monthly credits (about 15 GB of transfer).
          </Text>
        </Stack>
      )}
    </Box>
  );
}

function CloudSection({ settings, setSettings }) {
  const [status, setStatus] = useState(null); // cloud.connect() result | null
  const [error, setError] = useState('');
  const [storage, setStorage] = useState(null); // result of cloud.storageStatus
  const [storageBusy, setStorageBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState(settings.cloudKey ?? '');
  const configured = cloud.isConfigured(settings);
  const connected = !!status?.ok;
  const localFileCount = useStore((s) => s.files.length);

  const loadStorage = async () => {
    setStorageBusy(true);
    try { setStorage(await cloud.storageStatus(settings)); }
    catch { setStorage(null); }
    finally { setStorageBusy(false); }
  };

  const loadStatus = async () => {
    if (!configured) { setStatus(null); setStorage(null); setError(''); return; }
    try {
      setStatus(await cloud.connect(settings));
      setError('');
      loadStorage();
    } catch (e) {
      setStatus(null);
      setStorage(null);
      setError(e.message);
    }
  };

  useEffect(() => { loadStatus(); }, [settings.cloudKey, settings.cloudUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, doneMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      if (doneMsg) notifications.show({ color: 'green', title: 'Cloud', message: doneMsg(result) });
      await loadStatus();
      return result;
    } catch (e) {
      notifications.show({ color: 'red', title: 'Cloud error', message: e.message, autoClose: 9000 });
      return null;
    } finally { setBusy(false); }
  };

  const progress = (msg) => notifications.show({ id: 'cloud-progress', color: 'blue', title: 'Cloud sync', message: msg, autoClose: 4000 });

  // Saving the key re-runs loadStatus through the effect; an unchanged key retries directly.
  const doConnect = () => {
    const k = keyDraft.trim();
    if (k !== (settings.cloudKey ?? '')) setSettings({ cloudKey: k });
    else loadStatus();
  };

  const doUpload = () => run(
    async () => cloud.syncUp(settings, progress),
    (r) => `Backup complete — platform data + ${r.files} new file${r.files === 1 ? '' : 's'} uploaded ✓`,
  );

  const doDownload = async () => {
    if (!confirm('Download the CLOUD copy onto THIS device? Local changes made since your last upload will be replaced. Continue?')) return;
    const r = await run(async () => cloud.syncDown(settings, progress));
    if (r) window.location.reload();
  };

  const doDisconnect = () => {
    setSettings({ cloudKey: '' });
    setKeyDraft('');
    setStatus(null);
    setStorage(null);
    setError('');
  };

  return (
    <Box className="glass" p="md" style={{ borderRadius: 16 }}>
      <Group justify="space-between" mb={4}>
        <Text fw={700} fz={14}>Cloud storage & sync — free (Netlify)</Text>
        <Badge variant="light" size="sm" color={connected ? 'green' : configured ? 'yellow' : 'gray'}>
          {connected ? 'connected' : configured ? 'not connected' : 'not set up'}
        </Badge>
      </Group>
      <Text fz={12.5} c="dimmed" mb="sm">
        Back up all platform data and project documents to this site's own Netlify storage (Free plan, no card, no extra
        account) and move between devices. Setup once: in Netlify open <b>Site configuration → Environment variables</b>,
        add <Code>MYTH_SYNC_KEY</Code> = a long passphrase you invent (12+ characters), trigger a new deploy, then paste
        the same passphrase here. The same key on another device opens the same cloud copy.
      </Text>
      <Stack gap="sm">
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <PasswordInput
            radius="md" label="Sync key" placeholder="the MYTH_SYNC_KEY you set in Netlify" style={{ flex: 1 }}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doConnect(); }}
          />
          <Button radius="xl" variant="light" color="forest" disabled={keyDraft.trim().length < 12} onClick={doConnect}>
            {connected ? 'Reconnect' : 'Connect'}
          </Button>
        </Group>
        <TextInput
          size="xs" radius="md" label="Site URL (optional)"
          description="Only when the app is NOT opened from its Netlify address (Vite dev server, Docker, GitHub Pages) — e.g. https://your-site.netlify.app"
          placeholder="leave empty when the app runs on Netlify"
          defaultValue={settings.cloudUrl ?? ''}
          onBlur={(e) => setSettings({ cloudUrl: e.currentTarget.value.trim() })}
        />
        {error && <Text fz={12} c="red.7">{error}</Text>}
        {connected && (
          <>
            <Text fz={12.5} c="dimmed">
              Connected
              {status.backup?.updatedAt ? ` · last cloud backup ${new Date(status.backup.updatedAt).toLocaleString()}` : ' · no cloud backup yet'}
            </Text>
            <Group gap="xs">
              <Button size="xs" radius="xl" variant="light" color="forest" leftSection={<IconUpload size={14} />} loading={busy} onClick={doUpload}>
                Upload to cloud
              </Button>
              <Button size="xs" radius="xl" variant="light" leftSection={<IconDownload size={14} />} loading={busy} onClick={doDownload}>
                Download to this device
              </Button>
              <Button size="xs" radius="xl" variant="subtle" color="gray" disabled={busy} onClick={doDisconnect}>Disconnect</Button>
            </Group>
            <StorageStatusCard status={storage} loading={storageBusy} onRefresh={loadStorage} localFileCount={localFileCount} />
          </>
        )}
      </Stack>
    </Box>
  );
}

export default function SettingsPanel() {
  const { settings, setSettings } = useStore();
  const [ai, setAi] = useState({ checking: true, ok: false, models: [] });
  const [testing, setTesting] = useState(false);

  const isAuto = !settings.aiEndpoint;
  const endpoint = settings.aiEndpoint || OLLAMA_DEFAULT;
  const llm7 = PROVIDERS.find((p) => p.id === 'llm7');
  // In auto mode the badge/model list reflect whichever endpoint actually answered
  // (local Ollama first, then keyless LLM7) — same chain resolveAI uses.
  const activeEndpoint = ai.endpoint || endpoint;
  const provider = providerFor(activeEndpoint);
  const providerId = isAuto ? 'auto' : (providerFor(endpoint)?.id ?? 'custom');
  // Model list shown to the user: the provider's chat models, or its curated
  // fallbacks when /models can't be listed yet (e.g. key not entered).
  const shownModels = (() => {
    const mapped = provider?.mapModels ? provider.mapModels(ai.models) : ai.models;
    if (mapped.length) return mapped;
    return provider?.fallbackModels ?? [];
  })();

  const refresh = async (force = true) => {
    setAi((s) => ({ ...s, checking: true }));
    let ep = endpoint;
    let probe = await detectAI(ep, { force, apiKey: settings.aiKey });
    if (!probe.ok && isAuto) {
      ep = llm7.endpoint;
      probe = await detectAI(ep, { force });
    }
    setAi({ checking: false, ok: probe.ok, models: probe.models, endpoint: ep });
    return probe;
  };

  useEffect(() => { refresh(false); }, [settings.aiEndpoint, settings.aiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickProvider = (id) => {
    if (id === 'auto') { setSettings({ aiEndpoint: '', aiModel: '' }); return; }
    const p = PROVIDERS.find((x) => x.id === id);
    if (!p) return; // "custom" — user edits the endpoint field directly
    setSettings({ aiEndpoint: p.endpoint, aiModel: p.defaultModel || '' });
  };

  const testModel = async () => {
    setTesting(true);
    try {
      const model = pickModel(settings.aiModel || provider?.defaultModel, shownModels.length ? shownModels : ai.models);
      const reply = await streamChat({
        endpoint: activeEndpoint, model, apiKey: settings.aiKey,
        messages: [{ role: 'user', content: 'Reply with one short friendly sentence confirming you are connected to Myth.' }],
      });
      notifications.show({ color: 'green', title: `${model} is live ✓`, message: reply.slice(0, 140) });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Test failed', message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const exportData = () => {
    const data = localStorage.getItem('myth-db');
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `myth-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        JSON.parse(text);
        localStorage.setItem('myth-db', text);
        window.location.reload();
      } catch {
        notifications.show({ color: 'red', title: 'Invalid file', message: 'That is not a Myth backup.' });
      }
    };
    input.click();
  };

  const resetAll = () => {
    if (confirm('This wipes ALL your Myth data on this device. Export a backup first. Continue?')) {
      localStorage.removeItem('myth-db');
      indexedDB.deleteDatabase('myth-files');
      window.location.reload();
    }
  };

  return (
    <Stack gap="lg">
      <Box className="glass" p="md" style={{ borderRadius: 16 }}>
        <Text fw={700} fz={14} mb="sm">Profile</Text>
        <TextInput
          radius="md" label="Your name" defaultValue={settings.name}
          onBlur={(e) => setSettings({ name: e.currentTarget.value || 'Friend' })}
        />
        <Switch
          mt="md" color="forest" label="Daily digest & smart reminders"
          checked={settings.notifications}
          onChange={(e) => setSettings({ notifications: e.currentTarget.checked })}
        />
      </Box>

      <NotificationSection settings={settings} setSettings={setSettings} />
      <NotificationPrefs settings={settings} setSettings={setSettings} />

      <Box className="glass" p="md" style={{ borderRadius: 16 }}>
        <Group justify="space-between" mb={4}>
          <Text fw={700} fz={14}>AI brain — free providers</Text>
          <Badge
            variant="light" size="sm"
            color={ai.checking ? 'gray' : ai.ok ? 'green' : 'red'}
          >
            {ai.checking ? 'checking…' : ai.ok ? `connected · ${(shownModels.length || ai.models.length)} model${(shownModels.length || ai.models.length) === 1 ? '' : 's'}` : 'not connected'}
          </Badge>
        </Group>
        <Text fz={12.5} c="dimmed" mb="sm">
          Works out of the box: Myth auto-connects to a free AI — local Ollama when running (private),
          otherwise the free LLM7 cloud (no key, no signup). Prefer Groq/OpenRouter/Gemini? Pick one and paste a free key.
        </Text>
        <Stack gap="sm">
          <Select
            radius="md" label="Provider" allowDeselect={false}
            value={providerId}
            data={[
              { value: 'auto', label: 'Auto — free, no setup (local Ollama → LLM7 cloud)' },
              ...PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
              { value: 'custom', label: 'Custom endpoint (any OpenAI-compatible)' },
            ]}
            onChange={(v) => v && pickProvider(v)}
          />
          {isAuto ? (
            <Text fz={12} c="dimmed" mt={-6}>
              Zero-setup mode. Note: with no local Ollama, questions go to the free LLM7 cloud service — pick a specific provider if you want to control where your data goes.
            </Text>
          ) : provider?.note ? (
            <Text fz={12} c="dimmed" mt={-6}>{provider.note}</Text>
          ) : null}
          {!isAuto && provider?.keyUrl && (
            <Anchor href={provider.keyUrl} target="_blank" rel="noreferrer" fz={12.5} fw={600} mt={-6}>
              <Group gap={4} component="span">{provider.needsKey ? 'Get your free API key here' : 'Optional free token (higher rate limits)'} <IconExternalLink size={13} /></Group>
            </Anchor>
          )}
          <TextInput
            key={providerId === 'custom' ? 'custom' : endpoint}
            radius="md" label="Endpoint" placeholder={isAuto ? 'auto-detected' : OLLAMA_DEFAULT}
            description={providerId === 'custom' ? 'Any OpenAI-compatible /v1 endpoint (LM Studio, llama.cpp, vLLM…)' : isAuto ? 'Auto: tries local Ollama, then free LLM7 cloud' : 'Set automatically by the provider above'}
            defaultValue={settings.aiEndpoint}
            onBlur={(e) => setSettings({ aiEndpoint: e.currentTarget.value.trim() })}
          />
          <Group grow>
            {shownModels.length > 0 ? (
              <Select
                radius="md" label="Model" data={shownModels} allowDeselect={false} searchable
                value={pickModel(settings.aiModel || provider?.defaultModel, shownModels)}
                onChange={(v) => v && setSettings({ aiModel: v })}
              />
            ) : (
              <TextInput
                radius="md" label="Model" placeholder="llama3.2"
                defaultValue={settings.aiModel}
                onBlur={(e) => setSettings({ aiModel: e.currentTarget.value.trim() })}
              />
            )}
            <PasswordInput
              radius="md" label={provider?.needsKey ? 'API key (free)' : 'API key (if required)'}
              placeholder={provider?.needsKey ? 'paste your free key' : 'not needed for Ollama'}
              defaultValue={settings.aiKey}
              onBlur={(e) => setSettings({ aiKey: e.currentTarget.value.trim() })}
            />
          </Group>
          <Group gap="xs">
            <Button size="xs" radius="xl" variant="light" leftSection={<IconRefresh size={14} />} loading={ai.checking} onClick={() => refresh()}>
              Re-detect
            </Button>
            <Button size="xs" radius="xl" variant="light" color="forest" leftSection={<IconSparkles size={14} />} loading={testing} disabled={!ai.ok && !settings.aiKey} onClick={testModel}>
              Test model
            </Button>
          </Group>
        </Stack>
      </Box>

      <CloudSection settings={settings} setSettings={setSettings} />

      <Box className="glass" p="md" style={{ borderRadius: 16 }}>
        <Text fw={700} fz={14} mb={4}>Your data</Text>
        <Text fz={12.5} c="dimmed" mb="sm">Everything lives in this browser (plus your own cloud, if set up above) — export regularly for safety.</Text>
        <Group gap="xs">
          <Button size="xs" radius="xl" variant="light" leftSection={<IconDownload size={14} />} onClick={exportData}>Export backup</Button>
          <Button size="xs" radius="xl" variant="light" leftSection={<IconUpload size={14} />} onClick={importData}>Import</Button>
          <Button size="xs" radius="xl" variant="light" color="red" leftSection={<IconTrash size={14} />} onClick={resetAll}>Reset everything</Button>
        </Group>
      </Box>

      <Divider />
      <Text fz={11.5} c="dimmed" ta="center">Myth v1.0 · your personal OS · your data stays yours — this device, plus your own cloud if you choose</Text>
    </Stack>
  );
}
