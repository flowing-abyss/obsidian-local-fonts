#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Run a fast lint check after an agent edits or writes a file.
const projectRoot = resolveProjectRoot();
const packageJsonPath = path.join(projectRoot, 'package.json');
const lockfilePath = path.join(projectRoot, 'pnpm-lock.yaml');

if (!existsSync(packageJsonPath) || !existsSync(lockfilePath)) {
  process.exit(0);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

if (!packageJson.scripts?.lint) {
  process.exit(0);
}

const result = spawnSync('pnpm', ['run', 'lint'], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: process.env,
});

if (result.error) {
  reportFailure(`Unable to run pnpm: ${result.error.message}`);
}

if (result.status !== 0) {
  reportFailure(formatFailure('pnpm run lint', result));
}

process.exit(0);

function resolveProjectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }

  const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  return gitRoot.status === 0 ? gitRoot.stdout.trim() : process.cwd();
}

function formatFailure(command, result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const tail = output.split('\n').slice(-30).join('\n');

  return `${command} failed.${tail ? `\n\n${tail}` : ''}`;
}

function reportFailure(reason) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason,
    }),
  );
  process.exit(0);
}
