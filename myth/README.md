# Myth — Personal OS

A single-page personal management platform. No sidebar tabs — one landing page with a
home bar where Myth AI sorts everything you type or speak into the right place, answers
questions and acts on your data, and a Planner one tab away.

---

## What's new — two tabs on the home bar, Myth AI everywhere, a Planner that researches

**The home bar has two tabs.** Two folder-style tabs rest on the bar — Myth AI and Planner — the
active one filled with its mode's colour and running straight into the bar. Press `Ctrl+.` to flip,
or type `/chat`, `/plan` or `/trip` straight into the bar. There is no separate Capture mode any
more: Myth AI does the sorting itself, and today's plan lives inside the Myth AI box under the bar.

| Mode | What typing does |
|---|---|
| **Myth AI** | Plain sentences get sorted into tasks, meetings, money, habits, ideas…; questions get answers; instructions get done (below). Paperclip / paste / drop to hand it files. The box under the bar carries today's plan pills and the conversation, over a living animated backdrop. |
| **Planner** | Myth Planner lives here now. A strip of plan types — trip, event, study, fitness, food & diet, money goal, business, website, writing, home, career, routine, anything — each with a short form (the trip one has From / To place autocomplete: type "ko" and pick Kodaikanal) and one-tap examples. The plan opens right under the bar; short follow-ups typed in the bar edit it ("budget 40k", "move it to March", "start trip"). |

Every non-trip plan gets a dated milestone schedule **plus a playbook for that kind of plan**: an
offline widget that works with no model (a training week sized to your sessions and level, a 7-day
Indian meal rotation for the diet and goal, a month-by-month savings schedule against your income, a
study-hours budget, an event budget split with per-head cost, an hour-by-hour routine day) and, from the
planner brain, mode-specific sections — weekly syllabus tables, mock-test schedules, grocery lists,
vendor checklists and run-of-show, startup costs, sitemaps and launch checklists, skills-gap tables,
habit stacks — rendered as lists, tickable checklists, tables and schedules
([`src/ai/planGuide.js`](src/ai/planGuide.js)).

**Myth AI can do everything in the platform, from anywhere.** A floating Myth button follows you into
every module on desktop (`Ctrl+J`; phones use the centre tab). Ask, or tell it what to do — it runs real
actions and reports each one with a ✅ line:

- "Add task pay rent on the 1st", "log 250 for lunch", "habit: read 20 pages", "meeting with Ravi Friday 3pm"
- Hand it a PDF and say **"add this file to learning"** — the file lands on a Learning card (with its notes),
  or "…to project Acme", "…to drive", "…to notes"
- **"Make a cheat sheet on SQL joins and add it to learning"** — it writes the document and saves it as a
  real file (PDF, Markdown, text, CSV, HTML or JSON) where you asked
- "Create project portfolio website with a plan", "move React hooks to applied", "plan a trip to Goa in Dec"

The model asks for actions with a small fenced block at the end of its answer (see
[`src/ai/actions.js`](src/ai/actions.js) for the catalogue); the everyday file sentences also work with no
model at all. Learning cards now hold notes, attached files and links, with an "ask Myth for a study
sheet" button on each.

**Myth Planner researches the destination.** A trip now comes back with every road option (OSRM
alternatives, named by highway), every way to get there with time and cost, areas to stay in, stays across
budget / mid / luxury, must-sees and hidden gems, what to eat, events around your dates, tips — plus
itineraries for all seven styles and several themed ones (nature, heritage, food…), each with a map link
per stop. The research runs on the model: paste an OpenAI key in **Settings → Planner search brain** to
use ChatGPT for it (the everyday chat can stay on a free provider), or leave it empty to use the AI brain.
OpenAI is also available as a regular provider in **Settings → AI brain**.

## What's new — the intelligence layer

