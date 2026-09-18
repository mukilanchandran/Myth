// The home backdrop: a light WebM (2560×1440, ~6 MB) with a small poster frame.
// The poster paints at once; the video fades in over it as soon as it can play.
import { asset } from './config/env';

export const HOME_VIDEO = encodeURI(asset('Home Vd Web.webm'));
export const HOME_POSTER = asset('home-poster.jpg'); // first frame of the video, ~70 KB

let warm = null;

/**
 * Start the download while the lock screen is still up, so the dashboard opens
 * with the video already in the browser cache. Desktop only (phones show a
 * still), and never on a data-saver connection.
 */
export function warmHomeVideo() {
  if (warm || typeof window === 'undefined') return;
  if (!window.matchMedia('(min-width: 1000px)').matches || navigator.connection?.saveData) return;
  new Image().src = HOME_POSTER;
  warm = document.createElement('video');
  warm.muted = true;
  warm.preload = 'auto';
  warm.src = HOME_VIDEO;
  warm.load();
}
