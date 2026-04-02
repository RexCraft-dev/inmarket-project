# Critical Prompts — InMarket Moments Intelligence

A chronological record of the key prompts used to build this project in Claude Code.
Use this document during the video presentation to demonstrate the agentic development approach.

---

## 1. Project scaffolding

```
Read CLAUDE.md then scaffold a three-service monorepo: mcp-server/, 
agent/, and frontend/. Add root .gitignore for Node.js, placeholder 
README.md, and a docs/ folder with empty architecture.md, api.md, 
env.md, and agents.md stubs. No application code yet.
```

**Why this prompt matters:** Forces Claude Code to read the architectural constraints
before writing a single line of code. The output is structure-first, not code-first —
a deliberate choice that mirrors how a senior engineer would approach a new project.

---

## 2. Category triggers config

```
In mcp-server/src/config/, create a category-triggers.json file 
defining moment scoring weights for these 9 brand categories: 
quick-service-restaurant, coffee, delivery-food, grocery, 
auto-insurance, ride-share, sporting-goods, outdoor-apparel, 
home-improvement.

Each category needs weights for: rain, snow, heat (>85F), cold (<40F), 
wind, clear-sky, morning (6-10am), lunch (11am-2pm), afternoon (2-6pm), 
evening (6-10pm), late-night (10pm-6am), weekday, weekend.

Weights range -20 to +20. Think carefully about what conditions 
genuinely drive consumer behavior for each category.
```

**Why this prompt matters:** The config file is built before any route code — data
separated from logic from the start. The instruction to "think carefully about what
conditions genuinely drive consumer behavior" produces behavioral reasoning, not
arbitrary numbers. This is prompt engineering for quality, not just output.

---

## 3. Deterministic scoring engine

```
In mcp-server/src/services/, create a momentScorer.js file that 
implements the deterministic scoring algorithm:

moment_score = weather_score (40pts max)
             + time_score    (30pts max)
             + day_score     (20pts max)
             + trend_score   (10pts max)

Load weights from category-triggers.json. The scorer should:
- Accept (conditions, category) where conditions includes temp_f, 
  weather_id (OWM codes), wind_speed, current hour, and day of week
- Map OWM weather codes to our trigger keys 
  (rain, snow, clear-sky, etc.)
- Return { total, breakdown: { weather, time, day, trend }, 
  signals: [...] } where signals is an array of the top 3 
  factors that most influenced the score with their weights
- Clamp final score 0-100
- trend_score uses the hourly forecast delta — if conditions 
  are improving score goes up, worsening goes down

Keep it as pure functions, no side effects, fully testable.
```

**Why this prompt matters:** "Pure functions, no side effects, fully testable" is a
constraint that shapes the entire module design. The output format is specified exactly
so downstream consumers (routes, agent) can rely on a stable contract.

---

## 4. OWM weather code expansion

```
Expand the OWM weather code mapping to cover all major groups: 
2xx thunderstorm, 3xx drizzle, 5xx rain, 6xx snow, 7xx atmosphere, 
800 clear, 80x clouds
```

**Why this prompt matters:** A targeted fix prompt rather than a full rewrite.
Demonstrates iterative refinement — the agentic IDE approach is steer, not redo.

---

## 5. Signal active/inactive fix

```
In momentScorer.js, topSignals() is still returning late-night 
as active: true when hour is 8 (which maps to morning).

The active flag logic is broken. Fix it so active: true means 
the trigger key exactly matches what mapHourToTimeSlot(), 
mapDayToSlot(), and mapConditionsToTriggers() actually returned 
for the current conditions.

Concretely: if mapHourToTimeSlot(8) returns 'morning', then 
only 'morning' should be active: true in the time component. 
'late-night' should be active: false because it was not the 
mapped slot.
```

**Why this prompt matters:** Precise bug description with a concrete example.
"Concretely: if X returns Y then Z should be..." is the pattern that produces
correct fixes on the first attempt rather than generating a guess.

---

## 6. Five MCP routes

```
In mcp-server/src/routes/, create a moments.js Express router that 
exposes these five endpoints using momentScorer.js and the OWM client:

GET /moments/score?city=Austin&category=coffee
  → fetches current conditions, runs scoreCategory, returns
    { city, category, score, breakdown, signals, conditions, timestamp }

GET /moments/forecast-window?city=Austin&category=coffee&hours=6
  → fetches hourly forecast, scores each hour, returns the top 
    activation window with start_time, end_time, peak_score, and reason

GET /moments/compare?cities=Austin,Dallas,Houston&category=delivery-food
  → runs score for each city in parallel (Promise.all), returns 
    ranked array

GET /moments/triggers?category=coffee
  → returns the raw weight table for that category from 
    category-triggers.json — no external API call needed

GET /moments/conditions?city=Austin
  → current OWM conditions only, normalized to our internal format
    (temp_f, weatherCode, windSpeed, hour, dayOfWeek, description)

Zod validation on all inputs. Category must be one of the 9 valid 
values — return 400 with the valid list if unknown category passed.
All errors follow { ok: false, error: string } shape.
```

**Why this prompt matters:** Each endpoint is fully specified with its exact response
shape. The error contract is defined upfront. This level of specificity in the prompt
is what produces production-quality routes rather than scaffolding that needs heavy
revision.

---

## 7. LangChain agent backend

