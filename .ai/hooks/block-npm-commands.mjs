#!/usr/bin/env node

import path from 'node:path';

// Read the hook payload supplied by Claude Code or Codex.
const input = await readStdinJson();
const command = input?.tool_input?.command;

if (typeof command !== 'string' || command.trim() === '') {
  process.exit(0);
}

const blockedExecutable = findBlockedExecutable(command);

if (!blockedExecutable) {
  process.exit(0);
}

const replacement =
  blockedExecutable === 'npx'
    ? 'Use `pnpm exec <binary>` for local dependencies or `pnpm dlx <package>` for one-off packages.'
    : 'Use the equivalent `pnpm` command.';

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `This project uses pnpm. Direct execution of \`${blockedExecutable}\` is blocked. ${replacement}`,
    },
  }),
);

async function readStdinJson() {
  let raw = '';

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Fail open when the hook payload is malformed so the guard does not break the agent.
    return {};
  }
}

function findBlockedExecutable(commandText) {
  for (const segment of splitShellCommands(commandText)) {
    const tokens = tokenizeShellSegment(segment);
    const result = inspectCommandTokens(tokens);

    if (result) {
      return result;
    }
  }

  return null;
}

function splitShellCommands(commandText) {
  const segments = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let index = 0; index < commandText.length; index += 1) {
    const character = commandText[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\' && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }

    if (quote) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      current += character;
      continue;
    }

    if (
      character === ';' ||
      character === '\n' ||
      character === '|' ||
      character === '&' ||
      character === '(' ||
      character === ')'
    ) {
      if (current.trim()) {
        segments.push(current.trim());
      }
      current = '';
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments;
}

function tokenizeShellSegment(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const character of segment) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function inspectCommandTokens(tokens) {
  if (tokens.length === 0) {
    return null;
  }

  let index = 0;

  // Skip leading environment-variable assignments.
  while (index < tokens.length && isEnvironmentAssignment(tokens[index])) {
    index += 1;
  }

  // Unwrap common command launchers before inspecting the actual executable.
  while (index < tokens.length) {
    const wrapper = path.basename(tokens[index]);

    if (
      wrapper === 'sudo' ||
      wrapper === 'command' ||
      wrapper === 'builtin' ||
      wrapper === 'nohup' ||
      wrapper === 'time'
    ) {
      index += 1;
      while (index < tokens.length && tokens[index].startsWith('-')) {
        index += 1;
      }
      continue;
    }

    if (wrapper === 'env') {
      index += 1;
      while (
        index < tokens.length &&
        (tokens[index].startsWith('-') || isEnvironmentAssignment(tokens[index]))
      ) {
        index += 1;
      }
      continue;
    }

    break;
  }

  if (index >= tokens.length) {
    return null;
  }

  const executable = path.basename(tokens[index]);

  if (executable === 'npm' || executable === 'npx') {
    return executable;
  }

  // Inspect commands passed through a shell with -c or -lc.
  if (['bash', 'sh', 'zsh', 'dash'].includes(executable)) {
    const commandFlagIndex = tokens.findIndex(
      (token, tokenIndex) => tokenIndex > index && /^-[^-]*c/.test(token),
    );

    if (commandFlagIndex !== -1 && tokens[commandFlagIndex + 1]) {
      return findBlockedExecutable(tokens[commandFlagIndex + 1]);
    }
  }

  return null;
}

function isEnvironmentAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}
