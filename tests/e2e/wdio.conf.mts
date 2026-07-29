import * as path from 'node:path';
import { env } from 'node:process';
import { parseObsidianVersions } from 'wdio-obsidian-service';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const cacheDir = path.resolve(repoRoot, '.obsidian-cache');
// One shared vault fixture for both desktop and Android — the version/platform matrix
// lives in `capabilities`, not in separate vault folders. Add a second vault under
// tests/vaults/ once there's real persistence/migration behavior worth fixturing
// against; an empty "hostile" or "migration-v1" vault today would test nothing.
const vault = path.resolve(repoRoot, 'tests', 'vaults', 'minimal');

// Test against both the oldest Obsidian version this plugin claims to support
// (manifest.json's minAppVersion, via "earliest") and the newest stable release.
// Override for a one-off run, e.g.: OBSIDIAN_VERSIONS="1.8.0/1.8.0" pnpm run test:e2e
const desktopVersions = await parseObsidianVersions(
  env['OBSIDIAN_VERSIONS'] ?? 'earliest/earliest latest/latest',
  {
    cacheDir,
  },
);

if (env['CI']) {
  // Printed so the CI workflow can key its Obsidian-binary cache off the resolved
  // versions (they can drift between "latest" runs) — see .github/workflows/e2e.yml.
  console.log('obsidian-cache-key:', JSON.stringify(desktopVersions));
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',

  // Resolved relative to this config file's own directory (tests/e2e/), not the cwd
  // it's invoked from.
  specs: ['./**/*.e2e.ts'],

  maxInstances: Number(env['WDIO_MAX_INSTANCES'] ?? 2),

  capabilities: desktopVersions.map(([appVersion, installerVersion]) => ({
    browserName: 'obsidian',
    'wdio:obsidianOptions': {
      appVersion,
      installerVersion,
      plugins: [repoRoot],
      vault,
    },
  })),

  services: ['obsidian'],
  // Wraps wdio's spec-reporter to show the Obsidian version a test ran under
  // instead of the underlying Chromium version.
  reporters: ['obsidian'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60 * 1000,
  },
  waitforInterval: 250,
  waitforTimeout: 5 * 1000,
  logLevel: 'warn',

  cacheDir,

  // Import describe/it/expect explicitly instead of relying on injected globals —
  // matches this repo's vitest config (`globals: false`) and keeps ESLint honest.
  injectGlobals: false,
};
