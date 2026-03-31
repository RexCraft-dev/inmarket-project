import { Router } from 'express';
import { z, ZodError } from 'zod';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchCurrentConditions, fetchHourlyForecast, OwmError } from '../services/owmClient.js';
import { scoreMoment } from '../services/momentScorer.js';

// ─── Config load ──────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { categories: CATEGORY_WEIGHTS } = JSON.parse(
  readFileSync(join(__dirname, '../config/category-triggers.json'), 'utf8')
);

const VALID_CATEGORIES = /** @type {[string, ...string[]]} */ (Object.keys(CATEGORY_WEIGHTS));

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const categorySchema = z.enum(VALID_CATEGORIES, {
  errorMap: () => ({ message: `Invalid category. Valid values: ${VALID_CATEGORIES.join(', ')}` }),
});

const scoreSchema = z.object({
  city: z.string().min(1, 'city parameter is required'),
  category: categorySchema,
});

const forecastWindowSchema = z.object({
  city: z.string().min(1, 'city parameter is required'),
  category: categorySchema,
  hours: z.coerce.number().int().min(1).max(48).default(6),
});

const compareSchema = z.object({
  cities: z
    .string()
    .min(1, 'cities is required')
    .transform(s => s.split(',').map(c => c.trim()).filter(Boolean))
    .refine(arr => arr.length >= 2, 'At least 2 cities required')
    .refine(arr => arr.length <= 10, 'Maximum 10 cities'),
  category: categorySchema,
});

const forecastSevenDaySchema = z.object({
  city:     z.string().min(1, 'city parameter is required'),
  category: categorySchema,
});

const triggersSchema = z.object({
  category: categorySchema,
});

