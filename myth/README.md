# Myth — Personal OS

A single-page personal management platform. No sidebar tabs — one landing page with a
capture bar that sorts everything you type or speak into the right place, and a private
AI assistant that runs entirely on your own machine.

---

## What's new — the intelligence layer

Myth now has a Context Engine, a Life Command Center, an agent that prepares your meetings, morning/evening
briefings, energy-aware auto-planning, Focus mode, a Life Inbox with confidence-gated AI, people & promise
memory, goals, a life timeline, Ask-My-Life, analytics, a monthly life story, a Privacy Center and an
API/MCP bridge. Read [docs/INTELLIGENCE-LAYER.md](docs/INTELLIGENCE-LAYER.md).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Lock-screen password: `mukilx` (change it — see [Configuration](#configuration)).

**AI answers work out of the box** — with nothing configured, Myth auto-connects to
local Ollama when it's running (private), otherwise to the free keyless
[LLM7](https://llm7.io) cloud. No account, no API key, no cost.

Want a specific provider instead? In *Settings → AI brain* pick one and paste a free
API key (2-minute signup, no credit card):

| Provider | Free key | Models |
|---|---|---|
| **LLM7** (default, no key needed) | optional: [token.llm7.io](https://token.llm7.io) | GPT-OSS 20B, Gemma 4 31B, Mistral… |
| **Groq** (recommended, fastest) | [console.groq.com/keys](https://console.groq.com/keys) | Llama 3.3 70B, GPT-OSS 120B… |
| **OpenRouter** | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | NVIDIA Nemotron, GPT-OSS, Gemma (":free" models) |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Gemini 2.5 Flash |

**Local (private, offline — this device only)** — install [Ollama](https://ollama.com) and pull a model:

```bash
ollama pull llama3.2      # 3B — fast on CPU
ollama pull llama3.1:8b   # 8B — better answers, slower
```

The app auto-detects Ollama on `localhost:11434`. Nothing to configure.

---

## Project structure

```
myth/
├── public/                     # served verbatim at the site root
│   ├── Myth face logo.png      # master brand artwork (source of all icons below)
│   ├── logo.png                # face logo 512px — top bar, lock screen, splash
│   ├── logo-white.png          # face logo for solid/light backgrounds
│   ├── logo-icon.png           # face logo 256px — favicon, notifications
│   ├── icon-192.png            # PWA / home-screen icons
│   ├── icon-512.png
│   ├── manifest.webmanifest    # installable-app metadata
│   ├── robots.txt              # noindex — this is a private app
│   └── bg-*.jpg                # background photography
│
├── src/
│   ├── ai/                     # all intelligence lives here
│   │   ├── ollama.js           # transport: detect, rank models, stream, warm-up
│   │   ├── assistant.js        # prompts, live-data context, offline fallback brain
│   │   ├── parser.js           # natural-language capture → tasks/events/expenses
│   │   ├── insights.js         # month stats + narrative report generation
│   │   ├── commandCenter.js    # home-screen brain: attention, timeline, focus-block plan
│   │   ├── projectPlanner.js   # automatic project creation: intent → milestones → proposal
│   │   └── spark.js            # curated one-liners (used by the assistant's openers)
│   ├── components/
│   │   ├── panels/             # one file per dock module (tasks, finance, …)
│   │   ├── CommandCenter.jsx   # the home screen: hero, three decision cards, triage
│   │   ├── ProjectProposal.jsx # "I drafted a plan — Create project?" confirmation sheet
│   │   └── *.jsx               # Shell, TopBar, CaptureBar, Dock, …
│   ├── config/
│   │   └── env.js              # every tunable value, read from VITE_* at build time
│   ├── store/
│   │   ├── useStore.js         # zustand + persist — the whole data model
│   │   ├── fileStore.js        # uploaded file blobs (IndexedDB)
│   │   └── seed.js             # first-run demo dataset
│   ├── cloud/
│   │   └── netlify.js          # browser side of cloud sync — talks to /api/cloud
│   ├── App.jsx  main.jsx  theme.js  icons.js  notify.js  styles.css
│
├── netlify/
│   ├── functions/
│   │   ├── cloud.mjs           # cloud storage API in front of Netlify Blobs (/api/cloud/*)
│   │   └── push-digest-*.mjs   # scheduled background-push digests (8:30 AM / 7 PM IST)
│   └── lib/                    # sync-key auth, blob layout, reminder rules
│
├── deploy/
│   ├── Dockerfile              # multi-stage: node build → nginx runtime
│   └── nginx.conf              # SPA fallback, cache headers, gzip
│
├── .github/workflows/
│   └── deploy-pages.yml        # build + publish to GitHub Pages
│
├── docker-compose.yml          # app + Ollama, one command
├── netlify.toml                # Netlify build + SPA redirects + headers
├── vercel.json                 # Vercel equivalent
├── .env.example                # copy to .env.local
└── vite.config.js              # base path, vendor chunk splitting
```

---

## Configuration

Copy `.env.example` to `.env.local` for local dev, or set the same keys in your host's
build-environment settings. Vite **inlines these at build time**, so they are baked into
the JavaScript bundle — treat every one of them as public.

| Variable | Default | What it does |
|---|---|---|
| `VITE_APP_NAME` | `Myth` | Name in the lock screen and notifications |
| `VITE_APP_PASSWORD` | `mukilx` | Lock-screen password |
| `VITE_AI_ENDPOINT` | `http://localhost:11434/v1` | Any OpenAI-compatible endpoint |
| `VITE_AI_MODEL` | *(empty)* | Preferred model; empty auto-picks the best installed |
| `VITE_AI_WARMUP` | `true` | Keep the model in RAM so answers start in ~1s |
| `VITE_BASE` | `/` | Subpath, for GitHub Pages project sites only |

> **The password is a convenience lock, not security.** It ships in plain text inside the
> bundle and anyone can read it with devtools. Never put data on a public URL that you
> would mind a stranger seeing. All data stays in the visitor's own browser, so a public
> deployment exposes the *app*, not your content.

---

## Deploying

### Docker — app + AI together (recommended for a home server / LAN)

```bash
docker compose up -d --build
docker compose exec ollama ollama pull llama3.2
```

App on <http://localhost:8080>, Ollama on `:11434`. Models persist in a named volume, and
`OLLAMA_KEEP_ALIVE=1h` keeps the model resident so the first question is fast.

Override config without editing files:

```bash
APP_PASSWORD=my-secret AI_MODEL=llama3.1:8b docker compose up -d --build
```

### Docker — app only

```bash
docker build -f deploy/Dockerfile -t myth \
  --build-arg VITE_APP_PASSWORD=my-secret .
docker run -d -p 8080:80 --name myth myth
```

### Netlify / Vercel

Push to Git and import the repo. `netlify.toml` / `vercel.json` already set the build
command, publish directory, SPA rewrites and cache headers. Add your `VITE_*` values in
the host's environment-variables UI, then redeploy so they get baked in.

Netlify is the recommended host: it also runs the cloud-storage functions and the
scheduled push digests — see [Cloud storage & sync](#cloud-storage--sync-free-optional).
On Vercel or any other host the app still works, but with the browser as its only storage.

### GitHub Pages

Enable Pages → Source: **GitHub Actions**. The included workflow builds on every push to
`main`, sets `VITE_BASE` to your repo name automatically, copies `index.html` to
`404.html` for SPA routing, and publishes. Put the password in a repo secret named
`APP_PASSWORD`.

### Static host / any web server

```bash
npm run build      # → dist/
npm run preview    # verify the production build locally on :4173
```

Upload `dist/`. The only server requirement is a **SPA fallback**: serve `index.html` for
unknown paths.

---

## Cloud storage & sync (free, optional)

By default everything lives in the browser. To add real cloud storage — platform data
backup, project document files, and moving between devices — Myth uses the Netlify site's
own storage, [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/),
through two small serverless functions in [`netlify/functions/`](netlify/functions/).
It is part of Netlify's Free plan: no second account, no credit card. One-time setup:

1. Deploy the app on Netlify (Git import — see [Deploying](#netlify--vercel)).
2. In Netlify: **Site configuration → Environment variables → Add a variable**:
   `MYTH_SYNC_KEY` = a long passphrase you invent (12+ characters; this is the only thing
   guarding your data, so make it a real passphrase). To let several people share one site,
   separate several keys with commas — each key gets its own private space.
3. **Deploys → Trigger deploy** (environment variables only reach new deploys).
4. Open the app from its Netlify address: **Settings → Cloud storage & sync** → paste the
   same passphrase → **Connect**.

Then use **Upload to cloud** after working, and **Download to this device** on any other
device (or after a browser wipe). Uploaded project documents ride along automatically, and
the app quietly backs itself up once a day while a key is set.

How it holds up: the sync key never ships in the bundle (it is not a `VITE_*` value) — it
lives in Netlify's environment and in each device's own settings. Objects are stored under
a namespace derived from a hash of the key, so the key itself is never written anywhere.
Large documents travel in 4 MB parts because a Netlify Function carries at most 6 MB per
request. There is no fixed storage cap on the Free plan; storage and transfer draw on its
300 monthly credits (about 15 GB of bandwidth).

**Running the app somewhere else** (Vite dev server, Docker, GitHub Pages)? The cloud API
only exists on Netlify, so either run `npm run dev:cloud` (Netlify CLI: Vite + functions
+ a local Blobs sandbox on <http://localhost:8888>) or set **Site URL** in the same Settings
card to your Netlify address — the functions accept cross-origin calls.

---

## The AI in production — read this before deploying publicly

The browser calls the AI endpoint **directly**. The web server never touches it.

**For a deployed app, use a free cloud provider** (Groq / OpenRouter / Gemini — see
[Quick start](#quick-start)): they work from any device, over HTTPS, with a free key each
user pastes once in Settings → AI brain. The notes below only matter if you insist on
local Ollama:

1. **`localhost` means the visitor's machine**, not your server. Each person who opens the
   app needs their own Ollama running, or you must point `VITE_AI_ENDPOINT` at a
   reachable shared endpoint.
2. **CORS.** Ollama only answers browsers whose origin it trusts. Set `OLLAMA_ORIGINS` to
   the address you open the app from — the compose file does this already:
   ```bash
   OLLAMA_ORIGINS="http://localhost:8080,https://your-app.example.com"
   ```
3. **HTTPS → `http://localhost` is mixed content.** A site served over HTTPS may be
   blocked from calling a plain-HTTP local endpoint, depending on the browser. Serving
   the app over plain HTTP on your LAN, or putting the AI endpoint behind HTTPS too,
   avoids the problem entirely.

If the AI is unreachable, nothing breaks: the assistant falls back to its offline brain,
which answers questions about tasks, priorities, reports, habits and spending without any
model at all.

---

## The home screen — Life Command Center

The landing page does not list modules; it answers **"what matters right now?"**

```
GOOD AFTERNOON, BOSS
Your day is 64% complete            5 of 8 commitments done · 2.5 hours of focus time left

NEEDS ATTENTION          TODAY                       MYTH SAYS
Submit proposal          09:30  Client meeting        "You have 2.5 hours of focused time
  due today              11:00  Focus — Proposal       left. I'd finish 'Submit proposal'
Expense report           13:00  Lunch                  before starting anything new."
  3 days overdue         ——— 14:00 ———                11:00–12:00  Submit proposal
[Handle these]           15:30  Review GIS project     16:00–16:45  Expense report
                         18:30  Gym                    [Follow Myth's plan]
```

- **Day progress** counts today's commitments — tasks due by today, plan pills, habits and
  timed events — and how many are already done or behind you.
- **Needs attention** ranks overdue tasks, things due today, blocked tasks, meetings starting
  within 90 minutes, bills, project deadlines and (after 6 pm) habits still open.
  **Handle these** opens a triage sheet where each item is decided on the spot: done, start
  now, move to tomorrow / next week, tick the habit, mark the bill paid.
- **Today** is the clock view: events, meetings and focus blocks with a live now-marker.
- **Myth says** looks at the free gaps between your events until 9 pm, ranks open tasks
  (overdue → due today → in progress → high priority), fits up to four focus blocks into
  those gaps and explains the order in one line. **Follow Myth's plan** writes the blocks
  onto today's calendar (kind `focus`, linked to the task), marks the first task *doing*
  and mirrors them into today's plan pills. When a model is reachable it rephrases the line
  in its own voice; the schedule itself never depends on the AI.

The assistant reads the same data: ask *"what matters right now?"*, say *"follow the plan"*
or *"clear the plan"* in the capture bar. The logic is pure (`src/ai/commandCenter.js`) and
covered by `npm test`.

---

## MITH NOW — "What should I do now?"

The big button under the greeting is real-time decision support. It measures the minutes
until the next thing on the clock, picks the one task that best fits that window and fills
what is left with quick wins:

```
MITH NOW                                   2:03 PM
You have 47 minutes before your next meeting.
  Meeting: Design review at 2:50 PM                 [Prep]

MITH RECOMMENDS
  BEST USE OF THIS TIME                    Estimated
  Finish Project X task                      35 min
  Client Dashboard · due today
  [Start now · 35 min]  [Already done]  [Not this one]

  THEN
  12 minutes remaining.
  ✓ Quick win  Reply to 2 pending messages    10 min

  ✨ "Boss, the dashboard task is due today and fits cleanly; the twelve
      minutes after are enough to clear the two replies."   llama-3.3-70b
  OR INSTEAD  [Wireframes for reports 60m] [Book dentist 15m] …
```

- **The window** (`currentWindow`) is measured to the next timed event or meeting, minus a
  3-minute buffer; inside an event it starts when that event ends; with nothing on the
  clock it runs until 9 pm.
- **Best use** ranks open tasks — overdue, due today/tomorrow, in progress, priority — and
  prefers the highest-ranked one whose estimate fits. If nothing fits, the top task is
  offered as a *partial* sprint ("make a dent in"). Under 10 minutes only quick wins are shown.
- **Quick wins** (≤ 15 min each, up to three) come from small tasks, today's plan pills,
  unresolved action items for meetings in the next two days, meetings that still need a
  follow-up and (after noon) habits still open. Each has a one-tap tick.
- **Start now** creates a focus block on today's calendar linked to the task, marks it
  *doing* and starts a countdown in the sheet (and in the button itself). **Done** completes
  the task; **Stop** keeps it open and trims the block to the time actually used.
- **It learns.** Mith keeps a small model of your behaviour (`nowLearn`, persisted):
  suggestions you skip are demoted (strongly for the rest of the day), projects you start
  work on at a given hour get a boost at that hour, and the real duration of every sprint
  you finish calibrates future estimates for tasks of that priority (an exponential moving
  average per priority bucket). An explicit estimate on a task always wins.
- **The model gets a second look.** When an AI is reachable, the rule-based answer is sent
  as a decision brief (window, pick, alternatives, quick wins — no private contents). The
  model may keep the pick or swap in one of the listed alternatives, and writes one line
  explaining the call. Anything outside the candidate list is ignored, so the model can
  steer but never invent work. Offline, the rule-based answer stands on its own.

Ask the assistant *"what should I do now?"* for the same answer in text. The engine is pure
(`src/ai/mithNow.js`) and covered by `scripts/mithNow.test.mjs`.

---

## Automatic project creation

Say what you're setting out to do and Myth turns it into a project — but asks first.

```
You:   I need to launch my portfolio website next month.

Myth:  I drafted a plan for "Portfolio Website" — 6 milestones, 25 tasks, finishing Sat, Oct 31

       1. Research      4 tasks   by Sep 14
       2. Content       4 tasks   by Sep 24
       3. Design        4 tasks   by Oct 4
       4. Development   5 tasks   by Oct 21
       5. Testing       4 tasks   by Oct 28
       6. Launch        4 tasks   by Oct 31

       Nothing is created yet.            [Not now]  [Create project]
```

- **Detection** looks for an undertaking, not an errand: an intention opener ("I need to",
  "I want to", "let's", "help me"), a verb like *launch / build / organise / renovate /
  write / start*, and a deliverable (website, app, wedding, bakery, book, trip, exam, job,
  marathon…). "Buy milk tomorrow" and "finish the report by Friday" stay ordinary tasks.
  Explicit forms work too: `new project: Acme dashboard redesign`, `project: bakery`.
- **Deadline** comes from the sentence — *next month* means the end of next month, *in
  December* the end of December, *by end of year*, *in 6 weeks*, *by Oct 15*. Without one,
  the template's horizon is assumed and the sheet says so.
- **The plan** comes from a template for the kind of project (website, event, writing,
  business, home, learning, travel, campaign, career, fitness, generic): 5-6 milestones
  with 3-5 tasks each, spread across the runway so every task has a due date and the last
  milestone lands on the deadline. When a model is reachable it tailors the task names to
  your specific project in the background; the schedule never depends on it.
- **Ask before creating 30 tasks.** The proposal sheet lets you rename the project, move
  the deadline (everything reschedules), untick tasks or whole milestones, then press
  **Create project**. Only then are the project, its milestones and the ticked tasks
  written. In chat, *"create project"* or *"yes"* confirms, *"discard the proposal"* drops it.

Logic lives in `src/ai/projectPlanner.js` (pure, covered by `npm test`); the sheet is
`src/components/ProjectProposal.jsx`.

---

## Myth Planner (compass icon at the right end of the dock)

One chat, many kinds of plans. Type a sentence; the Planner works out the **mode** and opens
the right sheet. Every plan moves **draft → planned → confirmed → live**.

**Trip mode** — `Trip from Chennai to Goa 20–24 Dec for 2, budget 30k, relaxed`

- The sentence fills the form (from, to, dates, travellers, budget, style, transport); edit
  anything, then **Plan**. The engine geocodes both places, routes them (OSRM), pulls the
  forecast for the dates (Open-Meteo, 16 days ahead), finds sights, restaurants and stays
  around the destination and fuel stations along the route (OpenStreetMap via Overpass) —
  all free, keyless services called straight from the browser.
- You get several itineraries — *Classic highlights*, *Slow & easy*, *Explorer*, *Budget
  saver* (the style you asked for comes first) — each a day-by-day schedule built from real
  places: departure, fuel stops, arrival and check-in, sights per day (indoor first on rainy
  days), lunch and dinner picks, the drive home. Plus a map, a budget estimate (fuel/tolls or
  tickets, stays, food, activities) against your budget, stays and restaurants with
  navigate links, and a packing list driven by the forecast. When a model is reachable it
  re-orders the days using only the places found; the plan never depends on it.
- **Confirm this plan** creates a project *Trip: Goa* (pre-trip checklist, one milestone per
  day, an after-trip wrap-up) and one calendar entry per trip day. Asked first, as always.
- **Start trip — go live** turns on location: it follows the device (or a typed place when
  there is no GPS), shows where you are, the weather now and the next hours, what is nearby
  in tabs — fuel, food, stays, hospitals/pharmacies, ATMs — with distance, direction and a
  navigate link, your progress along the route with km remaining and the next fuel stop,
  today's itinerary as tick boxes, a check-in log, and a "Myth says" strip of advice that
  updates as you move: rain coming, lunch spots at lunchtime, the nearest stay after dark.

**Other modes** — event, study/exam, fitness, business, website, writing, home, career:
the sentence becomes a dated milestone plan (tailored by the model when available) with
mode extras — a study-hours budget per phase, an event budget split, a training week —
**Confirm** creates the project, **Go live** shows what the plan asks of you today.

Inside a session the chat edits the plan: *"make it 3 people"*, *"budget 40k"*, *"relaxed"*,
*"start trip"*, *"I'm at Tindivanam"*, *"end trip"*. Logic: `src/ai/planner.js` (pure,
tested), `src/ai/geo.js` (services), `src/ai/tripEngine.js` (orchestration).

---

## How capture works

Type (or tap the mic and speak) into the landing bar:

| You type | What happens |
|---|---|
| `Design review with client tomorrow 3pm` | Meeting note + calendar event |
| `Renew insurance by friday urgent` | Task, due Friday, priority 5 |
| `idea: dark mode for reports` | Saved to the idea vault |
| `spent 250 on lunch` | Expense under Food |
| `received 85000 salary` | Income entry |
| `habit: morning walk` | New tracked habit |
| `Amma's birthday June 12` | Yearly birthday reminder |
| `What's overdue?` | Answered inline by Myth AI |

Anything phrased as a question or request goes to the assistant and streams its answer
below the bar. Click the sparkle icon to force Ask mode. Work and personal share one
flow — there is no mode to switch.

---

## Context Engine — the Life Context Graph

Tasks, calendar, notes, finance and the rest are not separate silos. Underneath them
`src/ai/context.js` builds a **Life Context Graph**: every project, task, note, meeting,
event, file, drive item and person is a node; project links, schedule matches, people
mentions and keyword overlap are the edges. Any item can be explained through everything
connected to it — most usefully a meeting.

Capture `Client meeting tomorrow 10am at Acme office with Ravi` and Myth understands:

* Meeting → project *Client Dashboard Redesign* (named in the title, or linked by you)
* Project → its open tasks
* Meeting → related notes and documents (Drive links, project files)
* Ravi → previous meetings, and the action items they left unresolved
* Tomorrow morning → a leave-by time for an on-site meeting
* After the meeting → whether a follow-up task exists yet

…and says so before you ask:

> **Tomorrow's client meeting (10:00)**
> You have 4 open tasks related to "Client Dashboard Redesign".
> 2 documents were referenced previously.
> Last meeting (Tuesday) left 3 unresolved action items.
> Leave by 09:20 — allow ~40 min travel to Acme office.
> **Prepare for meeting →**

| Where | What you get |
|---|---|
| Landing page strip | The next briefing, one tap from the full prep view |
| Context engine panel (brain icon) | Tick action items, turn them into tasks, block travel on that day's plan, add a follow-up task, generate a prep note. Search any project, person or note to see its connections |
| Daily planner | Each meeting today shows its counts and a **Prep** button |
| Reminders bell | "Prep: …" up to two days before a meeting with open items, and "No follow-up yet" after one |
| Myth AI | "Prepare me for tomorrow's meeting", "context for Client Dashboard", "add follow-up task" |

Action items live one per line in a meeting note's *Action items* box; a `[x]` prefix marks one resolved.

## Smart notifications — the Notification Intelligence Engine

Myth does not send "Task due tomorrow". `src/ai/notifications.js` reasons over the same
live data as the Command Center and the Context Engine, and only speaks when it can say why:

> **You should handle this today.**
> Proposal is due tomorrow and needs ~2 hours.
> Your calendar is already full tomorrow (3 meetings).
> You have 3 hours free today — the 14:00–16:00 slot fits it.
> **Block 14:00–16:00 today →**

What it reasons about: a task due tomorrow that tomorrow cannot absorb (estimate vs. free
time, with a slot today), a day that is overbooked (and which tasks to move), overdue work
as one notification instead of one per task, a project deadline the remaining free time
cannot cover, meeting prep and leave-by times (Context Engine), a meeting with no follow-up,
bills with what they cost last time, habit streaks that end at midnight, a birthday with
nothing planned, work stuck "in progress", and a morning with no plan.

**No spam, by policy** (`selectForDelivery`): quiet hours (default 22:00–07:00), a
lock-screen budget per day (default 4), at most two per check, "fyi" items only around
8:30 / 13:00 / 18:30, and never the same situation twice unless it changed or got worse.
Every notification carries an action (block time, move tasks, add a follow-up, prepare…),
plus snooze (until tomorrow 08:00) and dismiss (comes back only if the situation changes).

| Where | What you get |
|---|---|
| Bell (top right) | Every notification with its reasoning and its action, snooze, dismiss |
| Lock screen / system | Only what passes the delivery policy, through the service worker |
| Background push | The scheduled digest (`netlify/lib/digest.mjs`) runs the same engine on your synced data |
| Settings → Notification intelligence | Daily budget, quiet hours, and a live preview of what Myth would say now |
| Myth AI | "What should I handle today?", "anything urgent?", "why did I get that notification?" |

## Storage & backups

Everything is local to the browser: structured data in `localStorage` (zustand persist),
uploaded files in IndexedDB. **Nothing is sent to a server.** Settings → Export writes a
full JSON backup; Import restores it. First run seeds a demo dataset — delete what you
don't want.

Because storage is per-browser, deploying to a URL does not sync data between devices.

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm run lint` | oxlint over `src/` |
| `npm test` | Unit tests for the Command Center logic (node:test) |

---

## Stack

React 19 · Vite 8 (rolldown) · Mantine 9 · zustand · dayjs + chrono-node ·
framer-motion · recharts · Web Speech API · Ollama for local AI.
