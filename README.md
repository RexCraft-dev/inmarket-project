# Weather Agent

Full-stack agentic weather app with three services.

## Services

| Service | Directory | Port | Description |
|---------|-----------|------|-------------|
| MCP Server | `mcp-server/` | 3001 | Express.js MCP wrapper for OpenWeatherMap API |
| Agent Backend | `agent/` | 3000 | LangChain.js agent with tool calling |
| Frontend | `frontend/` | — | Single-file HTML/CSS/JS chat UI |

## Architecture

```
frontend/ ──► agent/:3000 ──► mcp-server/:3001 ──► OpenWeatherMap API
```

- The frontend only talks to the agent — it never knows about OpenWeatherMap or OpenAI.
- The agent only calls OpenWeatherMap via the MCP server — never directly.
- API keys live in `.env` files per-service and are never exposed to callers.

## Prerequisites

- Node.js 20+
- Docker + Docker Compose (optional)
- OpenWeatherMap API key
- OpenAI API key

## Quick start

### With Docker

```bash
# Copy and fill in env files for each service, then:
docker compose up --build
```

### Without Docker

```bash
# Terminal 1 — MCP server
cd mcp-server && npm install && npm run dev

# Terminal 2 — Agent backend
cd agent && npm install && npm run dev

# Terminal 3 — Frontend
cd frontend && npx serve .
```

### Health checks

```bash
curl http://localhost:3001/health
curl http://localhost:3000/health
```

## Environment variables

Each service has its own `.env` file. See `.env.example` in each service directory for required variables.

## Stack

- Runtime: Node.js 20+ (ESM)
- Framework: Express.js
- Agent: LangChain.js (`@langchain/openai`, `@langchain/core`)
- Validation: Zod
- LLM: OpenAI GPT-4o-mini (override with `OPENAI_MODEL`)
- Containers: Docker + docker-compose
