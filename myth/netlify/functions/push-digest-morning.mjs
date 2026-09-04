// Morning digest — 03:00 UTC = 8:30 AM IST. Change the cron below for another
// timezone (Netlify schedules run in UTC). Not reachable over HTTP in
// production; use "Send test push" in the app's Settings to verify delivery.
import { openStore } from '../lib/store.mjs';
import { runDigest } from '../lib/digest.mjs';

export default async () => {
  const result = await runDigest(openStore(), { label: 'morning' });
  console.log('push-digest-morning', JSON.stringify(result));
};

export const config = { schedule: '0 3 * * *' };