Myth has a Life Command Center, morning/evening briefings, energy-aware auto-planning, a Life Inbox with
confidence-gated AI, goals, a life timeline, Ask-My-Life, analytics, a monthly life story, a Privacy Center
and an API/MCP bridge. Read [docs/INTELLIGENCE-LAYER.md](docs/INTELLIGENCE-LAYER.md). Meetings are plain
calendar entries — "client meeting tomorrow 10am at Acme with Ravi" lands on the calendar with the place
and the people, and that is all; there is no separate meeting-prep or context feature.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Lock-screen password: `mukilx` (change it — see [Configuration](#configuration)).

**AI answers work out of the box** — with nothing configured, Myth auto-connects to the
free keyless [LLM7](https://llm7.io) cloud. No account, no API key, no cost.

Want a specific provider instead? In *Settings → AI brain* pick one and paste a free
API key (2-minute signup, no credit card):

| Provider | Free key | Models |
|---|---|---|
| **LLM7** (default, no key needed) | optional: [token.llm7.io](https://token.llm7.io) | GPT-OSS 20B, Gemma 4 31B, Mistral… |
| **Groq** (recommended, fastest) | [console.groq.com/keys](https://console.groq.com/keys) | Llama 3.3 70B, GPT-OSS 120B… |
| **OpenRouter** | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | NVIDIA Nemotron, GPT-OSS, Gemma (":free" models) |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Gemini 2.5 Flash |

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
│   │   ├── llm.js              # transport: detect, rank models, stream
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
├── docker-compose.yml          # the app in a container, one command
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
| `VITE_AI_ENDPOINT` | `https://api.llm7.io/v1` | Any OpenAI-compatible endpoint (free LLM7 by default) |
| `VITE_AI_MODEL` | *(empty)* | Preferred model; empty auto-picks the best available |
| `VITE_BASE` | `/` | Subpath, for GitHub Pages project sites only |

> **The password is a convenience lock, not security.** It ships in plain text inside the
> bundle and anyone can read it with devtools. Never put data on a public URL that you
> would mind a stranger seeing. All data stays in the visitor's own browser, so a public
> deployment exposes the *app*, not your content.

---

## Deploying

### Docker Compose (recommended for a home server / LAN)

```bash
docker compose up -d --build
```

App on <http://localhost:8080>. AI answers come from the free cloud provider chosen in
Settings → AI brain (LLM7 by default, no key needed).

Override config without editing files:

```bash
APP_PASSWORD=my-secret AI_ENDPOINT=https://api.groq.com/openai/v1 docker compose up -d --build
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

From then on **sync is automatic**: every change is pushed within a few seconds, and each
device pulls the latest copy when it opens, comes back to the front, or every two minutes.
The cloud icon in the top bar shows the state (off, syncing, synced, offline, problem).
Uploaded project documents ride along automatically.

- **Adding a device:** open the app there and paste the passphrase into the banner on the
  home screen, or use **Settings → Copy device link** on a connected device and open that
  link once on the new one — it connects by itself. The link contains the key; keep it to
  yourself.
- **First connection with data on both sides** (this device and the cloud both have items)
  asks which copy to keep; the other is replaced everywhere. Asked once per device.
- **Conflicts:** last write wins per snapshot. Because every device pulls when it comes to
  the front, only two devices editing at the very same minute can lose the earlier edit.
- **Erase:** **Settings → Reset everything** empties this device and the cloud; other devices
  empty on their next open. New installs start empty — there is no demo data.
- **Push now / Pull cloud copy** in Settings remain for manual control.

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

**Use a free cloud provider** (LLM7 by default, or Groq / OpenRouter / Gemini — see
[Quick start](#quick-start)): they work from any device, over HTTPS, with a free key each
user pastes once in Settings → AI brain. If you point `VITE_AI_ENDPOINT` at a custom
OpenAI-compatible server instead, it must allow your app's origin (CORS) and be served
over HTTPS when the app is, or the browser will block the calls.

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

## Myth Daily Brief — the status card

The hero tile on the home screen is a brief that rewrites itself from live data every minute
(`src/ai/dailyBrief.js`):

```
Good morning, Mukil.
Today               7 tasks · 2 meetings · 1 deadline
Your focus          Finish homepage design.
Potential problem   Project X is 2 days behind.
Personal            Electricity bill due tomorrow.
Learning            30 min React practice.
Suggested schedule  09:00 → Deep work — Finish homepage design
                    11:00 → Design review
                    12:00 → Admin & inbox
                    14:00 → Project time
```

- **Today** counts tasks due by today, meetings and events on the calendar, deadlines (projects
  and milestones due today or tomorrow, priority-5 tasks due today) and reminders.
- **Your focus** is what MITH NOW would pick for the current window, else the top "needs
  attention" item, else the highest-priority open task.
- **Potential problem** looks for a project behind the calendar (task progress vs. time
  elapsed, or a slipped milestone), then overdue tasks, an overbooked day, missed reminders, a
  project due tomorrow with open work, and — in the evening — habits not ticked.
- **Personal** reads bills and birthdays due today or tomorrow and personal reminders; with
  none of those it shows the habits still open.
- **Learning** takes the item currently in the "learning" stage (30 minutes, 20 when several
  are active), or invites you to start one from "want to learn".
- **Suggested schedule** merges today's timed events, Myth's focus blocks and — when the
  calendar is nearly empty — a morning deep-work slot, an admin slot at noon and project time
  in the afternoon. Past items are struck through; the current one is highlighted.

Each line opens the module it came from. Myth AI carries the same brief (`DATA.dailyBrief`),
answers "brief me" / "how does my day look" from it offline, and the first open of the day
before noon shows it as a toast.

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

Type (or tap the mic and speak) into the home bar in Myth AI mode:

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

## Reminders — nudges at the right time

*More → Reminders*, or just say it anywhere: **"remind me to call Ravi tomorrow at 5"**,
**"pay rent every 1st"**, **"water the plants every evening"**, **"don't forget the dentist on Friday"**.
The engine (`src/ai/reminders.js`) reads the date, the time and the repeat out of the sentence
and guesses a category (people, money, health, work, errand, home); the panel previews what it
understood before you press *Remind me*.

- **Repeats** — daily, weekdays, weekly (on a named day), monthly (on a day of the month), yearly.
  Marking a repeat done rolls it to its next date and counts the streak; a one-off closes.
- **Snooze** — 10 min, 1 h, 3 h, this evening, tomorrow 09:00, next Monday. Move a reminder
  a day or a week, change its repeat, or edit everything in a small form.
- **Sections** — overdue, today, tomorrow, this week, later; done stays collapsed underneath.
- **Notifications** — a reminder fires as a system notification at its minute, with a *Done*
  action, plus a heads-up 30 minutes before a timed one and a morning rundown when the day
  carries several. Reminders are exempt from the notification budget and the delivery windows;
  quiet hours only hold back the heads-up, never the alarm itself.
- **Myth suggests** — reminders proposed from the rest of your data: a 30-minute heads-up before
  today's meetings, tasks due today or tomorrow, bills and birthdays in the next three days.
  One tap adds them.
- **Myth AI** — the assistant sees every reminder (`DATA.reminders`), answers "what are my
  reminders" / "anything overdue" offline, and can add, complete, snooze, delete and list them
  through actions. "done with the dentist reminder" and "snooze rent for 2 hours" work without
  a model too.

Reminders sync with everything else and show up in the bridge's search.

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
framer-motion · recharts · Web Speech API · free OpenAI-compatible AI providers.
