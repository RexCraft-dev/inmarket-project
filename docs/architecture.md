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

## Data flow

```
Browser
  │
  ├─ POST /api/agent/analyze ──► agent:3000
  │                                │  LangChain + OpenAI
  │                                │  tool calls as needed
  │                                ▼
  │                          mcp-server:3001
  │                          OWM + scoring engine
  │
  └─ GET /api/mcp/moments/forecast-7day ──► mcp-server:3001
```

1. Browser POSTs `{ question, city, category }` to `/api/agent/analyze`
2. Agent fires LLM execution and a direct `/moments/score` fetch in parallel
3. LLM calls MCP tools (score, forecast-window, compare, triggers, conditions) as needed
4. Agent returns `{ answer, scoreData }` to the browser
5. Browser separately GETs `/api/mcp/moments/forecast-7day` for the 7-day strip
6. Frontend renders all panels from the two responses

## Constraints

- The agent must never call OpenWeatherMap directly — only via the MCP server
- The frontend must never know about OpenWeatherMap or OpenAI — only talks to the agent and MCP server
- API keys live only in `.env` files per-service and are never forwarded to callers

## Deployment

All three services are containerised. See `docker-compose.yml` at the project root.

- `mcp-server` and `agent` use two-stage `node:20-alpine` builds with non-root `appuser`
- `frontend` uses `nginx:alpine` with a non-root `nginx` user (uid 101); pid remapped to `/tmp`
- `agent` depends on `mcp-server` with `condition: service_healthy`
- `frontend` depends on both backend services being healthy before starting
- Health checks hit `/health` on each service via `wget`
