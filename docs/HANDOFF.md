# InMarket Moments — Project Handoff

## What this project does

**InMarket Moments** is a moment-based advertising intelligence tool. It answers the question: *"Is right now a good time to run ads for this brand category in this city?"*

The system scores the current moment (0–100) by combining live weather conditions, time of day, day of week, and a trend signal derived from the next-hour forecast. A LangChain agent interprets the score and delivers a plain-language **BUY / HOLD / WAIT** recommendation for a media buyer.

**Business context:** Moment-based advertising improves ROAS by activating spend when audience receptivity peaks — coffee ads during a cold rainy morning commute, delivery-food ads on a snowy Friday evening. Rather than relying on static dayparting schedules, InMarket Moments uses real-time conditions to trigger or suppress spend dynamically.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser / Client                    │
└───────────────────┬─────────────────┬───────────────────┘
                    │ POST /api/agent/ │ GET /api/mcp/
                    │ analyze         │ moments/forecast-7day
                    ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│              frontend  (nginx : 8080)                   │
│   Serves index.html · proxies /api/agent/ and /api/mcp/ │
└───────────────────┬─────────────────┬───────────────────┘
                    │                 │
          (container network)  (container network)
                    │                 │
        ┌───────────▼──────┐ ┌───────▼──────────────────┐
        │  agent  : 3000   │ │   mcp-server  : 3001      │
        │                  │ │                           │
        │  LangChain agent │ │  OpenWeatherMap wrapper   │
        │  OpenAI GPT-4o   │ │  Deterministic scorer     │
        │  BUY/HOLD/WAIT   │ │  Zod-validated routes     │
        └───────────┬──────┘ └───────────────────────────┘
                    │                 ▲
                    │   tool calls    │
                    └─────────────────┘
                    (agent → MCP only, never direct to OWM)
```

**Data flow for a single analysis:**

1. Browser `POST /api/agent/analyze` with `{ question, city, category }`
2. Nginx proxies to `agent:3000/analyze`
3. Agent fires `executor.invoke()` (LLM) **and** `mcpGetJson('/moments/score')` in parallel
4. LLM calls MCP tools as needed (score, forecast-window, compare, triggers, conditions)
5. Agent returns `{ answer, scoreData }` — structured score + LLM text in one response
6. Browser separately `GET /api/mcp/moments/forecast-7day` for the 7-day strip
7. Frontend renders score panel (from `scoreData`), verdict (parsed from `answer`), and forecast

---

## Local setup (no Docker)

### Prerequisites

- Node.js 20+
- An [OpenWeatherMap API key](https://openweathermap.org/api) (free tier is fine)
- An [OpenAI API key](https://platform.openai.com/api-keys)

### Step 1 — Clone and install

```bash
git clone git@github.com:RexCraft-dev/inmarket-project.git
cd inmarket-project

cd mcp-server && npm install && cd ..
cd agent      && npm install && cd ..
```

### Step 2 — Configure environment

```bash
# MCP server
cp mcp-server/.env.example mcp-server/.env
# Fill in: OWM_API_KEY

# Agent
cp agent/.env.example agent/.env
# Fill in: OPENAI_API_KEY
# OPENAI_MODEL defaults to gpt-4o-mini (change to gpt-4o for better reasoning)
# MCP_SERVER_URL defaults to http://localhost:3001 — correct for local dev
```

### Step 3 — Start services (three terminals)

```bash
# Terminal 1 — MCP server
cd mcp-server && npm run dev

# Terminal 2 — Agent
cd agent && npm run dev

# Terminal 3 — Frontend
cd frontend && npx serve . -p 5000
```

### Step 4 — Verify

```bash
curl http://localhost:3001/health   # {"status":"ok","service":"moments-mcp-server"}
curl http://localhost:3000/health   # {"status":"ok","service":"moments-agent"}
```

Open http://localhost:5000 in the browser.

> **Note on local relative URLs:** The frontend uses `/api/agent/` and `/api/mcp/` paths.
> When served via `npx serve`, the nginx proxy is not present and these paths will 404.
> For local dev without Docker, temporarily change `AGENT_URL` and `MCP_URL` back to
> `http://localhost:3000` and `http://localhost:3001` in `frontend/index.html`.
> Alternatively, run the full Docker stack (see below) and access via port 8080.

---

## Docker setup

### Prerequisites

- Docker Desktop or Docker Engine + Compose plugin
- API keys (same as above)

### Step 1 — Create env files

```bash
cp mcp-server/.env.example mcp-server/.env
# Set OWM_API_KEY in mcp-server/.env

cp agent/.env.example agent/.env
# Set OPENAI_API_KEY in agent/.env
```

### Step 2 — Build and run

```bash
docker compose up --build
```

