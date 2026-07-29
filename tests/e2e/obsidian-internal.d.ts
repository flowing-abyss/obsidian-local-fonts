import type { PluginManifest } from 'obsidian';

// `app.plugins` (the plugin manager) is a real, stable part of Obsidian's runtime but
// isn't part of the public `obsidian` package types. Declare only the members these
// e2e specs actually read, rather than pulling in a whole `obsidian-typings`
// dependency for it — same approach obsidian-test-mocks' docs recommend for accessing
// non-public members. See https://github.com/mnaoumov/obsidian-test-mocks#accessing-unimplemented-properties
declare module 'obsidian' {
  interface App {
    plugins: {
      enabledPlugins: Set<string>;
      manifests: Record<string, PluginManifest>;
    };
  }
}
