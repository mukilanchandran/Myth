# Myth Bridge — Myth as a personal data layer

Myth keeps your whole life in one local-first app: tasks, projects, calendar, people,
commitments, goals, notes, habits, money, learning and an AI memory. The **bridge** turns
that into a data layer any tool or AI agent can talk to:

- a small **REST API** with a read-only snapshot of your data and a write queue,
- **webhooks** that tell other systems when something changed,
- an **MCP server** so Claude Desktop, Claude Code, Cursor (or any MCP client) can read your
  context and propose work.

Zero dependencies — Node ≥ 20 built-ins only (`http`, `fs`, `crypto`, `url`).

## How it works

```
   Myth app (browser, local store)
        │  Settings → Bridge → "Sync now"        POST /sync   (snapshot minus chat & file blobs)
        ▼
   bridge/server.mjs  ─── bridge/data/snapshot.json   ← GET /tasks /projects /calendar /people …
        │              ─── bridge/data/queue.json      ← POST /capture /tasks /memory (proposals)
        │              ─── bridge/data/webhooks.json   → POST {event, at, data} to subscribers
        │              ─── bridge/data/memory.json
        ▲
   Myth app  "Pull captures" / auto-pull every 2 min   GET /queue → Life Inbox → POST /queue/ack
```

Three rules keep it safe:

1. **The app stays local-first.** The bridge only ever holds a *copy* (snapshot) of what
   you chose to sync. Chat history, AI keys and file blobs never leave the browser.
2. **Nothing external executes.** Agents can only *propose* — every `/capture`, `/tasks`
   and `/memory` call lands in a queue, and the app imports it into the **Life Inbox** with
   `forceInbox: true`. You approve or dismiss each item. Myth's own auto-execution
   (confidence ≥ 0.8) is bypassed for anything that came from outside.
3. **Localhost by default.** It binds to `127.0.0.1`; add a key to lock it, a reverse proxy
   with HTTPS if you ever expose it.

## Quick start

```bash
cd myth
npm run bridge                     # http://127.0.0.1:8787
MYTH_BRIDGE_KEY=change-me npm run bridge   # require X-Myth-Key on every call (except /health)
```

| Env var                    | Default              | Meaning                                              |
| -------------------------- | -------------------- | ---------------------------------------------------- |
| `MYTH_BRIDGE_PORT`         | `8787`               | port                                                 |
| `MYTH_BRIDGE_HOST`         | `127.0.0.1`          | bind address (`0.0.0.0` to expose on your LAN)       |
| `MYTH_BRIDGE_KEY`          | *(empty = open)*     | shared secret; send as `X-Myth-Key` or `Bearer`      |
| `MYTH_BRIDGE_DATA`         | `bridge/data`        | where the JSON files live                            |
| `MYTH_BRIDGE_MAX_SNAPSHOT` | `33554432` (32 MB)   | max `/sync` body; other bodies are capped at 2 MB    |

PowerShell: `$env:MYTH_BRIDGE_KEY = 'change-me'; npm run bridge`.

### Connect the app

Open Myth → **Settings → Bridge**:

- **URL** — `http://localhost:8787` (or wherever it runs)
- **Key** — the same value as `MYTH_BRIDGE_KEY` (leave blank if unset)
- **Sync now** — pushes a snapshot (`POST /sync`)
- **Pull captures** — imports the queue into your Inbox (`GET /queue` → `POST /queue/ack`)

Once a URL is saved the app also pulls automatically every two minutes and whenever the
window regains focus, and the Activity log records `Imported n items from the bridge`.

## REST reference

All responses are JSON. Add `-H "X-Myth-Key: change-me"` to every example below when a
key is set. Every reader returns empty arrays plus a `hint` until the first sync.

### Health & sync

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"version":"1.0.0","snapshotAt":"…","counts":{"tasks":42,…},"queue":0,"webhooks":1,"auth":false}

# push a snapshot yourself (the app does this for you) — body is exportEverything()'s payload
curl -X POST http://127.0.0.1:8787/sync -H 'Content-Type: application/json' \
  -d '{"snapshot":{"exportedAt":"2026-08-27T09:00:00Z","app":"myth","version":5,"data":{"tasks":[],"projects":[]}}}'

