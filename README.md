# InMarket Moments Intelligence

Real-time advertising activation platform that scores the current moment (0–100) for a brand category in any city, and delivers a **BUY / HOLD / WAIT** recommendation powered by a LangChain agent.

## Services

| Service | Directory | Port | Description |
|---------|-----------|------|-------------|
| MCP Server | `mcp-server/` | 3001 | Moment scoring engine — fetches live weather via OpenWeatherMap, runs the deterministic scoring algorithm, exposes 6 REST endpoints |
| Agent Backend | `agent/` | 3000 | LangChain.js agent — calls MCP tools, queries OpenAI GPT-4o-mini, returns structured score data + BUY/HOLD/WAIT recommendation |
| Frontend | `frontend/` | 8080 | Single-file dashboard — score gauge, 4-component breakdown, signal pills, 7-day forecast strip, verdict badge |

## Architecture

```
Browser
  │
  ├─ POST /api/agent/analyze ──► agent:3000
  │                                │  LangChain agent + OpenAI
  │                                │  calls MCP tools as needed
  │                                ▼
  │                          mcp-server:3001
  │                          scoring engine + OpenWeatherMap
  │
  └─ GET /api/mcp/moments/forecast-7day ──► mcp-server:3001
```

All traffic from the browser passes through the **nginx reverse proxy** on port 8080. The agent is the only service that makes AI calls — the MCP server is deterministic and side-effect free. API keys never leave their respective services.

## Scoring model

```
moment_score = weather (0–40) + time-of-day (0–30) + day-of-week (0–20) + trend (±10)
```

Weights for all 9 brand categories are configurable in `mcp-server/src/config/category-triggers.json`. Current categories: `coffee`, `delivery-food`, `grocery`, `auto-insurance`, `ride-share`, `sporting-goods`, `outdoor-apparel`, `home-improvement`, `quick-service-restaurant`.

## Prerequisites

- Node.js 20+
- Docker + Docker Compose (for containerised setup)
- [OpenWeatherMap API key](https://openweathermap.org/api) (free tier)
- [OpenAI API key](https://platform.openai.com/api-keys)

## Quick start

### With Docker (recommended)

```bash
# 1. Create env files
cp mcp-server/.env.example mcp-server/.env   # set OWM_API_KEY
cp agent/.env.example      agent/.env         # set OPENAI_API_KEY

# 2. Build and run
docker compose up --build
```

Open http://localhost:8080

Services start in dependency order — `mcp-server` first, `agent` once MCP is healthy, `frontend` once both are healthy.

### Without Docker

```bash
cp mcp-server/.env.example mcp-server/.env   # set OWM_API_KEY
cp agent/.env.example      agent/.env         # set OPENAI_API_KEY

# Terminal 1
cd mcp-server && npm install && npm run dev

# Terminal 2
cd agent && npm install && npm run dev

# Terminal 3 — open on a port that nginx would serve from
cd frontend && npx serve . -p 8080
```

> **Note:** Running without Docker means the nginx proxy is absent. The frontend uses
> relative URLs (`/api/agent/`, `/api/mcp/`) that require the proxy to resolve.
> For local dev without Docker, change `AGENT_URL` and `MCP_URL` in `frontend/index.html`
> back to `http://localhost:3000` and `http://localhost:3001`.

### Health checks

```bash
curl http://localhost:3001/health   # {"status":"ok","service":"moments-mcp-server"}
curl http://localhost:3000/health   # {"status":"ok","service":"moments-agent"}
```

## Environment variables

Each service has its own `.env` file. See `.env.example` in each service directory.

| Variable | Service | Required | Default |
|---|---|---|---|
| `OWM_API_KEY` | mcp-server | Yes | — |
| `MCP_PORT` | mcp-server | No | 3001 |
| `CORS_ORIGIN` | mcp-server | No | `http://localhost:5000,http://localhost:3000` |
| `OPENAI_API_KEY` | agent | Yes | — |
| `OPENAI_MODEL` | agent | No | `gpt-4o-mini` |
| `MCP_SERVER_URL` | agent | No | `http://localhost:3001` |
| `PORT` | agent | No | 3000 |
| `CORS_ORIGIN` | agent | No | `http://localhost:5000` |

## Stack

- Runtime: Node.js 20+ (ESM)
- Framework: Express.js
- Agent: LangChain.js (`@langchain/openai`, `@langchain/core`)
- Validation: Zod
- LLM: OpenAI GPT-4o-mini (override with `OPENAI_MODEL`)
- Reverse proxy: nginx (Alpine)
- Containers: Docker + Docker Compose

## Further reading

See [`HANDOFF.md`](./HANDOFF.md) for a full breakdown of the scoring algorithm, how to add a new brand category, known limitations, and the subagent roster used during development.
