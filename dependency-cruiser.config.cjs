/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Import cycles are hard to spot in a diff and easy to introduce as src/ grows past main.ts.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unlisted-dependencies',
      comment:
        'Catches an import that only resolved because a transitive dependency happened to hoist it.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src',
    moduleSystems: ['es6'],
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { conditionNames: ['types', 'import', 'node', 'default'] },
  },
};
