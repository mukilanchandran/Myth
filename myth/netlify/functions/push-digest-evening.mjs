// Evening digest — 13:30 UTC = 7:00 PM IST (includes the open-habits nudge).
import { openStore } from '../lib/store.mjs';
import { runDigest } from '../lib/digest.mjs';

export default async () => {
  const result = await runDigest(openStore(), { label: 'evening' });
  console.log('push-digest-evening', JSON.stringify(result));
};

export const config = { schedule: '30 13 * * *' };
