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
│   │   └── spark.js            # the fresh greeting line on every open
│   ├── components/
│   │   ├── panels/             # one file per dock module (tasks, finance, …)
│   │   └── *.jsx               # Shell, TopBar, CaptureBar, Dock, Widgets, …
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
below the bar. Click the sparkle icon to force Ask mode. Suffix `!w` / `!p` to force
Work / Personal mode.

---

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

---

## Stack

React 19 · Vite 8 (rolldown) · Mantine 9 · zustand · dayjs + chrono-node ·
framer-motion · recharts · Web Speech API · Ollama for local AI.
