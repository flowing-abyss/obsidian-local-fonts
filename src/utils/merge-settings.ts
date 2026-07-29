import type { PluginSettings } from '../settings.js';

/**
 * Merges saved plugin data onto the defaults. `roles` is merged one level deeper than
 * the rest of the settings: a saved `roles` object only carries whichever roles existed
 * in the release that wrote it, so shallow-replacing it would silently drop any role
 * added since (the settings UI would then render a dropdown backed by a missing key).
 * `cache`, by contrast, is replaced wholesale on purpose — it's written atomically by a
 * scan, and merging a stale cache into a fresh one would corrupt it.
 */
export function mergeSettings(
  defaults: PluginSettings,
  saved: Partial<PluginSettings> | null | undefined,
): PluginSettings {
  return {
    ...defaults,
    ...saved,
    roles: { ...defaults.roles, ...saved?.roles },
  };
}
