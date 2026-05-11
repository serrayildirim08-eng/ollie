/**
 * apps/web · sky video selection
 *
 * Returns the right sky video for the given hour of day + (optional)
 * weather code. Tries the local-cached copy first; CDN URL is provided
 * as a fallback that consumers wire via the `<video>` `onError` handler.
 *
 * Five visuals: clear-day, clear-night, sunset, sunrise, overcast.
 * Files live at /videos/sky-*.mp4 in `apps/web/public/`; the service
 * worker (apps/web/public/sw.js) pre-caches them on first load.
 */

export type SkyKey =
  | 'clearDay'
  | 'clearNight'
  | 'sunset'
  | 'sunrise'
  | 'overcast';

const LOCAL: Record<SkyKey, string> = {
  clearDay: '/videos/sky-clear-day.mp4',
  clearNight: '/videos/sky-clear-night.mp4',
  sunset: '/videos/sky-sunset.mp4',
  sunrise: '/videos/sky-sunrise.mp4',
  overcast: '/videos/sky-overcast.mp4',
};

const CDN: Record<SkyKey, string> = {
  clearDay: 'https://assets.mixkit.co/videos/26108/26108-720.mp4',
  clearNight: 'https://assets.mixkit.co/videos/1610/1610-720.mp4',
  sunset: 'https://assets.mixkit.co/videos/4119/4119-720.mp4',
  sunrise: 'https://assets.mixkit.co/videos/51102/51102-720.mp4',
  overcast: 'https://assets.mixkit.co/videos/9680/9680-720.mp4',
};

export interface SkyVideoSrc {
  key: SkyKey;
  local: string;
  cdn: string;
}

export function pickSkyKey(hour: number, overcast?: boolean): SkyKey {
  if (overcast) return 'overcast';
  if (hour >= 5 && hour < 7) return 'sunrise';
  if (hour >= 7 && hour < 18) return 'clearDay';
  if (hour >= 18 && hour < 20) return 'sunset';
  return 'clearNight';
}

export function getSkyVideoSrc(hour: number, overcast?: boolean): SkyVideoSrc {
  const key = pickSkyKey(hour, overcast);
  return { key, local: LOCAL[key], cdn: CDN[key] };
}
