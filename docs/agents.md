# Subagent Roster

Specialist subagents are defined in `.claude/agents/`. They are invoked via the `Agent` tool during development. The `docs` agent is also wired to a PostToolUse hook that fires automatically after every file write or edit.

## Routing rules

**Sequential (do not parallelise):**
1. `qa` must complete before `security` on new features
2. `security` must complete before `prod` on any deployment change

**Safe to parallelise:**
- `dev` work on `mcp-server/` and `agent/` (separate codebases, no shared files)
- `qa` and documentation tasks
- `security` audit and README updates

---

## dev

**Purpose:** Write new feature code, add Express routes, build LangChain tools, update `package.json` dependencies, implement any application logic across mcp-server, agent, or frontend.

**Tools:** Read, Write, Edit, Bash, LSP

**Invoke when:**
- Adding a new MCP endpoint
- Adding a new LangChain tool
- Implementing a new scoring component
- Any code authoring task across the three services

---

## qa

**Purpose:** Write tests, validate API contracts between services, check error handling paths, verify environment variable requirements are documented.

**Tools:** Read, Write, Edit, Bash, Glob, Grep

**Invoke when:**
- After any code change
- Validating that MCP endpoint params match what the agent tool schemas send
- Checking that error responses match what callers expect
- Verifying new env vars are in `.env.example`

---

## security

**Purpose:** Review environment variable handling, check for secrets in code, validate input sanitisation and rate limiting, CORS and authentication review.

**Tools:** Read, Bash, LSP

**Invoke when:**
- Before every commit touching env vars, input handling, CORS, auth, or rate limiting
- After any change to `mcp-server/src/index.js` or `agent/src/index.js`
- After adding new query params or request body fields
- Must complete before `prod` on new features

---

## prod

**Purpose:** Dockerfile optimisation, docker-compose service dependency checks, environment variable completeness across all services, README deployment section updates.

**Tools:** Read, Write, Edit, Bash, Glob, Grep

**Invoke when:**
- Modifying any `Dockerfile` or `docker-compose.yml`
- Updating the README deployment section
- Checking that all required env vars are documented and present across services
- Always run after `security` completes

---

## docs

**Purpose:** Incrementally update project documentation to reflect what just changed. Never rewrites docs from scratch — only touches the sections relevant to the changed file.

**Tools:** Read, Write, Edit, Glob, LSP

**Invoke:** Automatically via the PostToolUse hook in `.claude/hooks/update-docs.mjs` after every file Write or Edit. Also invocable manually when documentation has drifted.

**Maintains:**
- `docs/architecture.md` — when service files, Dockerfiles, or docker-compose change
- `docs/api.md` — when route files change
- `docs/env.md` — when `.env.example` files change
- `docs/agents.md` — when `.claude/agents/*.md` files change
