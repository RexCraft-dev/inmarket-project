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
  const data = await owmFetch(`/weather?q=${encodeURIComponent(city)}&units=imperial`);

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
  const data = await owmFetch(`/forecast?q=${encodeURIComponent(city)}&cnt=${cnt}&units=imperial`);

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
    slots,
  };
}
