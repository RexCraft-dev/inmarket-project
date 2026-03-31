# Architecture

## Overview

InMarket Moments Intelligence is a three-service system that scores the current moment (0–100) for a brand category in a given city and delivers a BUY / HOLD / WAIT recommendation.

## Services

### mcp-server (port 3001)

Express.js service that wraps the OpenWeatherMap API and runs the deterministic scoring algorithm. It is the only service that talks to OWM. All scoring logic is pure and side-effect free.

- Fetches current conditions and hourly forecast from OpenWeatherMap v2.5
- Runs `scoreMoment(conditions, category)` — weather + time-of-day + day-of-week + trend
- Exposes 6 REST endpoints under `/moments/`
- Validates all inputs with Zod; fails fast on missing `OWM_API_KEY` at startup

### agent (port 3000)

LangChain.js service that wraps OpenAI GPT-4o-mini with 5 MCP-backed tools. It is the only service that makes LLM calls.

- Runs `createOpenAIToolsAgent` with up to 5 iterations
- Fires `executor.invoke()` and `mcpGetJson('/moments/score')` in parallel on each request
- Returns `{ answer, scoreData }` — LLM recommendation + structured score data in one response
- Model configurable via `OPENAI_MODEL` env var (default: `gpt-4o-mini`)

### frontend (port 8080)

Single-file HTML/CSS/JS dashboard served by nginx. Nginx also acts as the reverse proxy routing `/api/agent/` and `/api/mcp/` to the backend containers.

- Score gauge with animated 0–100 display
- 4-component breakdown (weather / time / day / trend) with expandable signal detail panels
- Signal pills showing top active triggers
- Verdict badge (BUY / HOLD / WAIT) parsed from agent response
- 7-day forecast strip with intraday sparklines

## Scoring formula

`scoreMoment()` in `mcp-server/src/services/momentScorer.js` is deterministic, pure, and side-effect free. The four components and their point budgets are:

| Component | Budget | Neutral baseline |
|---|---|---|
| weather | 0–40 pts | 20 pts (rawSum = 0) |
| time-of-day | 0–30 pts | 15 pts (rawSum = 0) |
| day-of-week | 0–20 pts | 10 pts (rawSum = 0) |
| trend | −10…+10 pts | 0 pts (no forecast) |

All-neutral conditions produce a score of 45. The final total is clamped to `[0, 100]`.

**Normalisation:** each component's raw weight sum (−20…+20) is mapped linearly to its point budget: `((rawSum + 20) / 40) × maxPoints`. Multiple simultaneous weather triggers compound (e.g. rain + cold both add their weights before normalisation).

**Trend component:** compares the current period's raw weather-weight sum against the next 3-hour forecast slot. A positive delta scores up to +10 (improving); negative down to −10 (worsening). Returns 0 when no forecast is available.

**Weather trigger mapping (OWM codes → trigger keys):**
- 2xx Thunderstorm → `rain` + `wind`
- 3xx Drizzle → `rain`
- 5xx Rain → `rain`
- 6xx Snow → `snow`
- 771 Squalls / 781 Tornado → `wind`
- 800 Clear → `clear-sky`
- 801–804 Clouds → neutral (no trigger)
- temp > 85 °F → `heat` (independent of precipitation code)
- temp < 40 °F → `cold`
- wind ≥ 20 mph → `wind`

**Time-of-day slots:**
- morning: hours 6–10
- lunch: hours 11–13
- afternoon: hours 14–17
- evening: hours 18–21
- late-night: hours 22–23 and 0–5

## Brand categories

Nine category slugs are configured in `mcp-server/src/config/category-triggers.json`. Each entry carries `weather`, `time-of-day`, and `day-of-week` weight maps (values −20…+20):