Services start in dependency order:
- `mcp-server` starts first (no dependencies)
- `agent` waits until `mcp-server` health check passes
- `frontend` waits until both `agent` and `mcp-server` are healthy

### Step 3 — Open

http://localhost:8080

### Useful commands

```bash
docker compose logs -f agent          # tail agent logs
docker compose logs -f mcp-server     # tail MCP logs
docker compose down                   # stop all services
docker compose up --build mcp-server  # rebuild one service
```

### Environment variables available in docker-compose.yml

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `OWM_API_KEY` | mcp-server | — (required) | OpenWeatherMap API key |
| `OWM_BASE_URL` | mcp-server | OWM v2.5 | Override OWM base URL |
| `MCP_PORT` | mcp-server | 3001 | Listening port |
| `CORS_ORIGIN` | both | localhost allowlist | Comma-separated allowed origins |
| `OPENAI_API_KEY` | agent | — (required) | OpenAI API key |
| `OPENAI_MODEL` | agent | gpt-4o-mini | Swap to gpt-4o for better quality |
| `MCP_SERVER_URL` | agent | http://mcp-server:3001 | Set automatically by compose |
| `PORT` | agent | 3000 | Listening port |

---

## Scoring algorithm

### Formula

```
moment_score = weather_score (0–40)
             + time_score    (0–30)
             + day_score     (0–20)
             + trend_score   (−10…+10)

Result clamped to [0, 100].
Neutral baseline (all weights zero): 20 + 15 + 10 + 0 = 45
```

### How each component is calculated

**Weather (40 pts)**
OWM condition code → trigger keys (`rain`, `snow`, `heat`, `cold`, `wind`, `clear-sky`).
Multiple triggers can fire simultaneously (e.g. `rain + cold`).
Raw weight sum is clamped to [−20, +20] then scaled: `((sum + 20) / 40) × 40`.

**Time-of-day (30 pts)**
Current local hour → one active slot:
- `morning` 06:00–10:59
- `lunch` 11:00–13:59
- `afternoon` 14:00–17:59
- `evening` 18:00–21:59
- `late-night` 22:00–05:59

Single weight from the category config, scaled: `((weight + 20) / 40) × 30`.

**Day-of-week (20 pts)**
Maps to `weekday` (Mon–Fri) or `weekend` (Sat–Sun).
Single weight, scaled: `((weight + 20) / 40) × 20`.

**Trend (±10 pts)**
Compares current-hour raw weather score against the next OWM forecast slot.
Positive delta → improving → positive trend score. Scaled [−20, +20] → [−10, +10].
Returns 0 with key `trend-stable` when no forecast data is available.

### Where to tune weights

All weights live in:
```
mcp-server/src/config/category-triggers.json
```

Weight range: **−20** (strong negative signal) to **+20** (strong positive signal). **0** = neutral.

The scorer, signal labels, and OWM code mappings live in:
```
mcp-server/src/services/momentScorer.js
```

---

## How to add a new brand category

### Step 1 — Add the entry to `category-triggers.json`

Open `mcp-server/src/config/category-triggers.json` and add a new top-level key inside `"categories"`. Follow the exact structure of an existing category:

```jsonc
"gym-fitness": {
  "_rationale": "Explain what drives activation for this category.",
  "weather": {
    "rain":      -5,   // bad weather suppresses gym visits
    "snow":      -8,
    "heat":      -3,
    "cold":      -4,
    "wind":       0,
    "clear-sky": 10    // nice day → people feel like working out
  },
  "time-of-day": {
    "morning":    18,  // 5–7am early crowd
    "lunch":       6,
    "afternoon":   8,
    "evening":    14,  // after-work rush
    "late-night": -10
  },
  "day-of-week": {
    "weekday": 8,
    "weekend": 12      // more leisure time on weekends
  }
}
```

All six weather trigger keys must be present (use `0` for neutral). All five time slots and both day slots are required.

### Step 2 — Update the agent's Zod enum

Open `agent/src/routes/analyze.js` and add the new slug to `VALID_CATEGORIES`:

```js
const VALID_CATEGORIES = [
  'coffee', 'delivery-food', 'grocery', 'auto-insurance',
  'ride-share', 'sporting-goods', 'outdoor-apparel',
  'home-improvement', 'quick-service-restaurant',
  'gym-fitness',   // ← add here
];
```

### Step 3 — Test

```bash
curl "http://localhost:3001/moments/score?city=Austin&category=gym-fitness"
```

No restart required in dev (nodemon watches for file changes). No code changes needed anywhere else — the MCP router, scorer, and frontend category dropdown all derive the valid list from the JSON config at startup.

> **Note:** The frontend category `<select>` in `frontend/index.html` is currently hardcoded.
> Add the new slug as an `<option>` there too, or refactor to load the list from
> `GET /moments/triggers` at startup.

---

