import * as path from 'node:path';
import { env } from 'node:process';
import { parseObsidianVersions } from 'wdio-obsidian-service';

// Drives the real Obsidian Android app via Appium + an AVD named "obsidian_test" —
// not desktop's `emulateMobile`, which only fakes the viewport and can't catch
// platform-specific behavior (e.g. filesystem access differences). Requires Android
// Studio + Appium locally, or use the "e2e (android)" CI job, which sets both up.
// Docs: https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/README#android
//
// If this plugin is desktop-only, delete this file and the test:e2e:android script.

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const cacheDir = path.resolve(repoRoot, '.obsidian-cache');
const vault = path.resolve(repoRoot, 'tests', 'vaults', 'minimal');

// Obsidian's Android app requires 1.8.10+; beta versions aren't published for Android.
// "earliest" resolves to manifest.json's minAppVersion, which this template sets to
// 1.0.3 (wdio-obsidian-service's own desktop floor) — below the Android floor, and
// there's no APK for it. Substitute the real Android minimum wherever "earliest" appears.
const ANDROID_MIN_VERSION = '1.8.10';
const versionsSpec = (
  env['OBSIDIAN_MOBILE_VERSIONS'] ??
  env['OBSIDIAN_VERSIONS'] ??
  'earliest/earliest latest/latest'
).replace(/\bearliest\b/g, ANDROID_MIN_VERSION);
const versions = await parseObsidianVersions(versionsSpec, { cacheDir });

if (env['CI']) {
  console.log('obsidian-cache-key:', JSON.stringify(versions));
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',

  // Resolved relative to this config file's own directory (tests/e2e/), not the cwd
  // it's invoked from.
  specs: ['./**/*.e2e.ts'],

  maxInstances: 1, // Parallel tests don't work under Appium.
  hostname: env['APPIUM_HOST'] ?? 'localhost',
  port: Number(env['APPIUM_PORT'] ?? 4723),

  // installerVersion isn't meaningful for the mobile app — there's only appVersion.
  capabilities: versions.map(([appVersion]) => ({
    browserName: 'obsidian',
    browserVersion: appVersion,
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:avd': 'obsidian_test',
    // wdio-obsidian-service resets Obsidian itself between tests when needed,
    // so a full app reset per test isn't necessary and would slow things down.
    'appium:noReset': true,
    'appium:adbExecTimeout': 60 * 1000,
    'wdio:obsidianOptions': {
      plugins: [repoRoot],
      vault,
    },
  })),

  services: [
    'obsidian',
    ['appium', { args: { allowInsecure: '*:chromedriver_autodownload,*:adb_shell' } }],
  ],
  reporters: ['obsidian'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60 * 1000,
  },
  waitforInterval: 250,
  waitforTimeout: 5 * 1000,
  logLevel: 'warn',

  cacheDir,

  injectGlobals: false,
};
