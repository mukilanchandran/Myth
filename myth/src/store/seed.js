// First-run setup. Myth used to seed a demo dataset here so every module had
// something to show; with cloud sync on, that demo data followed people onto
// every device, so new installs now start empty. The flags are still set so
// older code paths that check them stay quiet.
export function seedIfNeeded(store) {
  const s = store.getState();
  if (s.settings.seeded && s.settings.seededV2 && s.settings.seededV3) return;
  s.setSettings({ seeded: true, seededV2: true, seededV3: true });
}