## Known limitations and future improvements

### Limitations

| Issue | Detail |
|---|---|
| **OWM free tier = 5-day forecast** | The 7-day UI strip shows only ~5 days. The `/forecast-7day` endpoint notes this with a `note` field in its response. Upgrade to OWM OneCall 3.0 for true 8-day coverage. |
| **Frontend category dropdown is hardcoded** | Adding a new category to `category-triggers.json` and `VALID_CATEGORIES` does not automatically update the UI. The `<select>` options in `index.html` must be updated manually. |
| **Frontend uses relative URLs** | `/api/agent/` and `/api/mcp/` paths require nginx to be running. Local dev with `npx serve` requires temporarily reverting to `localhost` URLs. |
| **Single-city scoring only** | The dashboard analyzes one city at a time. The compare endpoint (`/moments/compare`) exists and the agent can call it, but there is no multi-city UI. |
| **No authentication** | Both the agent and MCP server are open HTTP APIs. Rate limiting (60 req/min MCP, 10 req/min agent) is the only protection. Add API key auth or a session layer before exposing publicly. |
| **LLM response is text-only** | The agent answer is parsed for BUY/HOLD/WAIT via a simple string search. If the LLM rephrases its recommendation, verdict detection can fail silently. |

### Suggested improvements

- **Structured LLM output** — Use OpenAI response schemas / `zodResponseFormat` to return `{ verdict, rationale, confidence }` as typed JSON instead of free text.
- **Auto-populate frontend category list** — Load valid categories from `GET /moments/triggers?category=` at page load instead of hardcoding the `<select>`.
- **Upgrade OWM to OneCall 3.0** — Unlocks 8-day forecast and minutely precipitation data.
- **Add caching** — MCP weather fetches are unbounded; add a 10-minute in-memory or Redis cache keyed on `city` to reduce OWM API calls and latency.
- **WebSocket / SSE push** — Stream the LLM response tokens to the frontend rather than waiting for the full completion.
- **Multi-city dashboard** — Surface the `/moments/compare` endpoint in the UI for geo-targeting across DMA markets.

---

## Subagent roster

These specialist agents are configured in `CLAUDE.md` and should be invoked via the `Agent` tool (not manually):

| Agent | When to invoke | Notes |
|---|---|---|
| **`dev`** | Writing new features, adding Express routes, new LangChain tools, updating `package.json` | Safe to run in parallel when touching separate services |
| **`qa`** | After any code change — writing tests, validating API contracts, checking error paths | Run before `security` on new features |
| **`security`** | Before every commit touching env vars, input handling, CORS, auth, or rate limiting | Must complete before `prod` |
| **`prod`** | Modifying Dockerfiles, `docker-compose.yml`, deployment config, or README deploy section | Run after `security` clears |
| **`Explore`** | Broad codebase research — finding files by pattern, searching for usages, answering "how does X work" | Use for open-ended searches; use `Grep`/`Glob` directly for targeted lookups |
| **`Plan`** | Designing implementation strategy before writing code for non-trivial features | Returns step-by-step plan with architectural trade-offs |

**Sequential constraints (do not parallelise):**
1. `qa` → `security` → `prod` on new features
2. `security` review must complete before `prod` deployment prep

**Safe to parallelise:**
- `dev` work on `mcp-server/` and `agent/` (separate codebases, no shared files)
- `qa` and documentation tasks
- `security` audit and README updates

---

## Unresolved issue — Zod `.optional()` in OpenAI tool schemas

### What the warning is

The OpenAI function-calling API converts Zod schemas to JSON Schema. JSON Schema does not support a property that is optional (i.e. absent from the call) *without* also being `nullable`. When LangChain serialises a `z.optional()` field to JSON Schema, the resulting definition can trigger a runtime warning from the OpenAI SDK.

### What was done

The only tool schema field that was `.optional()` — `hours` on `get_forecast_window` — was changed to `.default(6)`:

```js
// Before (triggers warning)
hours: z.number().int().min(1).max(48).optional()

// After (warning-free)
hours: z.number().int().min(1).max(48).default(6)
```

Using `.default(6)` matches the MCP server's own default and means the field is always present in the JSON Schema (with a default value), which the OpenAI API handles cleanly.

### Why this matters for future work

If you add a new optional parameter to any LangChain tool schema, do **not** use `.optional()` alone. Choose one of:

```js
// Option A — provide a sensible default
z.number().default(0)

// Option B — allow explicit null as well
z.number().optional().nullable()

// Option C — remove the field and handle the absence in the tool function
```

The `analyzeSchema` (the Express route body schema, line 146 of `analyze.js`) still uses `.optional()` on `city`, `category`, and `cities`. This is fine — that schema is never sent to the OpenAI API; it is only used by Zod to validate the incoming HTTP request body.
