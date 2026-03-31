/**
 * momentScorer.js
 *
 * Deterministic scoring algorithm for brand moment relevance.
 * All exported functions are pure and side-effect free.
 * Config is loaded once at module level from category-triggers.json.
 *
 * Scoring formula:
 *   moment_score = weather_score (0–40)
 *                + time_score    (0–30)
 *                + day_score     (0–20)
 *                + trend_score  (−10…+10)
 *
 * Final total is clamped to [0, 100].
 *
 * Normalisation baseline: all-neutral conditions → score of 45.
 *   weather neutral (0) → 20/40  +  time neutral (0) → 15/30
 *   + day neutral (0) → 10/20  +  no forecast → 0/10  = 45
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── Config load (module-level, one-time) ─────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const { categories: CATEGORY_WEIGHTS } = JSON.parse(
  readFileSync(join(__dirname, '../config/category-triggers.json'), 'utf8')
);

// ─── OWM code → trigger keys ──────────────────────────────────────────────────

/**
 * Maps an OWM weather condition code plus ancillary readings to the set of
 * active weather trigger keys defined in category-triggers.json.
 *
 * OWM code groups:
 *   2xx Thunderstorm | 3xx Drizzle | 5xx Rain | 6xx Snow
 *   7xx Atmosphere   | 800 Clear   | 80x Clouds
 *
 * Temperature and wind thresholds are orthogonal to the precipitation code,
 * so a hot clear day correctly fires both 'clear-sky' and 'heat'.
 *
 * @param {number} weatherId  OWM weather condition code
 * @param {number} tempF      Current temperature in °F
 * @param {number} windSpeed  Wind speed in mph
 * @returns {string[]} Deduplicated array of active trigger keys
 */
export function mapConditionsToTriggers(weatherId, tempF, windSpeed) {
  const active = new Set();

  if (weatherId >= 200 && weatherId < 300) {
    active.add('rain');
    active.add('wind'); // thunderstorms carry strong gusts by definition
  } else if (weatherId >= 300 && weatherId < 400) {
    active.add('rain'); // drizzle
  } else if (weatherId >= 500 && weatherId < 600) {
    active.add('rain');
  } else if (weatherId >= 600 && weatherId < 700) {
    active.add('snow');
  } else if (weatherId === 771 || weatherId === 781) {
    active.add('wind'); // squalls (771) and tornado (781)
  } else if (weatherId === 800) {
    active.add('clear-sky');
  }
  // 801–804 (cloud cover): no dominant trigger — treated as neutral

  // Temperature triggers are independent of precipitation type
  if (tempF > 85) active.add('heat');
  if (tempF < 40) active.add('cold');

  // Sustained wind independent of weather code (20 mph threshold)
  if (windSpeed >= 20) active.add('wind');

  return [...active];
}

// ─── Signal labels ────────────────────────────────────────────────────────────

/**
 * Human-readable labels for every trigger key that can appear in a signal.
 * Covers all weather triggers, time slots, day slots, and trend directions.
 */
export const SIGNAL_LABELS = {
  // Weather triggers
  rain:              'Active rainfall',
  snow:              'Active snowfall',
  heat:              'High heat (>85°F)',
  cold:              'Cold temperature (<40°F)',
  wind:              'High wind speeds',
  'clear-sky':       'Clear sky / activity planning',
  // Time-of-day slots
  morning:           'Morning commute window',
  lunch:             'Midday lunch window',
  afternoon:         'Afternoon activity window',
  evening:           'Evening out window',
  'late-night':      'Late night / bar close window',
  // Day-of-week slots
  weekday:           'Weekday commuter patterns',
  weekend:           'Weekend leisure patterns',
  // Trend directions
  'trend-improving': 'Conditions improving',
  'trend-worsening': 'Conditions worsening',
  'trend-stable':    'Conditions stable',
};

// ─── Slot mappers ─────────────────────────────────────────────────────────────

/**
 * Maps a local hour (0–23) to a time-of-day trigger key.
 *
 * All 24 hours are covered with no gaps or overlaps (verified):
 *   morning    hours  6–10  [6,  11)  — spec gap at 10 am absorbed into morning
 *   lunch      hours 11–13  [11, 14)
 *   afternoon  hours 14–17  [14, 18)
 *   evening    hours 18–21  [18, 22)
 *   late-night hours 22–23 and 0–5   (default)
 *
 * @param {number} hour  Local hour 0–23
 * @returns {string} Time-of-day trigger key
 */
