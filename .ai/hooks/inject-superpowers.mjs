#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// SessionStart hook — Node port of obra/superpowers' hooks/session-start
// (https://github.com/obra/superpowers), adapted so it works from a vendored
// copy of the skill instead of an installed Claude Code plugin: no plugin
// means no `CLAUDE_PLUGIN_ROOT`, so this always emits the Claude
// Code/Codex CLI `hookSpecificOutput.additionalContext` shape rather than
// upstream's multi-platform branch.
//
// Forces the model to read the `using-superpowers` skill at the start of
// every session, so skill-checking isn't left to the model deciding to call
// the Skill tool on its own first turn.
const projectRoot = resolveProjectRoot();
const skillPath = path.join(projectRoot, '.ai', 'skills', 'using-superpowers', 'SKILL.md');

const skillContent = readSkillContent(skillPath);
const sessionContext = `<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'using-superpowers' skill — your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${skillContent}\n</EXTREMELY_IMPORTANT>`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: sessionContext,
    },
  }),
);

function readSkillContent(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    return `Error reading using-superpowers skill: ${error instanceof Error ? error.message : String(error)}`;
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
