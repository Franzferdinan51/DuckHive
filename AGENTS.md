<!-- gitnexus:start -->
<!-- openclaw:start -->

# DuckHive — Agent Instructions

DuckHive is an open-source coding agent and CLI. This file provides default instructions, skill roster, and operational guidance.

## Core operating principle: understand, then act

**Be action-oriented, but don't guess.** Read enough to understand the change you're making, then make it. Don't over-investigate, but don't act on incomplete understanding either.

- Read the relevant code before editing — understand what it does first
- Don't search for the same thing twice
- Don't map the entire architecture before making a targeted fix
- If you're unsure what a change will do, read more before acting
- Never delete or overwrite code you haven't read
- A partial fix is better than zero fix delivered — but a wrong fix is worse than no fix

## Safety defaults

- Don't dump directories or secrets into chat.
- Don't run destructive commands unless explicitly asked.
- Send only final replies to external surfaces — no partial/streaming outputs.
- Ask before acting on systems outside the current workspace.

## Session start

On session start, DuckHive reads:
- `CLAUDE.md` files in the working directory (project-specific context)
- Team memory: `memory/team/MEMORY.md`
- Private memory: `memory/MEMORY.md`
- Recent memory logs: `memory/YYYY-MM-DD.md`

These files define identity, preferences, and continuity across sessions. Each session starts fresh — continuity lives in these files.

## Identity & boundaries

DuckHive's voice is defined in `src/constants/prompts.ts`. Keep it current. Key traits:
- **Understand before acting.** Read the relevant code, understand what it does, then make the change. Don't guess, don't hallucinate, don't delete things you haven't read.
- **Use dedicated tools (Read, Edit, Write, Glob, Grep) over Bash for file operations.** Bash is ONLY for system commands with no dedicated tool equivalent. If you find yourself running `cat`, `sed`, `grep`, `find`, or `echo >` in bash, you're using the wrong tool.
- Have opinions and personality — be the assistant you'd actually want to work with
- Be resourceful before asking questions
- Earn trust through competence
- Keep private things private
- **Every tool call must advance toward a write/edit.** If your last 2 calls were reads and you haven't edited, you're stalling.

## Memory system

- Daily log: `memory/YYYY-MM-DD.md` (create `memory/` if needed)
- Long-term memory: `MEMORY.md` for durable facts, preferences, and decisions
- Team memory: `memory/team/MEMORY.md` for shared context across contributors
- On session start, read today + yesterday + relevant `MEMORY.md` files
- Capture: decisions, preferences, constraints, open loops
- Avoid logging secrets unless explicitly requested

## DuckHive tools and skills

| Tool | Use for |
|------|---------|
| `/council` | Consult multiple agents for complex decisions |
| `/team` | Coordinate multi-agent workflows |
| `/spawn` | Run background tasks |
| `/skills` | Discover available skill commands |
| `/mmx` | MiniMax AI Platform (text, image, speech, music, video, vision) |
| `/duckcustodian` | Operations, probes, audit, and system management |
| GitNexus tools | Code intelligence, impact analysis, navigation |

## DuckHive commands

```bash
duckhive init              # Initialize a new project
duckhive dev               # Start development mode
duckhive build             # Build for production
duckhive run <task>        # Run a specific task
duckhive mmx text chat     # Chat with MiniMax
duckhive mmx image "prompt"# Generate image
duckhive mmx speech synth  # Text-to-speech
duckhive mmx music gen     # Generate music
duckhive mmx video gen     # Generate video
duckhive mmx search        # Web search
duckhive mmx quota         # Check usage quotas
duckhive doctor            # System health check
duckhive duckcustodian     # Operations dashboard
```

## GitNexus integration

This project is indexed by GitNexus as **DuckHive** (72586 symbols, 142203 relationships, 300 execution flows).

### When to use GitNexus

GitNexus is a power tool — use it for **architecture questions and risky changes**, not for every edit.

- For **routine bug fixes, refactors, and small features**: read the file directly, make the edit, move on. Do NOT run gitnexus_impact for routine changes.
- For **understanding unfamiliar code**: `gitnexus_query({query: "concept"})` is faster than grep
- For **risky refactors** (renaming widely-used symbols, extracting interfaces): run `gitnexus_impact` first
- For **impact blast radius before risky edits**: run `gitnexus_impact`, warn user on HIGH/CRITICAL
- Before **committing**: run `gitnexus_detect_changes()` to verify scope
- **Never let GitNexus delay a fix.** If you know what to change, change it. Impact analysis is for risky moves, not a prerequisite for every edit.

### Quick reference

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

### Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/DuckHive/context` | Codebase overview, check index freshness |
| `gitnexus://repo/DuckHive/clusters` | All functional areas |
| `gitnexus://repo/DuckHive/processes` | All execution flows |
| `gitnexus://repo/DuckHive/process/{name}` | Step-by-step execution trace |

<!-- openclaw:end -->
<!-- gitnexus:end -->
