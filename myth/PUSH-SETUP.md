# Background push — one-time server setup

After this, Myth sends your daily digest (8:30 AM & 7 PM IST) to your
iPhone/desktop **even when the app is fully closed** — like a regular app.

Prerequisites: the app deployed on Netlify with cloud storage connected
(README → *Cloud storage & sync*). The digest is computed from the synced
backup, and the devices to notify are registered under your sync key.

## 1. Generate push keys (VAPID)

```bash
npx web-push generate-vapid-keys
```

Keep both values. The **public key** goes into the app UI (step 3); the
**private key** stays on the server (step 2).

## 2. Add the keys in Netlify

**Site configuration → Environment variables → Add a variable**, one per row:

| Variable | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | public key from step 1 |
| `VAPID_PRIVATE_KEY` | private key from step 1 |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `PUSH_TZ_OFFSET_MIN` | *(optional)* minutes from UTC, default `330` = IST |

Then **Deploys → Trigger deploy → Deploy site**. Environment variables only
reach new deploys, and the two scheduled functions are registered on deploy.

## 3. Turn it on in the app

On each device (iPhone: opened from the Home-Screen icon):

1. Settings → **Device notifications** → *Enable notifications on this device*.
2. Settings → **Cloud storage & sync** → paste the sync key → **Connect**
   (this is where the digest data comes from).
3. Paste the **public key** from step 1 into *Push public key (VAPID)*.
4. Tap **Enable background push on this device**.
5. Tap **Send test push** — the notification should appear within seconds,
   with the app closed. It goes through the server, so it proves the whole chain.

## Schedule

| Function | Cron (UTC) | Local (IST) |
|---|---|---|
| `netlify/functions/push-digest-morning.mjs` | `0 3 * * *` | 8:30 AM |
| `netlify/functions/push-digest-evening.mjs` | `30 13 * * *` | 7:00 PM — also nudges about open habits |

Netlify runs schedules in UTC; edit the cron line in each file for another
timezone (and `PUSH_TZ_OFFSET_MIN` so "today" is computed in your zone).
Each run logs a one-line summary — **Logs → Functions** in Netlify:
`{"sent":1,"skipped":0,"removed":0,"keys":1}` (`skipped` = a key with no
devices or nothing due; `removed` = an expired subscription cleaned up).

## How it works

```
Netlify scheduled function (8:30 AM / 7 PM IST)
   → netlify/lib/digest.mjs
       → reads the synced backup from Netlify Blobs (your daily auto-synced app data)
       → computes reminders (overdue / due today / events ≤3 days / habit nudges)
       → Web Push to every device registered under your sync key
   → service worker (public/sw.js) shows the notification, tap opens the app
```

The app quietly backs itself up to the cloud once a day while a sync key is set,
so the digest is computed from fresh data. Notifications honour the
"Daily digest & smart reminders" switch in Settings.