curl http://127.0.0.1:8787/snapshot            # the stored data object (chat / blobs already stripped)
curl http://127.0.0.1:8787/                    # lists every route
```

### Read your life

```bash
curl "http://127.0.0.1:8787/tasks"                             # open tasks (default)
curl "http://127.0.0.1:8787/tasks?status=done"                 # open | done | all | todo | doing | review | blocked
curl "http://127.0.0.1:8787/tasks?project=website"             # fuzzy project-name match
curl "http://127.0.0.1:8787/projects"                          # + open/overdue counts, milestones, pct
curl "http://127.0.0.1:8787/calendar?from=2026-08-27&to=2026-09-10"
#   → { events, meetings (meeting notes), blocks (planned schedule), dueTasks, agenda (merged & sorted) }
curl "http://127.0.0.1:8787/people"                            # + openCommitments, interactions, projects
curl "http://127.0.0.1:8787/commitments?status=open"           # open | done | dropped | all  (+ overdue, days)
curl "http://127.0.0.1:8787/goals"                             # + linked projects, task counts, KR pct
curl "http://127.0.0.1:8787/notes?type=meeting"                # note | idea | meeting | all  (body → plain text)
curl "http://127.0.0.1:8787/context?q=website"                 # search everything, grouped by type
```

`/context` returns `{ q, total, results: { tasks, projects, notes, people, events, goals,
commitments, memories, learning, habits, moments, routines } }`. When `q` matches a project
name you also get `project: { …, openTasks, notes, people, commitments }`; when it matches a
person, `person: { …, openCommitments, openTasks, recentInteractions }`.

### Propose work (goes to the Inbox)

```bash
# free text — Myth classifies it (task / idea / note / meeting / expense / event …)
curl -X POST http://127.0.0.1:8787/capture -H 'Content-Type: application/json' \
  -d '{"text":"Call Ravi about the invoice tomorrow","source":"slack"}'
# 201 {"ok":true,"queued":1,"item":{"id":"…","type":"capture","text":"…","source":"slack","at":"…"}}

# structured task
curl -X POST http://127.0.0.1:8787/tasks -H 'Content-Type: application/json' \
  -d '{"title":"Fix the hero image","due":"2026-09-01","priority":5,"project":"Website Redesign"}'
# → queue item {type:"task", text:"Fix the hero image project Website Redesign urgent by 2026-09-01",
#               task:{title,due,priority,project,projectId,projectKnown}}
#   The text is phrased so Myth's parser reads it; the app also applies the exact metadata.

# long-term memory (kind: preference | fact | person | procedure | episode)
curl -X POST http://127.0.0.1:8787/memory -H 'Content-Type: application/json' \
  -d '{"text":"Boss prefers deep work before 11 AM","kind":"preference"}'
curl http://127.0.0.1:8787/memory                # everything ever posted here (log, max 1000)
```

### Queue

```bash
curl http://127.0.0.1:8787/queue                                  # {"count":n,"items":[…]}
curl -X POST http://127.0.0.1:8787/queue/ack -H 'Content-Type: application/json' -d '{"ids":["id1","id2"]}'
curl -X DELETE http://127.0.0.1:8787/queue/<id>
```

### Webhooks

```bash
curl http://127.0.0.1:8787/webhooks
curl -X POST http://127.0.0.1:8787/webhooks -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/myth","events":["capture.created","task.created"],"secret":"whsec_123"}'
# events default to ["*"]; known: snapshot.updated, capture.created, task.created, memory.created
curl -X POST http://127.0.0.1:8787/webhooks/<id>/test           # sends a "ping" delivery
curl -X DELETE http://127.0.0.1:8787/webhooks/<id>
```

Deliveries are `POST` with a JSON body, fire-and-forget, 5 s timeout; failures are logged
on the bridge's stdout and counted on the webhook (`deliveries`, `failures`, `lastStatus`,
`lastError`) but never block the API response.

```http
POST /myth HTTP/1.1
Content-Type: application/json
X-Myth-Event: capture.created
X-Myth-Delivery: 3f1c…            (unique per delivery)
X-Myth-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with your secret>

