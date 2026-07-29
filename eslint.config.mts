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
    files: [
      '*.cjs',
      'release-check.mjs',
      'tests/e2e/**/*.ts',
      'tests/e2e/**/*.mts',
      // Test-only fixture path helper — reads checked-in fonts from disk under Node
      // (vitest), never imported by plugin source, so it never ships in main.js.
      'src/fonts/fixtures.ts',
    ],
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
    // `no-forbidden-elements` targets plugins shipping *static* CSS through an injected
    // element ("use a styles.css file instead"). This plugin's CSS is generated at
    // runtime from @font-face rules for fonts scanned out of the user's own vault, plus
    // role assignments made in the settings tab — styles.css cannot express either, since
    // both vary per vault and per user. The primary delivery path (applyViaAdoptedStyleSheet
    // in main.ts) uses a constructable stylesheet and creates no element at all, so the
    // rule never fires there. The element created here is a fallback for WebKit below
    // 16.4 (iOS/iPadOS 16.0–16.3), where `adoptedStyleSheets` doesn't exist and skipping
    // the fallback would silently leave those users with no fonts.
    files: ['src/main.ts'],
    rules: {
      'obsidianmd/no-forbidden-elements': 'off',
    },
  },
  {
    // probe.ts measures which font actually rendered by comparing pixel widths, which only
    // works if the probe element's styles are exactly what the code sets and nothing else —
    // a CSS class in styles.css could be overridden by a theme (or by the plugin's own
    // generated font-role CSS) and silently corrupt the measurement. So static inline styles
    // are the correct tool here, not a workaround. `createSpan` is likewise not an option:
    // Obsidian patches it onto `Node`/`HTMLElement` at runtime, so it's absent under jsdom
    // and on any plain `Document` — using it would break the portability this module's
    // signature promises (it works with any `Document`, in-app or under test).
    files: ['src/fonts/probe.ts'],
    rules: {
      'obsidianmd/no-static-styles-assignment': 'off',
      'obsidianmd/prefer-create-el': 'off',
    },
  },
  {
    // The "Fonts found" heading sits above the diagnostics cards, which are read-only
    // information (what was parsed out of the user's font files), not settings — the
    // settings surface itself is deliberately capped at seven controls (folder, five
    // roles, hard override) so it can't be confused with the diagnostics below it.
    // `new Setting(...).setHeading()` would make this heading indistinguishable from an
    // actual control (and from the "exactly seven controls" contract this file is
    // tested against), so a plain heading element is the correct choice here, not a
    // workaround.
    files: ['src/settings-tab.ts'],
    rules: {
      'obsidianmd/settings-tab/no-manual-html-headings': 'off',
    },
  },
  {
    // `display()` was marked deprecated in Obsidian 1.13.0 in favour of a declarative
    // `getSettingDefinitions()` API, but that API describes simple name/desc/control
    // rows — it has no way to express this file's diagnostics section (a variable
    // number of collapsible per-family cards, each with its own selected-face list,
    // script coverage and licence text, built from the current scan). `display()` is
    // still fully supported at runtime and is the only API that can render that.
    // manifest.json's minAppVersion (1.0.3) predates the declarative API entirely.
    // Applies to the test file too, since it calls `tab.display()` directly.
    files: ['src/settings-tab.ts', 'src/settings-tab.test.ts'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    },
  },
  prettier,
);