| Slug | Primary drivers |
|---|---|
| `quick-service-restaurant` | Weekday commute, lunch/evening dayparts, bad weather drives convenience |
| `coffee` | Morning + weekday dominant; cold/rain are the strongest weather signals |
| `delivery-food` | Snow/rain are primary; evening + weekend leisure multiplier; clear sky suppresses |
| `grocery` | Weekend shopping trips; clear sky encourages errands; snow strongly suppresses |
| `auto-insurance` | Risk salience: rain/snow make driving hazard top of mind; commute hours |
| `ride-share` | Late-night bar traffic peaks highest; any bad weather boosts; clear sky suppresses |
| `sporting-goods` | Clear sky + weekend; rain suppresses; snow is a mild positive (winter sports) |
| `outdoor-apparel` | Cold is the dominant trigger; snow amplifies; weekend shopping primary |
| `home-improvement` | Weekend warrior projects; clear sky required; snow/cold near-zero intent |

## Data flow — single `/analyze` request

```
Browser
  │
  ├─ POST /api/agent/analyze ──► nginx:8080
  │                                │ strips /api/agent/ prefix
  │                                ▼
  │                          agent:3000
  │                          ├── executor.invoke() ──► OpenAI GPT-4o-mini
  │                          │     LLM calls MCP tools as needed (≤5 iterations):
  │                          │       GET /moments/score
  │                          │       GET /moments/forecast-window
  │                          │       GET /moments/compare
  │                          │       GET /moments/triggers
  │                          │       GET /moments/conditions
  │                          │                    ▼
  │                          │             mcp-server:3001
  │                          │             OWM API + scoring engine
  │                          │
  │                          └── mcpGetJson('/moments/score') [parallel]
  │                                         ▼
  │                                   mcp-server:3001
  │
  │    agent returns { answer, scoreData } ◄──────────────────
  │
  └─ GET /api/mcp/moments/forecast-7day ──► nginx:8080
                                              │ strips /api/mcp/ prefix
                                              ▼
                                        mcp-server:3001
```

Step by step:
1. Browser POSTs `{ question, city, category }` to nginx `/api/agent/analyze`
2. nginx strips the `/api/agent/` prefix and proxies to `agent:3000/analyze`
3. Agent fires `executor.invoke()` (LLM + tools) and a direct `/moments/score` fetch **in parallel**
4. LLM selects and calls MCP tools up to 5 times to gather data
5. Agent returns `{ answer, scoreData }` — LLM recommendation plus structured score data in one response
6. Browser separately GETs `/api/mcp/moments/forecast-7day` via nginx for the 7-day strip
7. Frontend renders score gauge, breakdown panels, signal pills, verdict badge, and 7-day strip

## Constraints

- The agent must never call OpenWeatherMap directly — only via the MCP server
- The frontend must never know about OpenWeatherMap or OpenAI — only talks to the agent and MCP server
- API keys live only in `.env` files per-service and are never forwarded to callers
- CORS origins must be an explicit allowlist — never wildcard `*` in production

## Deployment

All three services are containerised. See `docker-compose.yml` at the project root.

**Container stack:**
- `mcp-server` and `agent` use `node:20-alpine` builds with non-root `appuser` (added via `addgroup`/`adduser`)
- `frontend` uses `nginx:alpine`; pid file remapped to `/tmp/nginx.pid` so the non-root nginx user can write it
- All containers set `restart: unless-stopped`

**Health-check dependency order (enforced via `condition: service_healthy`):**
1. `mcp-server` starts first — healthcheck hits `GET /health` via `wget` every 30s (3 retries, 10s start period)
2. `agent` waits for `mcp-server` to be healthy, then starts — same healthcheck cadence
3. `frontend` waits for both `agent` and `mcp-server` to be healthy before starting

**nginx reverse proxy (`frontend/nginx.conf`):**
- Listens on port 8080
- `GET /api/agent/*` → proxied to `http://agent:3000/` (prefix stripped)
- `GET /api/mcp/*` → proxied to `http://mcp-server:3001/` (prefix stripped)
- `proxy_read_timeout 120s` on both proxy locations (accommodates LLM latency)
- HTML files served with `no-cache` headers; static assets (CSS/JS/images/fonts) cached 1 year immutable
- SPA fallback: all unmatched paths serve `index.html`
- Main nginx config lives in `frontend/nginx.main.conf`; server block in `frontend/nginx.conf`

**Internal networking:** The agent container reaches the MCP server using the Docker service name `http://mcp-server:3001` (set by docker-compose `environment` block), not `localhost`.