export function mapHourToTimeSlot(hour) {
  if (hour >= 6  && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'lunch';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'late-night';
}

/**
 * Maps a JS day-of-week number to 'weekday' or 'weekend'.
 *
 * @param {number} dayOfWeek  0 (Sunday) – 6 (Saturday)
 * @returns {'weekday'|'weekend'}
 */
export function mapDayToSlot(dayOfWeek) {
  return (dayOfWeek === 0 || dayOfWeek === 6) ? 'weekend' : 'weekday';
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Maps a raw trigger-weight sum to a component score within [0, maxPoints].
 *
 * JSON weights run −20…+20. Multiple simultaneous weather triggers may push
 * the raw sum outside that window, so we clamp first then scale linearly:
 *
 *   rawSum = −20  →  0              (worst possible for this component)
 *   rawSum =   0  →  maxPoints / 2  (neutral baseline)
 *   rawSum = +20  →  maxPoints      (best possible for this component)
 *
 * @param {number} rawSum    Sum of active trigger weights
 * @param {number} maxPoints Component point budget (40 | 30 | 20)
 * @returns {number} Score in [0, maxPoints]
 */
export function normalise(rawSum, maxPoints) {
  const clamped = Math.max(-20, Math.min(20, rawSum));
  return ((clamped + 20) / 40) * maxPoints;
}

// ─── Component scorers ────────────────────────────────────────────────────────

/**
 * Scores the weather component (budget: 40 pts).
 *
 * Multiple weather triggers may be active simultaneously (e.g. rain + cold).
 * Their weights are summed before normalisation, so co-occurring signals
 * compound each other rather than being averaged.
 *
 * @param {string[]} activeTriggers    Keys from mapConditionsToTriggers()
 * @param {object}   weatherWeights    weights.weather for the category
 * @returns {{ score: number, signals: object[] }}
 */
export function scoreWeather(activeTriggers, weatherWeights) {
  const signals = activeTriggers
    .filter(key => key in weatherWeights)
    .map(key => ({ key, component: 'weather', weight: weatherWeights[key] }));

  const rawSum = signals.reduce((sum, s) => sum + s.weight, 0);
  return { score: normalise(rawSum, 40), signals };
}

/**
 * Scores the time-of-day component (budget: 30 pts).
 *
 * @param {string} timeSlot      Key from mapHourToTimeSlot()
 * @param {object} timeWeights   weights['time-of-day'] for the category
 * @returns {{ score: number, signals: object[] }}
 */
export function scoreTime(timeSlot, timeWeights) {
  const weight = timeWeights[timeSlot] ?? 0;
  return {
    score: normalise(weight, 30),
    signals: [{ key: timeSlot, component: 'time', weight }],
  };
}

/**
 * Scores the day-of-week component (budget: 20 pts).
 *
 * @param {string} daySlot    'weekday' | 'weekend'
 * @param {object} dayWeights weights['day-of-week'] for the category
 * @returns {{ score: number, signals: object[] }}
 */
export function scoreDay(daySlot, dayWeights) {
  const weight = dayWeights[daySlot] ?? 0;
  return {
    score: normalise(weight, 20),
    signals: [{ key: daySlot, component: 'day', weight }],
  };
}

/**
 * Scores the trend component (budget: ±10 pts).
 *
 * Compares the raw weather-trigger weight sum for the current period against
 * the first forecast entry.  A positive delta means the category's weather
 * moment is improving (e.g. rain intensifying for delivery-food); negative
 * means it is worsening.  Returns 0 when no forecast data is provided.
 *
 * @param {{ weather_id: number, temp_f: number, wind_speed: number }} current
 * @param {{ weather_id: number, temp_f: number, wind_speed: number }|null} nextHour
 * @param {object} categoryWeights  Full category weights object
 * @returns {{ score: number, signals: object[] }}
 */
export function scoreTrend(current, nextHour, categoryWeights) {
  if (!nextHour) {
    return {
      score: 0,
      signals: [{ key: 'trend-stable', component: 'trend', weight: 0 }],
    };
  }

  const ww = categoryWeights.weather;

  const rawCurrent = mapConditionsToTriggers(current.weather_id, current.temp_f, current.wind_speed)
    .reduce((sum, k) => sum + (ww[k] ?? 0), 0);

  const rawNext = mapConditionsToTriggers(nextHour.weather_id, nextHour.temp_f, nextHour.wind_speed)
    .reduce((sum, k) => sum + (ww[k] ?? 0), 0);

  // Positive delta = conditions getting better for this category
  const delta = rawNext - rawCurrent;
  // Scale [-20, +20] → [-10, +10]
  const trendScore = (Math.max(-20, Math.min(20, delta)) / 20) * 10;

  const direction = trendScore >  0.5 ? 'improving'
    :               trendScore < -0.5 ? 'worsening'
    :                                   'stable';

  return {
    score: trendScore,
    signals: [{ key: `trend-${direction}`, component: 'trend', weight: Math.round(trendScore) }],
  };
}

// ─── Signal ranking ───────────────────────────────────────────────────────────

/**
 * Returns the top N signals from a pre-annotated list, prioritising active
 * ones (triggers that matched the current conditions) before inactive ones
 * (high-weight triggers that did not fire).  Within each group signals are
 * sorted by absolute weight desc.  Inactive signals pad the result only when
 * fewer than N active signals exist.  Every returned signal is enriched with
 * a human-readable `label` from SIGNAL_LABELS.
 *
 * Each signal in `signals` must already carry `active: boolean`, set by the
 * caller based on the exact output of the mapper functions — not inferred from
 * list membership.
 *
 * @param {Array<{ key: string, component: string, weight: number, active: boolean }>} signals
 * @param {number} n
 * @returns {Array<{ key: string, label: string, component: string, weight: number, active: boolean }>}
 */
export function topSignals(signals, n = 3) {
  const byAbsWeight = (a, b) => Math.abs(b.weight) - Math.abs(a.weight);

  const active = signals.filter(s => s.active).sort(byAbsWeight).slice(0, n)
    .map(s => ({ ...s, label: SIGNAL_LABELS[s.key] ?? s.key }));

  const slots = n - active.length;
  const padding = slots > 0
    ? signals.filter(s => !s.active).sort(byAbsWeight).slice(0, slots)
        .map(s => ({ ...s, label: SIGNAL_LABELS[s.key] ?? s.key }))
    : [];

  return [...active, ...padding];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Computes a moment relevance score for a brand category given current conditions.
 *
 * @param {object}   conditions
 * @param {number}   conditions.temp_f        Current temperature in °F
 * @param {number}   conditions.weather_id    OWM weather condition code
 * @param {number}   conditions.wind_speed    Wind speed in mph
 * @param {number}   conditions.current_hour  Local hour 0–23
 * @param {number}   conditions.day_of_week   Local day 0 (Sun) – 6 (Sat)
 * @param {object[]} [conditions.forecast]    Optional next-hour forecast entries,
 *                                            each { weather_id, temp_f, wind_speed }
 * @param {string}   category                 One of the 9 category slugs
 *
 * @returns {{
 *   total: number,
 *   breakdown: { weather: number, time: number, day: number, trend: number },
 *   signals: Array<{ key: string, label: string, component: string, weight: number, active: boolean }>
 * }}
 *
 * @throws {Error} If category is not recognised
 *
 * @example
 * // Mild clear afternoon on a weekday — only 1 weather trigger (clear-sky)
 * scoreMoment(
 *   { temp_f: 72, weather_id: 800, wind_speed: 5, current_hour: 15, day_of_week: 3 },
 *   'outdoor-apparel'
 * )
 * // → { total: 46, breakdown: { weather: 22.5, time: 15, day: 9, trend: 0 },
 * //     signals: [
 * //       { key: 'weekday',   active: true,  ... weight: -2  },
 * //       { key: 'afternoon', active: true,  ... weight: 10  },
 * //       { key: 'clear-sky', active: true,  ... weight:  5  },
 * //       // 'cold' (weight 19) would pad here if only 2 active signals existed
 * //     ] }
 */
export function scoreMoment(conditions, category) {
  const weights = CATEGORY_WEIGHTS[category];
  if (!weights) {
    throw new Error(
      `Unknown category: "${category}". ` +
      `Valid values: ${Object.keys(CATEGORY_WEIGHTS).join(', ')}`
    );
  }

  const { temp_f, weather_id, wind_speed, current_hour, day_of_week, forecast } = conditions;

  const activeTriggers = mapConditionsToTriggers(weather_id, temp_f, wind_speed);
  const timeSlot       = mapHourToTimeSlot(current_hour);
  const daySlot        = mapDayToSlot(day_of_week);
  const nextHour       = Array.isArray(forecast) && forecast.length > 0 ? forecast[0] : null;

  const weatherResult = scoreWeather(activeTriggers, weights.weather);
  const timeResult    = scoreTime(timeSlot, weights['time-of-day']);
  const dayResult     = scoreDay(daySlot, weights['day-of-week']);
  const trendResult   = scoreTrend(conditions, nextHour, weights);

  const rawTotal = weatherResult.score + timeResult.score + dayResult.score + trendResult.score;
  const total    = Math.round(Math.max(0, Math.min(100, rawTotal)));

  // Build one annotated signal list.  `active` is derived directly from the
  // mapper outputs — the only source of truth for what fired this call:
  //   weather → key must be in activeTriggers (mapConditionsToTriggers result)
  //   time    → key must === timeSlot         (mapHourToTimeSlot result)
  //   day     → key must === daySlot          (mapDayToSlot result)
  //   trend   → always active (computed directional value, not a selectable key)
  const activeWeatherKeys = new Set(activeTriggers);

  const signals = [
    ...Object.entries(weights.weather)
      .filter(([k]) => !k.startsWith('_'))
      .map(([key, weight]) => ({ key, component: 'weather', weight, active: activeWeatherKeys.has(key) })),

    ...Object.entries(weights['time-of-day'])
      .map(([key, weight]) => ({ key, component: 'time', weight, active: key === timeSlot })),

    ...Object.entries(weights['day-of-week'])
      .map(([key, weight]) => ({ key, component: 'day', weight, active: key === daySlot })),

    { ...trendResult.signals[0], active: true },
  ];

  return {
    total,
    breakdown: {
      weather: round1dp(weatherResult.score),
      time:    round1dp(timeResult.score),
      day:     round1dp(dayResult.score),
      trend:   round1dp(trendResult.score),
    },
    signals: topSignals(signals),
    // Full annotated list (all components, all triggers) for detailed breakdown UIs.
    // Each entry carries active:boolean and label so callers need no extra lookups.
    all_signals: signals.map(s => ({ ...s, label: SIGNAL_LABELS[s.key] ?? s.key })),
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function round1dp(n) {
  return Math.round(n * 10) / 10;
}
