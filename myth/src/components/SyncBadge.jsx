// A small cloud indicator in the top bar: off / syncing / synced / offline / error.
import { Tooltip } from '@mantine/core';
import { IconCloud, IconCloudCheck, IconCloudOff, IconCloudX } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { autoSync } from '../cloud/autoSync';

const META = {
  off: { icon: IconCloudOff, label: 'Cloud sync is off — connect in Settings', color: '#8a9691' },
  syncing: { icon: IconCloud, label: 'Syncing…', color: '#1971c2', spin: true },
  synced: { icon: IconCloudCheck, label: 'Synced', color: '#12a150' },
  conflict: { icon: IconCloud, label: 'Choose which copy to keep', color: '#f08c00' },
  offline: { icon: IconCloudOff, label: 'Offline — changes sync when you are back', color: '#f08c00' },
  error: { icon: IconCloudX, label: 'Sync problem', color: '#e03131' },
};

export default function SyncBadge() {
  const state = useStore((s) => s.syncState) ?? 'off';
  const lastAt = useStore((s) => s.lastSyncAt);
  const err = useStore((s) => s.syncError);
  const setPanel = useUI((s) => s.setPanel);
  const m = META[state] ?? META.off;
  const Icon = m.icon;
  const label = state === 'synced' && lastAt ? `Synced · ${dayjs(lastAt).format('HH:mm')}` : state === 'error' && err ? `Sync problem: ${err}` : m.label;
  return (
    <Tooltip label={label}>
      <button type="button" className={`canvas-icon-btn sync-badge${m.spin ? ' is-spinning' : ''}`} style={{ color: m.color }} aria-label={label} onClick={() => (state === 'off' || state === 'error' ? setPanel('settings') : autoSync()?.pullNow())}>
        <Icon size={19} />
      </button>
    </Tooltip>
  );
}
