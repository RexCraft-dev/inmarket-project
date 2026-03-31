# Weather Agent — Claude Code Project

## Project overview

Full-stack agentic weather app with three services:
- `mcp-server/` — Express.js MCP wrapper for OpenWeatherMap API (port 3001)
- `agent/` — LangChain.js agent backend with tool calling (port 3000)
- `frontend/` — Single-file HTML/CSS/JS chat UI

All services are Node.js ESM (`"type": "module"`). API keys live only in `.env` files and never pass through to callers.

## Stack

- Runtime: Node.js 20+
- Framework: Express.js
- Agent: LangChain.js (`@langchain/openai`, `@langchain/core`)
- Validation: Zod
- LLM: OpenAI GPT-4o-mini (swap via `OPENAI_MODEL` env var)
- Containerisation: Docker + docker-compose

## Commands

```bash
# MCP server
cd mcp-server && npm run dev        # dev (nodemon)
cd mcp-server && npm start          # prod

# Agent backend
cd agent && npm run dev
cd agent && npm start

# Frontend — open directly or:
cd frontend && npx serve .

# All services via Docker
docker compose up --build

# Health checks
curl http://localhost:3001/health
curl http://localhost:3000/health
```

## Code conventions

- ESM imports only — no `require()`
- Async/await — no raw Promise chains
- All route handlers wrapped in try/catch; errors forwarded via `next(err)`
- Zod for all external input validation (query params, request bodies)
- Environment variables validated on startup — fail fast with a clear message if missing
- No API keys or secrets in source code — always `.env` only
- `console.error` for errors, `console.log` for startup messages only
- File names: camelCase for modules, kebab-case for config files

## Architecture constraints

- The `agent/` service must NEVER call OpenWeatherMap directly — only via the MCP server
- The `frontend/` must NEVER know about OpenWeatherMap or OpenAI — only talks to the agent
- Each service owns its own `package.json` and `.env` — no shared node_modules at root
- CORS origins must be explicitly configured, not wildcard `*` in production

## Subagent routing rules

During implementation, delegate to specialist subagents as follows:

**Delegate to `dev` (parallel-safe):**
- Writing new feature code in any service
- Adding new Express routes or LangChain tools
- Updating package.json dependencies

**Delegate to `qa` (run after any code change):**
- Writing or running tests
- Validating API contracts between services
- Checking error handling paths

**Delegate to `security` (run before any commit):**
- Reviewing environment variable handling
- Checking for secrets in code
- Validating input sanitisation and rate limiting
- CORS and authentication review

**Delegate to `prod` (run before docker-compose changes):**
- Dockerfile optimisation
- docker-compose service dependency checks
- Environment variable completeness across all services
- README deployment section updates

**Sequential (do NOT parallelise):**
- security review must complete before prod deployment prep
- qa must complete before security review on new features

**Safe to parallelise:**
- dev work on mcp-server and agent (separate codebases, no shared files)
- qa and documentation tasks
- security audit and README updates
