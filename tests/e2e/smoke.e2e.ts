import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { PluginManifest } from 'obsidian';

// Read directly from the built manifest.json rather than hardcoding an id/version, so
// this spec keeps working unchanged after the template is renamed for a real plugin.
const manifest = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '..', '..', 'manifest.json'), 'utf8'),
) as PluginManifest;

describe('plugin loads in a real Obsidian instance', () => {
  it('is enabled after Obsidian starts', async () => {
    const isEnabled = await browser.executeObsidian(
      ({ app }, id) => app.plugins.enabledPlugins.has(id),
      manifest.id,
    );

    expect(isEnabled).toBe(true);
  });

  it('reports the same version Obsidian actually loaded as manifest.json — catches a stale build', async () => {
    const loadedVersion = await browser.executeObsidian(
      ({ app }, id) => app.plugins.manifests[id]?.version,
      manifest.id,
    );

    expect(loadedVersion).toEqual(manifest.version);
  });
});