{"event":"capture.created","at":"2026-08-27T09:12:00.000Z","data":{"id":"…","type":"capture","text":"…","source":"api","at":"…"}}
```

`snapshot.updated` carries `{ receivedAt, exportedAt, counts }` (not the whole snapshot —
fetch `/snapshot` if you need it).

Verify a signature (Node):

```js
import crypto from 'node:crypto';
export function verifyMyth(rawBody, signatureHeader, secret) {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected), b = Buffer.from(signatureHeader ?? '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### Errors

`400` bad input, `401` missing/wrong key, `404` unknown route or id, `405` wrong method
(with `Allow`), `413` body too large — always `{"ok":false,"error":"…"}`. CORS is open
(`Access-Control-Allow-Origin: <origin>`), with `OPTIONS` preflight handled, so the Myth
web app can call it from any dev/preview origin.

## MCP (Claude Desktop, Claude Code, Cursor …)

`bridge/mcp.mjs` speaks MCP over stdio (JSON-RPC 2.0, protocol `2024-11-05`) and talks
to the bridge over HTTP. Keep `npm run bridge` running, then point your client at it.

**Claude Desktop** (`claude_desktop_config.json`) / **Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "myth": {
      "command": "node",
      "args": ["F:/Myth/myth/bridge/mcp.mjs"],
      "env": { "MYTH_BRIDGE_URL": "http://127.0.0.1:8787", "MYTH_BRIDGE_KEY": "change-me" }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add myth -e MYTH_BRIDGE_URL=http://127.0.0.1:8787 -e MYTH_BRIDGE_KEY=change-me -- node "F:/Myth/myth/bridge/mcp.mjs"
```

Use the absolute path to *your* checkout. The server logs to stderr only; stdout is the
protocol.

### Tools

| Tool                 | Input                                   | What it does                                            |
| -------------------- | --------------------------------------- | ------------------------------------------------------- |
| `myth_health`        | —                                       | bridge reachable? last sync? queue size?                |
| `myth_capture`       | `text`, `source?`                       | free text → Inbox (Myth classifies it)                  |
| `myth_add_task`      | `title`, `due?`, `priority?`, `project?`| structured task → Inbox                                 |
| `myth_remember`      | `text`, `kind?`                         | long-term memory → app                                  |
| `myth_list_tasks`    | `status?`, `project?`                   | tasks from the snapshot                                 |
| `myth_list_projects` | —                                       | projects with health numbers                            |
| `myth_calendar`      | `from?`, `to?`                          | events, meeting notes, planned blocks, due tasks        |
| `myth_people`        | —                                       | people graph                                            |
| `myth_commitments`   | `status?`                               | promises made and owed                                  |
| `myth_goals`         | —                                       | goals, key results, linked projects                     |
| `myth_context`       | `query`                                 | everything about a topic / project / person             |

Every result is `{ content: [{ type: "text", text: "<readable summary>\n\n<JSON>" }] }`;
failures come back with `isError: true` instead of crashing the session.

### Example prompts

- *"Create a task in Myth from this GitHub issue: &lt;paste&gt; — due Friday, project Website Redesign."*
- *"Add today's development work to Myth as a note: we shipped the login fix and started on the hero image."*
- *"What projects are at risk?"* — the assistant calls `myth_list_projects` and reasons over
  overdue counts, deadlines and stalled milestones (Myth's own Project Health lives in the app).
- *"What did I promise Ravi, and when do I see him next?"* → `myth_context` + `myth_calendar`.
- *"Remember that I prefer deep work before 11."* → `myth_remember` (kind `preference`).

## Automations

### GitHub Actions: new issue → Myth Inbox

Runs on a self-hosted runner that can reach the bridge (or a tunnel / reverse-proxied HTTPS
URL — see Security). Store the key as `MYTH_BRIDGE_KEY` in repository secrets.

```yaml
name: Issue → Myth
on:
  issues:
    types: [opened]
jobs:
  capture:
    runs-on: self-hosted
    steps:
      - name: Send to Myth
        env:
          MYTH_URL: http://127.0.0.1:8787
          MYTH_KEY: ${{ secrets.MYTH_BRIDGE_KEY }}
          TITLE: ${{ github.event.issue.title }}
          URL: ${{ github.event.issue.html_url }}
          REPO: ${{ github.repository }}
        run: |
          jq -n --arg text "Triage GitHub issue: $TITLE ($URL)" --arg source "github:$REPO" \
             '{text:$text, source:$source}' \
          | curl -sS -X POST "$MYTH_URL/capture" -H "Content-Type: application/json" -H "X-Myth-Key: $MYTH_KEY" -d @-
```

### Receive Myth webhooks (Node, 12 lines)

```js
import http from 'node:http';
import { verifyMyth } from './verify.js';
http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
    if (!verifyMyth(raw, req.headers['x-myth-signature'], process.env.MYTH_WEBHOOK_SECRET)) { res.writeHead(401); return res.end(); }
    const { event, at, data } = JSON.parse(raw);
    console.log(event, at, data.text ?? data.counts);
    res.writeHead(204); res.end();
  });
}).listen(9000);
```

Register it: `curl -X POST …/webhooks -d '{"url":"http://127.0.0.1:9000/","secret":"<same secret>"}'`.

## Security notes

- The bridge binds to **127.0.0.1** — only processes on your machine can reach it. Keep
  it that way unless you need LAN access (`MYTH_BRIDGE_HOST=0.0.0.0`), and then **set a key**.
- `MYTH_BRIDGE_KEY` is compared in constant time and accepted as `X-Myth-Key: <key>` or
  `Authorization: Bearer <key>`. `/health` is always open (it reveals only counts).
- The snapshot never contains `chat`, `chatHistory`, `authed`, `settings.aiKey`,
  `settings.bridgeKey`, or base64 blobs from Drive/files (they are stripped twice: in the
  app before sending and again on the server).
- If you expose it beyond localhost, put it behind a reverse proxy with **HTTPS** (Caddy,
  nginx, Cloudflare Tunnel, Tailscale Funnel) — the bridge itself speaks plain HTTP.
- Webhook subscribers should verify `X-Myth-Signature`. Secrets are stored in
  `bridge/data/webhooks.json` and never returned by the API (`hasSecret: true` only).
- `bridge/data/` is your data — it's git-ignored (only `.gitkeep` is tracked). Delete the
  folder to wipe the bridge; the app keeps its own copy.
- Writes are atomic (temp file + rename), so a crash mid-write cannot corrupt the store.

## Roadmap

Gmail, Slack, Google Calendar, WhatsApp exports, browser clippers — every integration is
the same three lines: read the source, `POST /capture` with a `source`, let the Inbox do the
rest. Webhook events make the reverse direction (Myth → your tools) just as small. Later:
a `/sync` diff endpoint so the app can push incremental changes, and per-collection
scopes on keys.
