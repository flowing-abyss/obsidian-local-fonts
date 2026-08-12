#!/usr/bin/env node
// Validates the built release artifacts (manifest.json, versions.json, main.js,
// styles.css) the way Obsidian and its community-plugin review actually consume
// them — catches drift that unit tests and `tsc` can't see, e.g. a hand-edited
// manifest.json that no longer matches versions.json, or a Node built-in that
// slipped into main.js for a plugin that claims mobile support.
//
// Run standalone (`pnpm run release:check`) against an already-built main.js,
// or as part of `pnpm run verify`, which runs it right after `pnpm run build`.

import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';

// Shared with esbuild.config.mjs, which fails the build on the same
// threshold — both read package.json#release.mainJsBudgetBytes so the two
// checks can't silently drift apart.
const MAIN_JS_BUDGET_BYTES = readJsonFile('package.json')?.release?.mainJsBudgetBytes ?? Infinity;

const REQUIRED_MANIFEST_STRING_FIELDS = [
  'id',
  'name',
  'author',
  'version',
  'minAppVersion',
  'description',
];
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

const errors = [];
const manifest = checkManifest();
checkVersionsConsistency(manifest);
checkMainJs(manifest);
checkStylesCss();
checkRequiredRepoFiles();

if (errors.length > 0) {
  console.error(`release:check failed with ${errors.length} problem(s):\n`);
  for (const error of errors) {
    console.error(`  ✖ ${error}`);
  }
  process.exit(1);
}

console.log('release:check passed.');

function checkManifest() {
  const raw = readJsonFile('manifest.json');

  if (raw === null) {
    errors.push('manifest.json is missing or not valid JSON.');
    return null;
  }

  for (const field of REQUIRED_MANIFEST_STRING_FIELDS) {
    const value = raw[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`manifest.json is missing a non-empty "${field}".`);
    }
  }

  if (typeof raw.isDesktopOnly !== 'boolean') {
    errors.push('manifest.json "isDesktopOnly" must be a boolean.');
  }

  for (const field of ['version', 'minAppVersion']) {
    const value = raw[field];
    if (typeof value === 'string' && !SEMVER_PATTERN.test(value)) {
      errors.push(
        `manifest.json "${field}" ("${value}") must be plain semver (x.y.z, no leading "v").`,
      );
    }
  }

  return raw;
}

function checkVersionsConsistency(manifest) {
  if (manifest === null) {
    return;
  }

  const versions = readJsonFile('versions.json');
  if (versions === null) {
    errors.push('versions.json is missing or not valid JSON.');
    return;
  }

  const recordedMinAppVersion = versions[manifest.version];
  if (recordedMinAppVersion === undefined) {
    errors.push(`versions.json has no entry for manifest.json's version "${manifest.version}".`);
  } else if (recordedMinAppVersion !== manifest.minAppVersion) {
    errors.push(
      `versions.json["${manifest.version}"] is "${recordedMinAppVersion}", but manifest.json's minAppVersion is "${manifest.minAppVersion}".`,
    );
  }
}

function checkMainJs(manifest) {
  // One read, rather than exists-then-stat-then-read: three separate trips to the same
  // path can each see a different file, and the build that produces main.js may still
  // be writing it. Reading once and deriving everything from that buffer is both
  // race-free (js/file-system-race) and simpler.
  let contents;
  try {
    contents = readFileSync('main.js');
  } catch {
    errors.push('main.js is missing — run `pnpm run build` first.');
    return;
  }

  const bytes = contents.byteLength;
  if (bytes === 0) {
    errors.push('main.js is empty.');
    return;
  }
  if (bytes > MAIN_JS_BUDGET_BYTES) {
    errors.push(
      `main.js is ${(bytes / 1024).toFixed(1)} KB, over the ${(MAIN_JS_BUDGET_BYTES / 1024).toFixed(0)} KB budget.`,
    );
  }

  if (manifest?.isDesktopOnly === false) {
    checkNoDesktopOnlyRequires(contents.toString('utf8'));
  }
}

function checkNoDesktopOnlyRequires(mainJsContent) {
  const requirePattern = /require\(\s*["'](?:node:)?([a-z_][\w/-]*)["']\s*\)/g;
  const found = new Set();

  for (const match of mainJsContent.matchAll(requirePattern)) {
    const moduleName = match[1] ?? '';
    if (builtinModules.includes(moduleName)) {
      found.add(moduleName);
    }
  }

  if (found.size > 0) {
    errors.push(
      `main.js requires Node built-in module(s) [${[...found].join(', ')}] but manifest.json sets ` +
        '"isDesktopOnly": false — this will crash on mobile. Check for a desktop-only dependency that got bundled.',
    );
  }
}

function checkStylesCss() {
  // styles.css is optional, so a missing file is not an error — but see checkMainJs:
  // one read answers both questions without the path being looked up twice.
  let contents;
  try {
    contents = readFileSync('styles.css');
  } catch {
    return;
  }

  if (contents.byteLength === 0) {
    errors.push('styles.css exists but is empty — remove it or add real styles.');
  }
}

function checkRequiredRepoFiles() {
  // Not required by manifest.json itself, but by Obsidian's community-plugin
  // submission requirements: https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins
  for (const file of ['README.md', 'LICENSE']) {
    if (!existsSync(file)) {
      errors.push(`${file} is missing — required for community-plugin submission.`);
    }
  }
}

function readJsonFile(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  // Missing and unparseable both mean "no manifest to check" to every caller, and the
  // read already reports the first — so there is nothing for a prior existsSync to add
  // beyond a second look at a path that could have changed in between.
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}
