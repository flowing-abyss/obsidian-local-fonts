---
name: using-superpowers
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first.

Then announce "Using [skill] to [purpose]" and follow the skill exactly. If it has a checklist, create a todo per item.

## Skill Priority

When multiple skills apply, process skills come first — they set the approach, then implementation skills (frontend-design, etc.) carry it out. Brainstorming and systematic-debugging are Superpowers' most common process skills, but the rule holds for any of them.

- "Let's build X" → superpowers:brainstorming first, then implementation skills.
- "Fix this bug" → superpowers:systematic-debugging first, then domain skills.

### This template's additional skills

This template vendors six skills beyond stock Superpowers. They aren't a separate system — they slot into the same process/implementation ordering above, at these points:

| Trigger | Skill | Where it sits |
|---------|-------|----------------|
| Starting a new session, output quality has degraded, or context/rules files need setting up | `context-engineering` | Before anything else — it's about what the agent sees, not what it does. |
| Implementing anything framework- or library-specific (esbuild config, Obsidian API usage, a new dependency) | `source-driven-development` | Runs alongside implementation skills, after brainstorming — cites official docs instead of implementing from memory. |
| After a plan/design is approved, before writing code, and again before claiming the work is done | `risk-based-verification` | Between `writing-plans`/`brainstorming` and `verification-before-completion` — complements Superpowers' TDD and verification skills, doesn't replace them. |
| A feature can fail silently (file I/O, network, parsing) and the user would have no way to tell why | `observability-and-instrumentation` | Part of implementation, before `finishing-a-development-branch` — visible errors ship with the feature, not after. |
| Removing old code/APIs, or migrating from one implementation to another | `deprecation-and-migration` | An alternate entry point parallel to `brainstorming`, for removal-shaped tasks instead of build-shaped ones. |
| Cutting a release — bumping the version, tagging, publishing | `releasing-an-obsidian-plugin` | A separate, self-contained flow after `finishing-a-development-branch` — not part of the build loop. |

## Red Flags

These thoughts mean STOP—you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Platform Adaptation

If your harness appears here, read its reference file for special instructions:

- Codex: `references/codex-tools.md`
- Pi: `references/pi-tools.md`
- Antigravity: `references/antigravity-tools.md`

## User Instructions

User instructions (CLAUDE.md, AGENTS.md, GEMINI.md, etc, direct requests) take precedence over skills, which in turn override default behavior. Only skip skill workflows or instructions when your human partner has explicitly told you to.
