import prettier from 'eslint-config-prettier';
import obsidianmd from 'eslint-plugin-obsidianmd';
import sonarjs from 'eslint-plugin-sonarjs';
import { defineConfig, globalIgnores } from 'eslint/config';
import * as globals from 'globals';

const testFiles = [
  '**/*.test.ts',
  '**/*.spec.ts',
  'vitest.config.ts',
  'tests/e2e/**/*.ts',
  'tests/e2e/**/*.mts',
];

export default defineConfig(
  globalIgnores([
    'node_modules',
    'dist',
    'coverage',
    'esbuild.config.mjs',
    'version-bump.mjs',
    'versions.json',
    'main.js',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    '.ai',
    '.agents',
    '.claude',
    '.codex',
    '.forge',
    '.opencode',
    '.pi',
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mts',
            'manifest.json',
            'vitest.config.ts',
            'commitlint.config.mjs',
            'dependency-cruiser.config.cjs',
            'stylelint.config.mjs',
            'release-check.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Complexity budgets (cyclomatic + cognitive), mirrors the reference TypeScript template.
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 10],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'max-statements': ['error', 30],

      'array-callback-return': 'error',
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-else-return': ['error', { allowElseIf: false }],
      'no-new-wrappers': 'error',
      'no-param-reassign': 'error',
      'no-throw-literal': 'error',
      'no-unused-vars': 'off',
      'object-shorthand': ['error', 'always'],
      'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: false }],
      'prefer-template': 'error',
      'require-atomic-updates': 'error',

      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          minimumDescriptionLength: 12,
        },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowHigherOrderFunctions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: false, ignoreVoidOperator: false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': [
        'error',
        { ignoreIIFE: false, ignoreVoid: false },
      ],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: true }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: false },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: testFiles,
    rules: {
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'sonarjs/cognitive-complexity': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    // Node-only tooling scripts (not part of the browser-context plugin bundle) — the
    // obsidianmd rules assume every file ships inside main.js and runs on mobile,
    // which doesn't apply to a script that only ever runs under `pnpm run <script>`.
    // tests/e2e/*.mts run under Node via the wdio CLI; the spec files also run under
    // Node (only the `executeObsidian` callback bodies they send get serialized into
    // the real Obsidian process), so the same reasoning applies to all of tests/e2e/.
    files: ['*.cjs', 'release-check.mjs', 'tests/e2e/**/*.ts', 'tests/e2e/**/*.mts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/rule-custom-message': 'off',
      'no-console': 'off',
      // Core no-undef can't see TS ambient global namespaces (e.g. `WebdriverIO.Config`)
      // and false-positives on them; typescript-eslint's own type checking already
      // catches genuinely undefined references here.
      'no-undef': 'off',
    },
  },
  {
    // Test-only fixture path helper — reads checked-in fonts from disk under Node
    // (vitest). Lives under tests/, not src/, so it never ships in main.js and was
    // never in scope for the obsidianmd rules to begin with; it only needs Node's
    // globals so `import.meta.dirname`/`node:fs` type-check without a `no-undef` or
    // `no-nodejs-modules` complaint.
    files: ['tests/fixtures.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/rule-custom-message': 'off',
    },
  },
  {
    // This spec's `measure()` helpers reimplement src/fonts/probe.ts's technique inside
    // `executeObsidian` callbacks that run live inside a real Obsidian window (not under
    // jsdom), to prove text actually rendered in the chosen font rather than a fallback.
    // Unlike probe.ts itself (which uses styles.css + setCssStyles — see its own doc
    // comment), static inline styles are required here: the callback body is serialized
    // and sent into a separate, sandboxed Obsidian process, so it cannot rely on this
    // repo's styles.css having been loaded there, and `createEl`'s availability inside
    // that sandboxed callback is unproven. The sample text is also a font-metrics probe,
    // not UI copy, so sentence-case / timer-registration conventions for shipped UI
    // don't apply to it.
    files: ['tests/e2e/fonts.e2e.ts'],
    rules: {
      'obsidianmd/no-static-styles-assignment': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/ui/sentence-case': 'off',
      'obsidianmd/prefer-window-timers': 'off',
    },
  },
  {
    // `display()` is deprecated since Obsidian 1.13.0 in favour of the declarative
    // `getSettingDefinitions()` API (which this file also implements — see
    // `getSettingDefinitions()`/`getControlValue()`/`setControlValue()` in
    // settings-tab.ts, sharing its builders with `display()` so the two can't drift).
    // `display()` itself must still be kept and must still work: manifest.json's
    // minAppVersion is 1.0.3, and Obsidian's own JSDoc on `display()` says to keep it
    // as the fallback for any Obsidian version below 1.13, which does not know about
    // `getSettingDefinitions()` and will call `display()` directly. This override is
    // therefore required for as long as minAppVersion stays below 1.13.0, and should
    // be deleted the moment it rises to or past that. Applies to the test file too,
    // since it exercises `display()` directly.
    files: ['src/settings-tab.ts', 'src/settings-tab.test.ts'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
  prettier,
);