```
Create agent/package.json, agent/src/index.js, and 
agent/src/routes/analyze.js for a LangChain.js agent backend.

POST /analyze accepts { question, city, category, cities[] }
The agent has access to these tools that call the MCP server 
(process.env.MCP_SERVER_URL || http://localhost:3001):
- get_moment_score: calls GET /moments/score
- get_forecast_window: calls GET /moments/forecast-window  
- compare_moments: calls GET /moments/compare
- get_triggers: calls GET /moments/triggers
- get_conditions: calls GET /moments/conditions

System prompt makes the agent a media buying analyst who:
- speaks in terms of ROAS, activation, audience, media spend
- always cites the score and top signals in its recommendation
- gives a clear BUY / HOLD / WAIT recommendation
- keeps responses under 4 sentences

Use ChatOpenAI gpt-4o-mini, temperature 0.2.
Include GET /health and .env.example.
```

**Why this prompt matters:** The system prompt persona is defined in the build prompt,
not discovered later. "Speaks in terms of ROAS, activation, audience" produces an agent
that sounds like an ad-tech tool. Temperature 0.2 is specified because weather scoring
recommendations should be grounded, not creative.

---

## 8. Frontend dashboard

```
Create frontend/index.html — a single-file media buyer dashboard 
for the Moments Intelligence platform. No frameworks, plain 
HTML/CSS/JS only.

Layout — three panels side by side:
- LEFT: inputs — city text field, category dropdown (all 9 
  categories), natural language question textarea, Analyze button
- CENTER: moment score display — large numeric score (0-100), 
  color-coded gauge (0-40 red, 41-69 amber, 70-100 green), 
  four breakdown bars (weather/time/day/trend each showing 
  their component score), top signals as pills
- RIGHT: agent recommendation card — BUY/HOLD/WAIT badge 
  (color coded), agent answer text, conditions summary 
  (temp, weather description, city/time)

Design direction: dark professional dashboard — deep navy 
background, sharp data typography, feels like a real ad-tech 
tool not a student project. Use IBM Plex Mono for numbers, 
IBM Plex Sans for labels. No gradients on data elements.

Behavior:
- Analyze button calls POST http://localhost:3000/analyze and 
  GET http://localhost:3001/moments/score in parallel
- Show a loading state while waiting
- Score gauge animates from 0 to final value on load
- BUY/HOLD/WAIT parsed from the agent answer text
- Error state if either call fails

Pre-fill city with "Austin" and category with "coffee" so it's 
ready to demo immediately on load.
```

**Why this prompt matters:** "Feels like a real ad-tech tool not a student project"
is a design constraint that produces a specific aesthetic outcome. Specifying IBM Plex
Mono/Sans, dark navy, no gradients, and parallel fetch behavior in the prompt means
the first output is presentation-ready rather than generic.

---

## 9. Security audit

```
Use the security subagent to review all three services for 
secrets handling, input validation, CORS config, and rate limiting.
```

**Why this prompt matters:** Single-line delegation to a specialist subagent.
The security agent runs in its own isolated context with read-only tools,
producing findings without risk of modifying code while auditing it.

---

## 10. Security fix delegation

```
Fix all issues found by the security subagent.
```

**Why this prompt matters:** After the security agent reports findings,
delegation back to the dev agent for fixes. The two-agent loop —
one finds, one fixes — is the core of the agentic quality gate pattern.

---

## 11. Docker deployment

```
Use the prod subagent to create docker-compose.yml at the root 
with Dockerfiles for mcp-server and agent. Frontend served via 
nginx on port 8080. All env vars injected from a root .env file. 
Health checks on both services. Agent depends_on mcp-server 
healthy. Non-root users in both Dockerfiles.
```

**Why this prompt matters:** Delegating deployment config to the prod subagent
which has the specific Docker expertise defined in its system prompt. The constraint
"non-root users" and "depends_on with condition: service_healthy" produce
production-grade config rather than a minimal compose file.

---

## 12. Docs backfill

```
Use the docs subagent to populate all four docs files based 
on the current codebase:
- docs/architecture.md — full system overview, service 
  responsibilities, data flow, scoring model, deployment
- docs/api.md — all MCP endpoints with params and response 
  shapes, all LangChain tool definitions
- docs/env.md — every environment variable across all services
- docs/agents.md — full subagent roster with tools, model, 
  color, and when each one fires
```

**Why this prompt matters:** Documentation generated from the actual codebase,
not written speculatively upfront. The docs subagent reads the source files
and produces accurate documentation rather than approximations.

---

## 13. HANDOFF.md

```
Create HANDOFF.md at the project root covering:
- What this project does and business context (InMarket Moments)
- Local setup step by step
- Docker setup
- ASCII architecture diagram
- How the scoring algorithm works and where to tune weights
- How to add a new brand category
- Known limitations and future improvements
- The subagent roster and when to invoke each one
- The one unresolved issue (Zod optional() warning) and why
```

**Why this prompt matters:** The handoff doc is requested last, after the system
is complete, so it documents reality not aspiration. Specifying "the one unresolved
issue and why" forces honest documentation of limitations — a signal of engineering
maturity.

---

## Key prompt patterns demonstrated

| Pattern | Example prompt |
|---|---|
| **Read config before coding** | "Read CLAUDE.md then scaffold..." |
| **Specify output contracts** | "Return `{ ok, data: { ... } }` shape" |
| **Constrain behavior** | "Pure functions, no side effects, fully testable" |
| **Precise bug description** | "Concretely: if X returns Y then only Z is active" |
| **Design intent** | "Feels like a real ad-tech tool not a student project" |
| **Subagent delegation** | "Use the security subagent to review..." |
| **Two-agent quality gate** | Find (security) → Fix (dev) → Verify (qa) |
| **Reality-first docs** | Generate docs from codebase, not from intent |
