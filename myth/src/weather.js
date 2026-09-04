// Weather via Open-Meteo — free, no API key, no account.
// Default location: Perungudi, Chennai, Tamil Nadu.
import {
  IconSun, IconCloud, IconCloudFog, IconCloudRain, IconCloudSnow, IconCloudStorm, IconDroplets,
} from '@tabler/icons-react';

export const DEFAULT_LOCATION = { name: 'Perungudi, Chennai', lat: 12.9575, lon: 80.24 };

// WMO weather code → icon/label/color
const CODES = [
  { test: (c) => c === 0, label: 'Clear sky', icon: IconSun, color: '#f59f00' },
  { test: (c) => c === 1, label: 'Mostly clear', icon: IconSun, color: '#f59f00' },
  { test: (c) => c === 2, label: 'Partly cloudy', icon: IconCloud, color: '#74869a' },
  { test: (c) => c === 3, label: 'Overcast', icon: IconCloud, color: '#5c6d80' },
  { test: (c) => c === 45 || c === 48, label: 'Foggy', icon: IconCloudFog, color: '#8195a8' },
  { test: (c) => c >= 51 && c <= 57, label: 'Drizzle', icon: IconDroplets, color: '#3b82c4' },
  { test: (c) => (c >= 61 && c <= 67) || (c >= 80 && c <= 82), label: 'Rain', icon: IconCloudRain, color: '#2f6fb8' },
  { test: (c) => (c >= 71 && c <= 77) || c === 85 || c === 86, label: 'Snow', icon: IconCloudSnow, color: '#7ba7d9' },
  { test: (c) => c >= 95, label: 'Thunderstorm', icon: IconCloudStorm, color: '#7048e8' },
];

export function weatherMeta(code) {
  return CODES.find((c) => c.test(code)) ?? CODES[2];
}

export async function fetchWeather(lat = DEFAULT_LOCATION.lat, lon = DEFAULT_LOCATION.lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&hourly=temperature_2m,weather_code,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  return res.json();
}
