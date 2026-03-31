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

**Model:** claude-sonnet | **Color:** cyan

**Purpose:** Write new feature code, add Express routes, build LangChain tools, update `package.json` dependencies, implement any application logic across mcp-server, agent, or frontend.

**Tools:** Read, Write, Edit, Bash, LSP

**Invoke when:**
- Adding a new MCP endpoint
- Adding a new LangChain tool
- Implementing a new scoring component
- Any code authoring task across the three services

---

## qa

**Model:** claude-sonnet | **Color:** green

**Purpose:** Write tests, validate API contracts between services, check error handling paths, verify environment variable requirements are documented.

**Tools:** Read, Write, Edit, Bash, Glob, Grep

**Invoke when:**
- After any code change
- Validating that MCP endpoint params match what the agent tool schemas send
- Checking that error responses match what callers expect
- Verifying new env vars are in `.env.example`

---

## security

**Model:** claude-opus | **Color:** red

**Purpose:** Review environment variable handling, check for secrets in code, validate input sanitisation and rate limiting, CORS and authentication review.

**Tools:** Read, Bash, LSP

**Invoke when:**
- Before every commit touching env vars, input handling, CORS, auth, or rate limiting
- After any change to `mcp-server/src/index.js` or `agent/src/index.js`
- After adding new query params or request body fields
- Must complete before `prod` on new features

---

## prod

**Model:** claude-sonnet | **Color:** magenta

**Purpose:** Dockerfile optimisation, docker-compose service dependency checks, environment variable completeness across all services, README deployment section updates.

**Tools:** Read, Write, Edit, Bash, Glob, Grep

**Invoke when:**
- Modifying any `Dockerfile` or `docker-compose.yml`
- Updating the README deployment section
- Checking that all required env vars are documented and present across services
- Always run after `security` completes

---

## docs

**Model:** claude-sonnet | **Color:** yellow

**Purpose:** Incrementally update project documentation to reflect what just changed. Never rewrites docs from scratch — only touches the sections relevant to the changed file.

**Tools:** Read, Write, Edit, Glob, LSP

**Invoke:** Automatically via the PostToolUse hook in `.claude/hooks/update-docs.mjs` after every file Write or Edit. Also invocable manually when documentation has drifted.

**Maintains:**
- `docs/architecture.md` — when service files, Dockerfiles, or docker-compose change
- `docs/api.md` — when route files change
- `docs/env.md` — when `.env.example` files change
- `docs/agents.md` — when `.claude/agents/*.md` files change

---

## PostToolUse hook

**File:** `.claude/hooks/update-docs.mjs`

**Configured in:** `.claude/settings.json` — hooks on `PostToolUse` for tool matcher `Write|Edit|MultiEdit`

**How it fires:** After every Write, Edit, or MultiEdit tool call, Claude reads the hook payload from stdin (JSON with `tool_input.file_path`), then spawns a detached `claude -p` process invoking the `docs` subagent with the changed file path. The child is detached and unreffed so it never blocks the main Claude session.

**What it skips (SKIP_PATTERNS):**
- `node_modules/` — dependency trees
- `.env` files — secrets, never documented directly
- `package-lock.json` — lockfiles
- `docs/` — doc file edits themselves (prevents infinite loops)
- `.claude/hooks/` — hook script edits

**Watched extensions:** `.js`, `.json`, `.md`, `.yml`, `.yaml` — all other file types are silently ignored.

**Failure mode:** Any error (missing binary, parse failure, spawn error) is caught and swallowed. Doc updates are best-effort and never block development work.
