const apiKey = process.env.OWM_API_KEY;
if (!apiKey) {
  throw new Error('Missing required environment variable: OWM_API_KEY');
}

const baseUrl = process.env.OWM_BASE_URL ?? 'https://api.openweathermap.org/data/2.5';

// ─── Error type ───────────────────────────────────────────────────────────────

export class OwmError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'OwmError';
    this.statusCode = statusCode;
  }
}

// ─── Location parsing ─────────────────────────────────────────────────────────

// Full state name → ISO 3166-2 code (US only)
const STATE_NAME_TO_CODE = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

/**
 * Resolves a raw state string to its 2-letter ISO code.
 * Returns the original string unchanged if it cannot be resolved.
 */
function resolveStateCode(raw) {
  if (!raw) return raw;
  const upper = raw.toUpperCase().trim();
  if (STATE_CODES.has(upper)) return upper;
  return STATE_NAME_TO_CODE[raw.toLowerCase().trim()] ?? raw;
}

/**
 * Converts a flexible location string to an OWM query-string fragment.
 *
 * Formats handled:
 *   "78701"          → zip=78701,US       (5-digit US ZIP)
 *   "78701-1234"     → zip=78701,US       (ZIP+4)
 *   "Austin, TX"     → q=Austin,TX,US     (city + state abbrev)
 *   "Austin, Texas"  → q=Austin,TX,US     (city + full state name)
 *   "Austin, TX, US" → q=Austin,TX,US     (already fully qualified)
 *   "TX" / "Texas"   → q=TX,US            (state-only, best-effort)
 *   "Austin"         → q=Austin           (plain city, pass-through)
 *
 * @param {string} input
 * @returns {string} Ready-to-append query string fragment (no leading '&' or '?')
 */
export function buildLocationQuery(input) {
  const s = input.trim();

  // US ZIP code — 5-digit or ZIP+4
  if (/^\d{5}(-\d{4})?$/.test(s)) {
    return `zip=${encodeURIComponent(s.slice(0, 5) + ',US')}`;
  }

  // Comma-separated: "city, state" or "city, state, country"
  if (s.includes(',')) {
    const parts  = s.split(',').map(p => p.trim());
    const city   = parts[0];
    const state  = resolveStateCode(parts[1]);
    const country = parts[2] ? parts[2].toUpperCase() : 'US';
    return `q=${encodeURIComponent(`${city},${state},${country}`)}`;
  }

  // State-only input (full name or 2-letter code).
  // resolveStateCode returns the original string when unrecognised, so we must
  // also check whether the input itself is already a valid state code (e.g. "TX").
  const stateCode = resolveStateCode(s);
  if (stateCode !== s || STATE_CODES.has(s.toUpperCase().trim())) {
    return `q=${encodeURIComponent(`${stateCode},US`)}`;
  }

  // Plain city name or unrecognised format — pass through unchanged
  return `q=${encodeURIComponent(s)}`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function localTimeFields(unixSeconds, tzOffsetSeconds) {
  const d = new Date((unixSeconds + tzOffsetSeconds) * 1000);
  return {
    current_hour: d.getUTCHours(),
    day_of_week: d.getUTCDay(),
  };
}

async function owmFetch(path) {
  const response = await fetch(`${baseUrl}${path}&appid=${apiKey}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new OwmError('City not found', 404);
    }
    throw new OwmError(`OpenWeatherMap API error (${response.status})`, 502);
  }

  return response.json();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function fetchCurrentConditions(city) {
  const data = await owmFetch(`/weather?${buildLocationQuery(city)}&units=imperial`);

  const { current_hour, day_of_week } = localTimeFields(data.dt, data.timezone);

  return {
    temp_f: data.main.temp,
    weather_id: data.weather[0].id,
    wind_speed: data.wind?.speed ?? 0,
    current_hour,
    day_of_week,
    description: data.weather[0].description,
    city: data.name,
    country: data.sys.country,
  };
}

export async function fetchHourlyForecast(city, slotCount) {
  const cnt = Math.min(slotCount, 40);
  const data = await owmFetch(`/forecast?${buildLocationQuery(city)}&cnt=${cnt}&units=imperial`);

  const tzOffset = data.city.timezone;

  const slots = data.list.map(entry => {
    const { current_hour, day_of_week } = localTimeFields(entry.dt, tzOffset);
    return {
      temp_f: entry.main.temp,
      weather_id: entry.weather[0].id,
      wind_speed: entry.wind?.speed ?? 0,
      current_hour,
      day_of_week,
      description: entry.weather[0].description,
      dt: entry.dt,
    };
  });

  return {
    city: data.city.name,
    country: data.city.country,
    tz_offset: data.city.timezone, // seconds from UTC — needed for local-date grouping
    slots,
  };
}
