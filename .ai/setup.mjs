#!/usr/bin/env node
// Bootstraps every AI-agent config from the canonical sources under `.ai/`.
//
// `.ai/` is the only agent-tooling directory tracked in git. `.claude/`, `.codex/`,
// `.forge/`, `.opencode/`, `.pi/`, `.agents/`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json`,
// and `opencode.json` are all gitignored, machine-local, and rebuilt by this script.
// Run it after cloning, or any time an agent dir looks empty:
//
//   node .ai/setup.mjs
//
// Safe to re-run: existing correct symlinks are left alone, and anything that isn't
// already the expected symlink is reported and skipped rather than overwritten.
//
// `.ai/configs/` is laid out as a literal mirror of the repo root — e.g.
// `.ai/configs/.codex/hooks.json` becomes `<repo-root>/.codex/hooks.json`.
// To wire up a new agent config, just add the file at its real repo-root-relative
// path under `.ai/configs/` and re-run this script; nothing else to edit.

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aiRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(aiRoot, '..');
process.chdir(repoRoot);

const configsRoot = path.join(aiRoot, 'configs');

const links = [
  // Skills: every agent that understands the shared SKILL.md convention reads
  // from one of these paths. Not part of the configs mirror because it's
  // a shared directory symlink, not a 1:1 file mirror.
  ['.claude/skills', '.ai/skills'],
  ['.forge/skills', '.ai/skills'],
  ['.opencode/skills', '.ai/skills'],
  ['.pi/skills', '.ai/skills'],
  ['.agents/skills', '.ai/skills'],

  // AGENTS.md is the canonical agent-instructions file (mirrored from
  // `.ai/configs/AGENTS.md` below, like everything else). CLAUDE.md is
  // just a name Claude Code specifically looks for, so it's a second hop
  // pointing at AGENTS.md instead of carrying its own copy of the content.
  ['CLAUDE.md', 'AGENTS.md'],

  // Hooks + MCP config: every file under `.ai/configs/` mirrored to the
  // same relative path at the repo root.
  ...listFiles(configsRoot).map((absolutePath) => {
    const relativePath = path.relative(configsRoot, absolutePath);
    return [relativePath, path.join('.ai/configs', relativePath)];
  }),
];

let created = 0;
let skipped = 0;
let conflicts = 0;

for (const [linkPath, targetPath] of links) {
  const result = ensureSymlink(linkPath, targetPath);
  if (result === 'created') created += 1;
  if (result === 'skipped') skipped += 1;
  if (result === 'conflict') conflicts += 1;
}

console.log(`\n${created} created, ${skipped} already OK, ${conflicts} conflicts.`);
if (conflicts > 0) {
  console.log('Resolve conflicts above manually, then re-run this script.');
  process.exitCode = 1;
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function ensureSymlink(linkPath, targetPath) {
  const relativeTarget = path.relative(path.dirname(linkPath), targetPath);

  mkdirSync(path.dirname(linkPath), { recursive: true });

  if (existsSync(linkPath) || isBrokenSymlink(linkPath)) {
    const stat = lstatSync(linkPath);

    if (stat.isSymbolicLink() && readlinkSync(linkPath) === relativeTarget) {
      console.log(`ok       ${linkPath}`);
      return 'skipped';
    }

    console.log(
      `conflict ${linkPath} (exists and is not the expected symlink to ${relativeTarget})`,
    );
    return 'conflict';
  }

  symlinkSync(relativeTarget, linkPath);
  console.log(`created  ${linkPath} -> ${relativeTarget}`);
  return 'created';
}

function isBrokenSymlink(linkPath) {
  try {
    return lstatSync(linkPath).isSymbolicLink();
  } catch {
    return false;
  }
}
