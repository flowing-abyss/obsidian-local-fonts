import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // `obsidian` has no runtime, only types — `obsidian-test-mocks/vitest-setup`
    // aliases it via `vi.mock` for the test runtime, but `@vitest/coverage-v8`
    // re-transforms source files through Vite directly (bypassing `vi.mock`) to
    // remap coverage, so it needs its own alias here too.
    alias: {
      obsidian: 'obsidian-test-mocks/obsidian',
    },
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    globals: false,
    passWithNoTests: false,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['obsidian-test-mocks/vitest-setup'],
    testTimeout: 5_000,
    hookTimeout: 10_000,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        perFile: true,
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
