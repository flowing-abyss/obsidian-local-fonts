import type { FontCache } from './fonts/types.js';

export type RoleName = 'text' | 'interface' | 'monospace' | 'headings' | 'emoji';

export type RoleAssignments = Record<RoleName, string | null>;

export interface PluginSettings {
  /** Vault-relative folder holding the font files. May be hidden (start with a dot),
   *  at the cost of Obsidian Sync never carrying it — which is why the default is not. */
  folder: string;
  /** Family name chosen per role, or null to leave the theme alone. */
  roles: RoleAssignments;
  /** Emit `!important` font-family rules for themes that hardcode font stacks. */
  hardOverride: boolean;
  /** Platform-neutral scan result. Never holds a platform-dependent choice. */
  cache: FontCache | null;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  folder: 'fonts',
  roles: {
    text: null,
    interface: null,
    monospace: null,
    headings: null,
    emoji: null,
  },
  hardOverride: false,
  cache: null,
};
