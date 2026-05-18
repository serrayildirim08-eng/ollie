/**
 * Sprint 5 · F6 · local weather pill.
 *
 * Mocks geolocation + fetch. Asserts the pill string matches the
 * BigDataCloud reverse-geocode city + Open-Meteo current weather.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getLocalWeather, formatWeatherPill, __internal } from './weather';

// Brooklyn-ish coords
const LAT = 40.6782;
const LNG = -73.9442;

function inMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k: string) { return map.has(k) ? (map.get(k) as string) : null; },
    key(i: number) { return Array.from(map.keys())[i] ?? null; },
    removeItem(k: string) { map.delete(k); },
    setItem(k: string, v: string) { map.set(k, v); },
  } as Storage;
}

function makeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (urlInput: string | URL | Request) => {
    const url = typeof urlInput === 'string' ? urlInput : urlInput.toString();
    for (const [prefix, payload] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('getLocalWeather (F6)', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = inMemoryStorage();
  });

  it('Brooklyn coords → BROOKLYN · 60° · CLOUDY pill', async () => {
    const fetchImpl = makeFetch({
      'https://api.bigdatacloud.net/data/reverse-geocode-client':
        { city: 'Brooklyn', locality: 'Brooklyn', principalSubdivision: 'New York' },
      'https://api.open-meteo.com/v1/forecast':
        { current: { temperature_2m: 15.5, weather_code: 3 } }, // 15.5C ~ 60F, code 3 = cloudy
    });
    const w = await getLocalWeather({
      fetchImpl,
      getPosition: async () => ({ latitude: LAT, longitude: LNG }),
      storage,
      now: () => 1_000,
    });
    expect(w).not.toBeNull();
    expect(w!.city).toBe('Brooklyn');
    expect(w!.condition).toBe('cloudy');
    expect(w!.temp_f).toBe(60);
    expect(formatWeatherPill(w!, 'en-US')).toBe('BROOKLYN · 60° · CLOUDY');
  });

  it('returns null if geolocation denied', async () => {
    const w = await getLocalWeather({
      fetchImpl: makeFetch({}),
      getPosition: async () => { throw new Error('permission denied'); },
      storage,
      now: () => 1_000,
    });
    expect(w).toBeNull();
  });

  it('returns null if weather API fails', async () => {
    // Reverse-geocode succeeds but Open-Meteo fails with non-2xx.
    const fetchImpl: typeof fetch = (async (urlInput: string | URL | Request) => {
      const url = typeof urlInput === 'string' ? urlInput : urlInput.toString();
      if (url.startsWith('https://api.bigdatacloud.net/')) {
        return new Response(JSON.stringify({ city: 'Brooklyn' }), { status: 200 });
      }
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;
    const w = await getLocalWeather({
      fetchImpl,
      getPosition: async () => ({ latitude: LAT, longitude: LNG }),
      storage,
      now: () => 1_000,
    });
    expect(w).toBeNull();
  });

  it('hits cache on second call within TTL', async () => {
    let fetches = 0;
    const fetchImpl = ((urlInput: string | URL | Request) => {
      fetches++;
      const url = typeof urlInput === 'string' ? urlInput : urlInput.toString();
      const body = url.startsWith('https://api.bigdatacloud.net/')
        ? { city: 'Brooklyn' }
        : { current: { temperature_2m: 15.5, weather_code: 3 } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as unknown as typeof fetch;
    const w1 = await getLocalWeather({
      fetchImpl,
      getPosition: async () => ({ latitude: LAT, longitude: LNG }),
      storage,
      now: () => 1_000,
    });
    expect(w1).not.toBeNull();
    const beforeSecond = fetches;
    const w2 = await getLocalWeather({
      fetchImpl,
      getPosition: async () => ({ latitude: LAT, longitude: LNG }),
      storage,
      now: () => 1_000 + 30 * 60 * 1000, // 30 min later, still within 1h TTL
    });
    expect(fetches).toBe(beforeSecond); // no new fetch
    expect(w2!.city).toBe('Brooklyn');
  });

  it('cache expires after TTL', async () => {
    let fetches = 0;
    const fetchImpl = ((urlInput: string | URL | Request) => {
      fetches++;
      const url = typeof urlInput === 'string' ? urlInput : urlInput.toString();
      const body = url.startsWith('https://api.bigdatacloud.net/')
        ? { city: 'Brooklyn' }
        : { current: { temperature_2m: 15.5, weather_code: 3 } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as unknown as typeof fetch;
    await getLocalWeather({
      fetchImpl,
      getPosition: async () => ({ latitude: LAT, longitude: LNG }),
      storage,
      now: () => 1_000,
    });
    const beforeSecond = fetches;
    await getLocalWeather({
      fetchImpl,
      getPosition: async () => ({ latitude: LAT, longitude: LNG }),
      storage,
      now: () => 1_000 + 2 * __internal.CACHE_TTL_MS, // past TTL
    });
    expect(fetches).toBeGreaterThan(beforeSecond);
  });
});

describe('formatWeatherPill (F6)', () => {
  it('en-US uses Fahrenheit', () => {
    const pill = formatWeatherPill(
      { city: 'Brooklyn', temp_c: 15.5, temp_f: 60, condition: 'cloudy', fetched_at: 0, lat: 0, lng: 0 },
      'en-US',
    );
    expect(pill).toBe('BROOKLYN · 60° · CLOUDY');
  });

  it('non-US locale uses Celsius', () => {
    const pill = formatWeatherPill(
      { city: 'paris', temp_c: 15.5, temp_f: 60, condition: 'rain', fetched_at: 0, lat: 0, lng: 0 },
      'fr-FR',
    );
    expect(pill).toBe('PARIS · 16° · RAIN');
  });
});