const conditionsSchema = z.object({
  city: z.string().min(1, 'city parameter is required'),
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// GET /score
router.get('/score', async (req, res, next) => {
  try {
    const { city, category } = scoreSchema.parse(req.query);
    const conditions = await fetchCurrentConditions(city);
    const { total, breakdown, signals } = scoreMoment(conditions, category);
    res.json({
      ok: true,
      data: {
        city: conditions.city,
        category,
        score: total,
        breakdown,
        signals,
        conditions: {
          temp_f: conditions.temp_f,
          weather_id: conditions.weather_id,
          wind_speed: conditions.wind_speed,
          current_hour: conditions.current_hour,
          day_of_week: conditions.day_of_week,
          description: conditions.description,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /forecast-window
router.get('/forecast-window', async (req, res, next) => {
  try {
    const { city, category, hours } = forecastWindowSchema.parse(req.query);
    const slotCount = Math.ceil(hours / 3);
    const { city: resolvedCity, country, slots } = await fetchHourlyForecast(city, slotCount);

    const scored = slots.map((slot, i) => {
      const c = { ...slot, forecast: slots[i + 1] ? [slots[i + 1]] : [] };
      const { total, breakdown, signals } = scoreMoment(c, category);
      return { ...slot, score: total, breakdown, signals };
    });

    const peak = scored.reduce((best, curr) => (curr.score > best.score ? curr : best));
    const start_time = new Date(peak.dt * 1000).toISOString();
    const end_time = new Date((peak.dt + 10800) * 1000).toISOString();

    const activeSignals = peak.signals.filter(s => s.active && s.weight > 0);
    const reason =
      activeSignals.length > 0
        ? activeSignals
            .slice(0, 2)
            .map(s => s.label)
            .join(', ')
        : `Neutral conditions for ${category}`;

    res.json({
      ok: true,
      data: {
        city: resolvedCity,
        country,
        category,
        hours_ahead: hours,
        start_time,
        end_time,
        peak_score: peak.score,
        peak_hour: peak.current_hour,
        reason,
        all_slots: scored.map(s => ({
          dt: s.dt,
          local_hour: s.current_hour,
          score: s.score,
          description: s.description,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /compare
router.get('/compare', async (req, res, next) => {
  try {
    const { cities, category } = compareSchema.parse(req.query);

    const results = await Promise.all(
      cities.map(async city => {
        try {
          const conditions = await fetchCurrentConditions(city);
          const { total, breakdown, signals } = scoreMoment(conditions, category);
          return {
            city: conditions.city,
            country: conditions.country,
            score: total,
            breakdown,
            signals,
          };
        } catch (err) {
          if (err instanceof OwmError && err.statusCode === 404) {
            return { city, error: 'City not found', score: null };
          }
          throw err;
        }
      })
    );

    const ranked = results
      .filter(r => r.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({
        rank: i + 1,
        city: r.city,
        country: r.country,
        score: r.score,
        breakdown: r.breakdown,
        top_signals: r.signals.filter(s => s.active),
      }));

    const failed = results.filter(r => r.score === null);

    res.json({
      ok: true,
      data: ranked,
      ...(failed.length > 0 && { errors: failed }),
    });
  } catch (err) {
    next(err);
  }
});

// GET /forecast-7day
router.get('/forecast-7day', async (req, res, next) => {
  try {
    const { city, category } = forecastSevenDaySchema.parse(req.query);

    // Fetch max free-tier slots (40 × 3 h = 120 h ≈ 5 days)
    const { city: resolvedCity, country, tz_offset, slots } =
      await fetchHourlyForecast(city, 40);

    // Score every slot, passing the next slot as the trend forecast
    const scored = slots.map((slot, i) => {
      const c = { ...slot, forecast: slots[i + 1] ? [slots[i + 1]] : [] };
      const { total, breakdown, signals } = scoreMoment(c, category);
      return { ...slot, score: total, breakdown, signals };
    });

    // Group slots into local calendar days using the city's UTC offset
    const toLocalDate = dt => {
      const d = new Date((dt + tz_offset) * 1000);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const dayMap = new Map();
    for (const slot of scored) {
      const date = toLocalDate(slot.dt);
      if (!dayMap.has(date)) dayMap.set(date, []);
      dayMap.get(date).push(slot);
    }

    const days = [...dayMap.entries()].map(([date, daySlots]) => {
      const peak = daySlots.reduce((best, s) => s.score > best.score ? s : best);
      const avgScore = Math.round(
        daySlots.reduce((sum, s) => sum + s.score, 0) / daySlots.length
      );

      const topActive = peak.signals.filter(s => s.active && s.weight > 0).slice(0, 2);
      const reason = topActive.length > 0
        ? topActive.map(s => s.label).join(' + ')
        : 'Neutral conditions';

      return {
        date,
        peak_score:        peak.score,
        avg_score:         avgScore,
        peak_hour:         peak.current_hour,
        peak_window_start: new Date(peak.dt * 1000).toISOString(),
        peak_window_end:   new Date((peak.dt + 10800) * 1000).toISOString(),
        reason,
        top_signals:  peak.signals.filter(s => s.active),
        // Per-slot scores let the frontend draw an intraday sparkline
        slot_scores:  daySlots.map(s => ({ hour: s.current_hour, score: s.score })),
      };
    });

    const note = days.length < 7
      ? `OWM free tier provides up to 5 days (${days.length} day${days.length !== 1 ? 's' : ''} available)`
      : undefined;

    res.json({ ok: true, data: { city: resolvedCity, country, category, days, ...(note && { note }) } });
  } catch (err) {
    next(err);
  }
});

// GET /triggers
router.get('/triggers', async (req, res, next) => {
  try {
    const { category } = triggersSchema.parse(req.query);
    const { weather, 'time-of-day': timeOfDay, 'day-of-week': dayOfWeek } = CATEGORY_WEIGHTS[category];
    res.json({
      ok: true,
      data: {
        category,
        weights: {
          weather,
          'time-of-day': timeOfDay,
          'day-of-week': dayOfWeek,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /conditions
router.get('/conditions', async (req, res, next) => {
  try {
    const { city } = conditionsSchema.parse(req.query);
    const conditions = await fetchCurrentConditions(city);
    res.json({ ok: true, data: conditions });
  } catch (err) {
    next(err);
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────

router.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: err.errors[0].message });
  }
  if (err instanceof OwmError) {
    return res.status(err.statusCode).json({ ok: false, error: err.message });
  }
  next(err);
});

export default router;
