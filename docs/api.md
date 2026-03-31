# API Reference

## MCP Server — `http://localhost:3001`

All endpoints return `{ ok: true, data: {...} }` on success or `{ ok: false, error: "..." }` on failure.

---

### GET /moments/score

Returns the current moment relevance score for a city and brand category.

**Query params:**
- `city` (string, required) — city name e.g. `Austin`
- `category` (string, required) — one of the 9 valid slugs (see `/moments/triggers`)

**Response:**
```json
{
  "ok": true,
  "data": {
    "city": "Austin",
    "category": "coffee",
    "score": 67,
    "breakdown": { "weather": 22.5, "time": 15.0, "day": 10.0, "trend": -2.1 },
    "signals": [
      { "key": "morning", "label": "Morning commute window", "component": "time", "weight": 20, "active": true }
    ],
    "all_signals": [ /* all triggers for the category with active:boolean */ ],
    "conditions": {
      "temp_f": 68, "weather_id": 800, "wind_speed": 12,
      "current_hour": 7, "day_of_week": 3, "description": "clear sky"
    },
    "timestamp": "2026-03-31T14:25:33.000Z"
  }
}
```

**Errors:** 400 invalid params · 404 city not found · 502 OWM API error

---

### GET /moments/forecast-window

Finds the best activation window within the next N hours.

**Query params:**
- `city` (string, required)
- `category` (string, required)
- `hours` (integer 1–48, optional, default 6)

**Response:**
```json
{
  "ok": true,
  "data": {
    "city": "Austin", "country": "US", "category": "coffee",
    "hours_ahead": 6,
    "start_time": "2026-03-31T12:00:00.000Z",
    "end_time": "2026-03-31T15:00:00.000Z",
    "peak_score": 72,
    "peak_hour": 8,
    "reason": "Morning commute window, Clear sky",
    "all_slots": [ { "dt": 1743422400, "local_hour": 8, "score": 72, "description": "clear sky" } ]
  }
}
```

---

### GET /moments/compare

Ranks 2–10 cities by moment relevance for a category.

**Query params:**
- `cities` (string, required) — comma-separated city names e.g. `Austin,Denver,Chicago`
- `category` (string, required)

**Response:**
```json
{
  "ok": true,
  "data": [
    { "rank": 1, "city": "Denver", "country": "US", "score": 78, "breakdown": {...}, "top_signals": [...] }
  ],
  "errors": [ { "city": "BadCity", "error": "City not found", "score": null } ]
}
```

---

### GET /moments/forecast-7day

Returns daily peak scores and intraday sparkline data for up to 5 days (OWM free-tier limit).

**Query params:**
- `city` (string, required)
- `category` (string, required)

**Response:**
```json
{
  "ok": true,
  "data": {
    "city": "Austin", "country": "US", "category": "coffee",
    "days": [
      {
        "date": "2026-03-31",
        "peak_score": 72, "avg_score": 58, "peak_hour": 8,
        "peak_window_start": "2026-03-31T13:00:00.000Z",
        "peak_window_end": "2026-03-31T16:00:00.000Z",
        "reason": "Morning commute window",
        "top_signals": [ { "key": "morning", "label": "Morning commute window", "component": "time", "weight": 20, "active": true } ],
        "slot_scores": [ { "hour": 6, "score": 55 }, { "hour": 8, "score": 72 } ]
      }
    ],
    "note": "OWM free tier provides up to 5 days (5 days available)"
  }
}
```

---

### GET /moments/triggers

Returns the raw scoring weights for all triggers in a category.

**Query params:**
- `category` (string, required)

**Response:**
```json
{
  "ok": true,
  "data": {
    "category": "coffee",
    "weights": {
      "weather": { "rain": 14, "snow": 11, "heat": -6, "cold": 16, "wind": 9, "clear-sky": 2 },
      "time-of-day": { "morning": 20, "lunch": 6, "afternoon": 9, "evening": -4, "late-night": -12 },
      "day-of-week": { "weekday": 11, "weekend": 4 }
    }
  }
}
```

---

### GET /moments/conditions

Returns current normalised weather conditions for a city (no scoring).

**Query params:**
- `city` (string, required)

**Response:**
```json
{
  "ok": true,
  "data": {
    "city": "Austin", "country": "US",
    "temp_f": 68, "weather_id": 800, "wind_speed": 12,
    "current_hour": 7, "day_of_week": 3, "description": "clear sky",
    "timezone": "America/Chicago", "tz_offset": -18000
  }
}
```

---

### GET /health

```json
{ "status": "ok", "service": "moments-mcp-server", "timestamp": "2026-03-31T14:00:00.000Z" }
```

---

## Agent — `http://localhost:3000`

---

### POST /analyze

Runs the LangChain agent and returns a BUY / HOLD / WAIT recommendation plus structured score data.

**Request body:**
```json
{
  "question": "Should I run coffee ads in Austin right now?",
  "city": "Austin",
  "category": "coffee",
  "cities": ["Austin", "Denver"]
}
```

- `question` (string, required, max 2000 chars)
- `city` (string, optional) — used to pre-populate agent context and fetch `scoreData`
- `category` (string, optional) — used alongside `city` for parallel score fetch
- `cities` (string[], optional) — for multi-city comparison questions

**Response:**
```json
{
  "ok": true,
  "data": {
    "answer": "BUY — Morning conditions are optimal with clear skies...",
    "question": "Should I run coffee ads in Austin right now?",
    "scoreData": {
      "city": "Austin", "category": "coffee", "score": 72,
      "breakdown": { "weather": 22.5, "time": 22.5, "day": 13.0, "trend": 2.0 },
      "signals": [ /* top 3 signals */ ],
      "all_signals": [ /* all triggers with active:boolean */ ],
      "conditions": { "temp_f": 68, "description": "clear sky", "wind_speed": 12, "current_hour": 8, "day_of_week": 1 }
    }
  }
}
```

`scoreData` is present only when both `city` and `category` are provided. A scoring failure never blocks the LLM answer.

**Errors:** 400 invalid body · 500 LLM or tool error

---

### GET /health

```json
{ "status": "ok", "service": "moments-agent", "timestamp": "2026-03-31T14:00:00.000Z" }
```

---

## LangChain Tools (agent-internal)

These tools are available to the LLM during agent execution. They wrap MCP server endpoints.

| Tool | MCP endpoint | Key params |
|---|---|---|
| `get_moment_score` | `GET /moments/score` | `city`, `category` |
| `get_forecast_window` | `GET /moments/forecast-window` | `city`, `category`, `hours` (default 6) |
| `compare_moments` | `GET /moments/compare` | `cities[]` (2–10), `category` |
| `get_triggers` | `GET /moments/triggers` | `category` |
| `get_conditions` | `GET /moments/conditions` | `city` |

Valid `category` values: `coffee`, `delivery-food`, `grocery`, `auto-insurance`, `ride-share`, `sporting-goods`, `outdoor-apparel`, `home-improvement`, `quick-service-restaurant`
