/**
 * Local weather + reverse-geocode (Sprint 5 · F6)
 *
 * Two free, key-less APIs:
 *   - BigDataCloud reverse geocode  (https://api.bigdatacloud.net/data/reverse-geocode-client)
 *   - Open-Meteo current weather    (https://api.open-meteo.com/v1/forecast)
 *
 * Cache for 1h in localStorage to avoid hammering on every reload. The
 * caller renders nothing if `null` is returned (offline / blocked
 * permissions / API failure).
 *
 * Brand voice: "BROOKLYN · 60° · CLOUDY" — all caps, mono, single dot
 * separators. Two units (F today) — units are an open question. For
 * now: imperial when locale starts with en-US, metric otherwise.
 */

export interface WeatherSummary {
  city: string;
  temp_f: number;
  temp_c: number;
  condition: string;
  /** ts when this was fetched */
  fetched_at: number;
  /** lat/lng so cache can be invalidated when location changes */
  lat: number;
  lng: number;
}

const CACHE_KEY = 'ollie:weather:current';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

// ─── Open-Meteo weather code → label ───────────────────────────────────────
// https://open-meteo.com/en/docs#weathervariables
const WEATHER_CODE_LABEL: Record<number, string> = {
  0: 'clear',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'cloudy',
  45: 'fog',
  48: 'fog',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  61: 'rain',
  63: 'rain',
  65: 'rain',
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snow',
  80: 'showers',
  81: 'showers',
  82: 'showers',
  85: 'snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm',
  99: 'thunderstorm',
};

function weatherCodeLabel(code: number): string {
  return WEATHER_CODE_LABEL[code] ?? 'unknown';
}

// ─── HTTP impl injection (for tests) ───────────────────────────────────────

export interface WeatherDeps {
  fetchImpl?: typeof fetch;
  /** Inject a geolocation provider — useful for tests / Capacitor native. */
  getPosition?: () => Promise<{ latitude: number; longitude: number }>;
  /** Inject "now" for cache age math. */
  now?: () => number;
  /** Inject storage. Browser default is window.localStorage. */
  storage?: Storage;
}

function defaultGetPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(new Error(err.message || 'permission denied')),
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}

// ─── Cache ──────────────────────────────────────────────────────────────────

function readCache(storage: Storage | undefined, now: () => number): WeatherSummary | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as WeatherSummary;
    if (!cached.fetched_at || now() - cached.fetched_at > CACHE_TTL_MS) return null;
    return cached;
  } catch { return null; }
}

function writeCache(storage: Storage | undefined, value: WeatherSummary): void {
  if (!storage) return;
  try { storage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* quota etc */ }
}

// ─── Fetchers ───────────────────────────────────────────────────────────────

async function reverseGeocode(
  fetchImpl: typeof fetch,
  lat: number,
  lng: number,
): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error('reverse-geocode failed: http ' + r.status);
  const data = (await r.json()) as { city?: string; locality?: string; principalSubdivision?: string };
  const city = data.city || data.locality || data.principalSubdivision || 'unknown';
  return String(city);
}

async function fetchWeather(
  fetchImpl: typeof fetch,
  lat: number,
  lng: number,
): Promise<{ temp_c: number; code: number }> {
  // Open-Meteo: temperature_2m + weather_code in metric (C)
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,weather_code`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error('weather failed: http ' + r.status);
  const data = (await r.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
  if (!data.current || typeof data.current.temperature_2m !== 'number') {
    throw new Error('weather: missing current');
  }
  return {
    temp_c: data.current.temperature_2m,
    code: data.current.weather_code ?? 0,
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Returns the current local weather, or null if anything fails (offline,
 * permission denied, no API). 1h localStorage cache.
 */
export async function getLocalWeather(deps: WeatherDeps = {}): Promise<WeatherSummary | null> {
  const fetchImpl: typeof fetch = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (null as unknown as typeof fetch));
  const getPosition = deps.getPosition ?? defaultGetPosition;
  const now = deps.now ?? (() => Date.now());
  const storage =
    deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);

  // Cache check
  const cached = readCache(storage, now);
  if (cached) return cached;

  try {
    if (!fetchImpl) return null;
    const pos = await getPosition();
    const [city, weather] = await Promise.all([
      reverseGeocode(fetchImpl, pos.latitude, pos.longitude),
      fetchWeather(fetchImpl, pos.latitude, pos.longitude),
    ]);
    const temp_c = weather.temp_c;
    const temp_f = Math.round((temp_c * 9) / 5 + 32);
    const summary: WeatherSummary = {
      city,
      temp_c,
      temp_f,
      condition: weatherCodeLabel(weather.code),
      fetched_at: now(),
      lat: pos.latitude,
      lng: pos.longitude,
    };
    writeCache(storage, summary);
    return summary;
  } catch (err) {
    // Failed silently — caller hides the row.
    if (typeof console !== 'undefined') {
      console.warn('[weather] unavailable:', (err as Error).message);
    }
    return null;
  }
}

/**
 * Format the weather summary for the home pill.
 * Locale en-US-ish → imperial, otherwise metric.
 */
export function formatWeatherPill(s: WeatherSummary, locale?: string): string {
  const useImperial = (locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US')).toLowerCase().startsWith('en-us');
  const temp = useImperial ? `${s.temp_f}°` : `${Math.round(s.temp_c)}°`;
  return `${s.city.toUpperCase()} · ${temp} · ${s.condition.toUpperCase()}`;
}

// Internal exports for unit tests.
export const __internal = {
  weatherCodeLabel,
  CACHE_KEY,
  CACHE_TTL_MS,
};
