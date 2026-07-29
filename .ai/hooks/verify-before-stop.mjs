#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Run the available pnpm quality checks before the agent finishes its turn.
const input = await readStdinJson();

// Avoid an infinite Stop-hook continuation loop.
if (input.stop_hook_active === true) {
  process.stdout.write('{}');
  process.exit(0);
}

const projectRoot = resolveProjectRoot();
const packageJsonPath = path.join(projectRoot, 'package.json');
const lockfilePath = path.join(projectRoot, 'pnpm-lock.yaml');

// A plain Obsidian vault may not be a Node.js project, so there is nothing to verify.
if (!existsSync(packageJsonPath)) {
  process.stdout.write('{}');
  process.exit(0);
}

if (!existsSync(lockfilePath)) {
  blockStop(
    'package.json exists, but pnpm-lock.yaml is missing. Initialize or install the project with pnpm.',
  );
}

const pnpmVersion = spawnSync('pnpm', ['--version'], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: process.env,
});

if (pnpmVersion.error || pnpmVersion.status !== 0) {
  blockStop('pnpm is required for this project but is not available in PATH.');
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const checks = ['lint', 'typecheck', 'test', 'build'];

for (const scriptName of checks) {
  if (!packageJson.scripts?.[scriptName]) {
    continue;
  }

  const result = spawnSync('pnpm', ['run', scriptName], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error) {
    blockStop(`Unable to run pnpm: ${result.error.message}`);
  }

  if (result.status !== 0) {
    blockStop(formatFailure(`pnpm run ${scriptName}`, result));
  }
}

process.stdout.write('{}');

async function readStdinJson() {
  let raw = '';

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Continue with an empty payload if the hook input cannot be parsed.
    return {};
  }
}

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
  const tail = output.split('\n').slice(-40).join('\n');

  return `${command} failed.${tail ? `\n\n${tail}` : ''}`;
}

function blockStop(reason) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason,
    }),
  );
  process.exit(0);
}
