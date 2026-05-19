# 🦆 DuckHive

![DuckHive](https://img.shields.io/badge/DuckHive-v0.13.7-gold?style=for-the-badge&logo=buymeacoffee)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=for-the-badge&logo=typescript)](package.json)
[![Bun](https://img.shields.io/badge/Bun-1.3-yellow?style=for-the-badge&logo=bun)](package.json)

**The Mega AI Coding Harness** — Forked from [Gitlawb/openclaude](https://github.com/Gitlawb/openclaude) and extended with MiniMax M2.7, Agent Teams, AI Council, and full MiniMax CLI integration. Built with 3-layer memory (BM25 → embed → LESSONS), swarm voting, task planning, budget enforcement, and unified channel adapters.

[Features](#features) · [Quick Start](#getting-started) · [SDK](#duckhive-sdk) · [Agent Harness](#agent-harness-platform) · [DuckHive mmx](#duckhive-mmx) · [Agent Teams](#agent-teams) · [Memory Layers](#memory--intelligence) · [Architecture](#architecture) · [Comparison](#what-duckhive-adds-over-openclaude)

---

## Overview

DuckHive is an AI coding CLI built on top of [Gitlawb/openclaude](https://github.com/Gitlawb/openclaude). That OpenClaude codebase is the direct upstream base for this fork. OpenClaw is a separate harness project that influenced parts of the broader ecosystem, but DuckHive itself extends the OpenClaude line directly. On top of that base, DuckHive swaps the default model to **MiniMax M2.7**, adds **Agent Teams** for multi-agent orchestration, layers in **AI Council** for adversarial deliberation, and integrates full **MiniMax CLI (mmx)** support for image, speech, music, and video generation — all from a single `duckhive` command.

### Key Differentiators from OpenClaude

| OpenClaude ships | DuckHive adds |
|-----------------|---------------|
| Claude as default | **MiniMax M2.7** as default |
| Basic tool set | **24+ custom tools** including mmx, council, senate |
| Single-agent | **Sub-Agent spawning** with per-agent model routing |
| No deliberation layer | **AI Council** — 46 adversarial councilors |
| No MiniMax modalities | **Full mmx** — image, speech, music, video |
| No shell toggle | **Ctrl-X shell toggle** |
| No hierarchical context | **DUCK.md** context loading (gemini-cli style) |
| No project init | **`/init` + `init_tool`** — interactive setup plus scriptable project bootstrap |
| No session export | **/export** — zip sessions for sharing |
| No built-in council daemon | **Hive Nation bridge** — DuckHive can connect to a Council runtime when one is available |
| Basic MCP | **dmcp** — enhanced MCP server management |
| Distribution | **npm global install** — one command setup |

### Codex-style `/goal` (Autonomous Mode)

DuckHive features a powerful, persisted goal system inspired by Codex `r0.128.0`. It allows for long-horizon, autonomous engineering tasks.

- **Shorthand creation**: Run `/goal <task description>` (e.g., `/goal Refactor the auth module`) to immediately create and start a goal. Single-word goals like `/goal Refactor` are also supported, matching Codex behavior.
- **Autonomous Execution**: Starting a goal via shorthand or `/goal pursue` automatically enables **YOLO mode** (permission bypass). The agent works continuously across turns without requiring constant manual approval for every tool call.
- **Action-Oriented Prompting**: The autonomous task instructions prioritize **action over exploration**. It follows a "Read Once, Plan Once, Act Always" philosophy to prevent analysis paralysis while maintaining accuracy.
- **Persistence**: Goals are saved across sessions. Use `/goal list` and `/goal status` to track progress, and `/goal stop` to cancel autonomous work.

---

## Features

### Experimental Bubble Tea TUI

DuckHive now includes an additive Go/Bubble Tea shell. On macOS/Linux, plain interactive `duckhive` auto-starts the Go TUI when `tui/duckhive-tui` is present. On Windows, DuckHive now stays on the classic REPL by default for the no-args startup path because the standalone TUI handoff is not reliable enough yet. The Windows launcher also ignores inherited TUI handoff flags for no-args startup, so stale `DUCKHIVE_AUTO_TUI` / `DUCKHIVE_TUI_DIRECT` state cannot paint a UI that never accepts typing. `duckhive tui` remains available as an explicit launcher. Set `DUCKHIVE_NO_AUTO_TUI=1` if you want to stay in the legacy Ink REPL everywhere, or `DUCKHIVE_TUI_WINDOWS_EXPERIMENT=1` if you want to opt back into the Windows auto-launch path. UI-surface preferences persist through DuckHive's resolved config home, so `/tui`, settings UI changes, and startup auto-launch now read/write one shared `config.json`.

The TUI is only one surface of that work. The actual goal is to merge the useful parts of Codex, Gemini CLI, Kimi CLI, OpenClaw, duck-cli, MiniMax Agent CLI, and mercury-agent throughout the whole DuckHive harness: shared tools, orchestration, sessioning, model routing, permissions, media jobs, automation, and every major interaction surface.

The rule going forward is:

- land imported capabilities in shared harness layers first
- surface them in `duckhive`, the Go TUI, the legacy REPL, print/headless flows, and backend services second
- avoid TUI-only implementations for features that should exist across the product

Current TUI foundations:

- Welcome screen that highlights imported feature pillars
- Agent, Shell, Council, and Media composer modes
- Kimi-style `Ctrl-X` shell toggle inside the TUI
- Codex-style `/goal` status surfaced in the command deck, rail, and bridge-backed command path
- Session rail for bridge state, checkpoints, context files, and imported capability status
- Transcript rail toggle and tracked TUI backlog files
- Quieter terminal-first styling with inspector/transcript rails kept opt-in

For terminal diagnostics, `duckhive tui --help` now explains the standalone
Go/Bubble Tea binary requirement, the Windows-safe classic REPL default, the
provider-free `duckhive tui --snapshot` render check, the
`DUCKHIVE_TUI_WINDOWS_EXPERIMENT=1` opt-in, and the companion
`duckhive runtime-doctor` / `duckhive input-test` checks. This keeps the TUI
path discoverable without making no-args Windows startup depend on the
experimental renderer.

Historical TUI planning and remaining harness backlog notes live in:

- `tui/TODO.md`
- `tui/KANBAN.md`
- `tui/FEATURE_MATRIX.md`

Validation for the Go shell:

```bash
cd tui
go test ./...
```

### Getting Started

**Option 1 — npm install:**
```bash
npm install -g github:Franzferdinan51/DuckHive
# after publishing to npm:
# npm install -g duckhive

# OR clone and install locally
git clone https://github.com/Franzferdinan51/DuckHive.git
cd DuckHive && bun install && bun run build
```

**Option 2 — Direct run:**
```bash
./bin/duckhive
```

Interactive `duckhive` follows the classic REPL as the safe default on Windows. The launcher disables early key capture on Windows, forces the classic REPL for no-args startup, and clears inherited TUI handoff state unless you explicitly run `duckhive tui` or opt into `DUCKHIVE_TUI_WINDOWS_EXPERIMENT=1`; that keeps stale environment variables from freezing input behind a started UI. The renderer now uses the Windows data-event stdin path by default so typed characters reach the prompt after the UI paints in PowerShell/npm shim launches. Use `duckhive --stdin-mode readable` only when comparing DuckHive's readable compatibility path. The renderer leaves Windows `process.stdin` as the default input owner when it is already a TTY, but if a PowerShell/npm shim detaches stdin while stdout is still interactive, DuckHive automatically falls back to `CONIN$` so the classic REPL can receive keystrokes; set `DUCKHIVE_DISABLE_CONIN_STDIN=1` only for stdin fallback diagnostics. The launcher-provided DuckHive provider preference is now honored by the runtime route resolver, so the default MiniMax path does not fall back into Anthropic setup screens before the chat prompt mounts. Explicit `--dangerously-skip-permissions` / `--yolo` startup is treated as user consent and no longer blocks the REPL behind an extra pre-prompt selector. Startup-era dialogs, permission queues, and callouts are also blocked from unmounting `PromptInput` before the first submitted message, so the first visible REPL frame remains typeable. Startup/status UI copy now avoids mojibake-prone separators and upstream `claude`/`openclaude` command guidance in terminal-sensitive surfaces, so Windows logs and PowerShell renders stay DuckHive-branded and readable. Run `duckhive tui` to launch the Go TUI explicitly, run `duckhive input-test` when diagnosing terminal input, or set `DUCKHIVE_WINDOWS_EARLY_INPUT_EXPERIMENT=1` only if you intentionally want the older early-input buffering path. Auxiliary Council startup is also opt-in via `DUCKHIVE_AUTO_START_COUNCIL=1`, so default CLI startup does not wait on a daemon before the REPL is interactive.

The prompt-adjacent UI now uses DuckHive branding in active terminal surfaces too: guest-pass tickets show `DH`, idle notifications say DuckHive is waiting for input, IDE onboarding references DuckHive changes, and transcript-sharing copy asks to improve DuckHive rather than upstream Claude Code.

**After setup:**
```bash
# First-run: use the interactive setup wizard
/init

# Then just code
duckhive "Implement a REST API"
```

**Windows source checkout:**
```powershell
.\install.ps1
duckhive --dangerously-skip-permissions
duckhive --yolo
```

`--yolo` and `--dangerously-skip-permissions` are the same startup mode. Both
are applied before the full CLI imports so permission-bypass startup is visible
to early-loaded modules as well as the interactive REPL. The same aliases are
also honored by direct-connect URLs and `duckhive ssh`, so remote/bridged
sessions do not lose bypass intent when using the shorter `--yolo` spelling.

You can also use the packaged local launcher scripts from a source checkout:
```powershell
bun run start:local -- --dangerously-skip-permissions
bun run start:local -- --yolo
```

For source checkouts, the outer `bin/duckhive` launcher now defers provider
and model selection to DuckHive's real startup-profile bootstrap instead of
hardcoding `ChatGPT/OpenAI` defaults ahead of the CLI. That means first-run
startup falls back to MiniMax, while saved `/provider` profiles and startup
settings stay authoritative.

If `duckhive` is not recognized in PowerShell, the package is not installed on your `PATH` yet. From a source checkout, run `.\install.ps1`; it creates `$env:LOCALAPPDATA\DuckHive\bin\duckhive.cmd` and updates both your user PATH and the current PowerShell session. You can also use `.\bin\duckhive.cmd` directly, install globally with `npm i -g github:Franzferdinan51/DuckHive`, run `npm link`, or use the published `duckhive` package when available.

If `duckhive` is launched from a redirected or otherwise non-interactive terminal
without `-p/--print`, it exits instead of painting a dead REPL. Use
`duckhive -p "<prompt>"` for headless output, run `duckhive input-test` from
the terminal where typing fails, or run `duckhive runtime-doctor` for full
terminal/runtime checks.

Headless structured output supports DuckHive's inline `--json-schema '{"type":"object",...}'`
form and Codex-compatible file input with `--output-schema schema.json`. The
file form uses the same SyntheticOutput validation path as `--json-schema`, so
it also works with resumed print sessions such as
`duckhive --resume <session-id> -p "continue" --output-schema schema.json`.

The default terminal CLI now advertises DuckHive's harness commands directly in
`duckhive --help` instead of hiding them behind REPL-only slash command docs.
Provider-free top-level surfaces include `goal`/`g`, `computer-use`/`cu`,
`mmx`/`minimax`, `provider`, `run`/`runs`, `channel`, `connect`/`telegram`,
`config`/`settings`, `skill`/`skills`, `team`, `council`, `senate`, `decree`,
`swarm`, `orchestrate`, and `spawn`/`subagent`. These command paths start
without provider validation so diagnostics, setup, and run control remain
usable even when the chat REPL cannot start.

If the REPL renders but will not accept typing, run `duckhive input-test` from
the same terminal first. It exercises the raw keyboard path without starting
providers, the REPL, or the TUI, and echoes characters until Enter is pressed.
Then run `duckhive runtime-doctor`. It checks Windows stdin mode, TUI fallback,
provider routing, ClawHub skill hub, computer-use fallback, Telegram connector
config, the installed `duckhive` launcher on `PATH`, and harness command
registration without starting the chat UI. Add `--strict-interactive` when you
want the doctor to fail unless stdin and stdout are attached to a real terminal.
From a source checkout, `bun run doctor:runtime:strict` runs that same strict
terminal readiness check, and `bun run doctor:runtime:strict:json` emits the
failing strict report as JSON for logs or issue reports. On Windows,
`duckhive runtime-doctor` should report `Windows data-event stdin is active`.
The startup context loader also uses a Windows-safe filesystem-root stop
condition now, so `DUCK.md` / `AGENTS.md` parent-directory discovery cannot loop
forever on `C:\` before `/goal`, headless print mode, or the interactive prompt
can accept input.
DuckHive clears fragile stdin overrides at startup unless
`DUCKHIVE_ALLOW_FRAGILE_STDIN=1` is set, because alternate stdin paths are most
likely to produce a painted-but-dead prompt under PowerShell. Data-event stdin
is the supported Windows default, while `duckhive --stdin-mode readable` is
available only as an explicit compatibility comparison.

---

### Distribution

DuckHive is distributed as a `duckhive` launcher that boots the TypeScript agent core and, for interactive sessions, hands off to the checked-in Go TUI binary. DuckHive owns only the `duckhive` command; the `openclaude` command should remain installed from `@gitlawb/openclaude`.

| Method | Command |
|--------|---------|  
| npm from GitHub | `npm i -g github:Franzferdinan51/DuckHive` |
| npm after publish | `npm i -g duckhive` |
| Homebrew | `brew install franzferdinan51/tap/duckhive` |
| Git clone | `git clone && bun install && bun run build` |

The TypeScript agent core (`dist/cli.mjs`) is built via `bun run build` and runs under the Go CLI harness. DuckHive starts its own MCP/runtime surfaces on demand, but the Hive Nation Council runtime is still an external or separately launched service rather than an always-on auto-started daemon in this source checkout.

For this source checkout, the supported local Council runtime command is:

```bash
bun run council:serve
```

### WebUI: Hybrid Agent Console

DuckHive ships a dedicated WebUI for a Codex-style workbench with OpenClaw-style operational visibility. The WebUI is backed by a DuckHive-owned API instead of depending on an OpenClaw dashboard process.

```bash
# Terminal 1: DuckHive WebUI API
DUCKHIVE_WEBUI_API_PORT=3017 bun run webui:api

# Terminal 2: React WebUI
VITE_DUCKHIVE_API_BASE=http://localhost:3017 bun run webui:dev
```

The WebUI API exposes health, status, agents, tools, MCP servers, sessions, AgentRun inspection, and run controls. It also streams run lifecycle events over Server-Sent Events at `/api/events`.
The WebUI run controls use the same shared AgentRun actions as the CLI and Telegram bridge: pause, resume, stop, recover, and targeted approval of the first pending approval ID when one is present.

Useful endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | DuckHive WebUI API health/version |
| `GET /api/status` | provider, Telegram, search-provider, desktop/Android, OpenClaw optional status resolved from the active DuckHive runtime/config home |
| `GET /api/runs?status=running&parentRunId=...` | AgentRun list and root run tree with validated optional filters |
| `GET /api/runs/:id/events?limit=50` | compact run event tail, clamped to 1-200 events |
| `POST /api/runs/:id/pause` | pause a run |
| `POST /api/runs/:id/resume` | resume a run |
| `POST /api/runs/:id/stop` | cancel a run |
| `POST /api/runs/:id/approve` | approve a pending run action |
| `POST /api/runs/:id/recover` | mark a run for recovery |

Optional OpenClaw visibility is configured with `OPENCLAW_GATEWAY_URL`; DuckHive still owns the provider/model/session/tool/channel policy and the `duckhive` command.

### DuckHive SDK

DuckHive exposes the OpenClaude SDKv2-compatible runtime at `duckhive/sdk`. The SDK entrypoint is intentionally separate from the CLI bundle and builds to `dist/sdk.mjs` so consumers can import session/query APIs without pulling in React, Ink, or TUI-only modules.

```ts
import { query } from 'duckhive/sdk'

for await (const message of query({
  prompt: 'Summarize this repository',
  options: { cwd: process.cwd() },
})) {
  console.log(message)
}
```

The SDK surface includes generated schemas/types, query/session helpers, permission helpers, transcript helpers, and SDK-specific errors. `bun run build` verifies that the SDK bundle has no React/Ink leakage.

### Agent Harness Platform

DuckHive now has an experimental shared AgentRun control plane. Local agent tasks and hybrid orchestration runs are mirrored into a durable run store with normalized lifecycle events:

```
queued → preparing → running → awaiting_approval → paused → recovering → completed|failed|cancelled
```

The split follows the same safety boundary used by modern agent harnesses: DuckHive core owns provider/model selection, auth, session and transcript mirroring, tool policy, permissions, budgets, and channel delivery. A harness only executes a prepared attempt and streams events back.

Public experimental harness import:

```ts
import {
  registerAgentHarness,
  resolveAgentHarness,
  type AgentHarness,
} from 'duckhive/harness'
```

Runtime selection:

```bash
DUCKHIVE_AGENT_RUNTIME=auto              # default: choose a matching harness
DUCKHIVE_AGENT_RUNTIME=builtin           # force DuckHive core execution
DUCKHIVE_AGENT_HARNESS_FALLBACK=builtin  # default fallback
DUCKHIVE_AGENT_HARNESS_FALLBACK=none     # fail if no harness supports the run
```

The AgentRun store persists under DuckHive's config home by default, or under `DUCKHIVE_AGENT_RUN_STORE_DIR` when set. Shared run-control operations now cover list/inspect/tail-style event access, pause, resume, stop/cancel, approval, and recovery so Telegram, TUI, SDK/headless, and future harness plugins can use one lifecycle instead of separate state paths. `duckhive/harness` is intentionally separate from `duckhive/sdk` and builds to `dist/harness.mjs`.

### Telegram Remote Control

Telegram can inspect and control AgentRuns when `DUCKHIVE_TELEGRAM_BOT_TOKEN` is set. For safety, set `DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID` to a comma-separated chat allowlist before using a bot in shared chats.

Telegram bot run-control commands:

```text
/agents
/runs
/run <id>
/tail <id>
/pause <id>
/resume <id>
/stop <id>
/approve <id> [approval-id]
/status
```

DuckHive's CLI surface for that same lifecycle is the consolidated `/run` command:

```bash
/run list
/run <id>
/run tail <id> [limit]
/run pause <id>
/run resume <id>
/run stop <id>
/run approve <id> [approval-id]
/run recover <id> [summary]
```

The same consolidated surface is available outside the REPL as
`duckhive run ...`, `duckhive runs ...`, or `duckhive agent-run ...`; these
commands share the same durable AgentRun store as `/run`, Telegram, WebUI,
`duckhive ps/logs/attach/...`, and `--bg`.

The terminal `/run` surface validates status filters against the real AgentRun lifecycle, clamps event tails to 200 rows, preserves escaped quotes in quoted recovery summaries, and rejects unterminated quoted arguments before mutating run state. That keeps mistyped statuses, malformed recovery text, and unbounded tails from silently hiding runs, corrupting summaries, or flooding the CLI. Top-level terminal run controls are also wired into the same store for non-REPL use:

```bash
duckhive ps [status]          # List AgentRuns
duckhive runs [status]        # List AgentRuns through the /run alias
duckhive logs <id> [limit]    # Show recent AgentRun events
duckhive attach <id> [limit]  # Inspect an AgentRun with recent events and controls
duckhive pause <id>           # Pause a run
duckhive resume <id>          # Resume a paused run
duckhive approve <id> [appr]  # Approve a pending run action
duckhive recover <id> [note]  # Mark a failed/stuck run for recovery
duckhive kill <id>            # Cancel an AgentRun
duckhive --bg "long task"     # Register a queued AgentRun for shared controls
```

The old upstream `--bg`/`--background` spawning path no longer silently no-ops in DuckHive. It now registers a queued AgentRun in the shared store so `ps`, `logs`, `attach`, `kill`, `/run`, Telegram, WebUI, and harness consumers can see and control the request through the same lifecycle. `duckhive attach <id> [limit]` now prints run metadata, pending approvals, stored artifacts, a bounded recent event tail, and the exact pause/resume/kill/log commands for that run. Provider-backed detached execution is still a separate executor layer; this change makes background requests durable and inspectable instead of failing before they reach the control plane.

Long Telegram responses are chunked, Markdown delivery falls back to plain text, `/approve` uses the same AgentRun approval path as the CLI/WebUI and can acknowledge one pending approval ID without clearing the rest, and `bun run doctor:runtime` reports the Agent Harness, Telegram, and computer-use readiness state. Inspired by OpenClaw's raw-update redaction and Telegram media hardening, DuckHive Telegram debug logs now redact chat IDs and bot usernames while keeping useful lifecycle messages, and inbound Telegram photo/document turns preserve captions plus explicit media placeholders instead of being dropped before they reach the REPL or channel runner. Inspired by Hermes Agent deliverable mode, outbound Telegram messages scan for existing absolute local artifact paths and upload supported images as native photos plus PDFs, docs, spreadsheets, presentations, archives, audio/video, text, and HTML as native documents. `/run <id>` and `duckhive attach <id>` list stored local or URL artifacts, and Telegram `/run <id>` uploads existing local artifact files after the run detail reply.

Telegram long polling follows the latest compatible OpenClaw timeout hardening in both the Telegram service and channel adapter: DuckHive keeps the Bot API `getUpdates` HTTP abort window longer than the Telegram long-poll body timeout, so quiet polls can finish normally instead of racing a client-side abort at the same boundary.

### /init — Project Setup

> **For non-interactive use (scripts, CI, --print mode): use the lower-level `init_tool` interface below.**
> The built-in `/init` REPL command requires an interactive terminal.

**Interactive REPL mode:**
```bash
/init   # Launches the interactive setup wizard
```

**Non-interactive tool interface (scripts / CI / --print mode):**
```bash
init_tool action=setup    # Auto-analyze + create AGENTS.md, SOUL.md, TOOLS.md
init_tool action=detect   # Preview what would be created
init_tool action=config   # Configure ~/.duckhive/config.json
```

### /export — Conversation Export

Export the current DuckHive conversation to clipboard or disk. The export command supports OpenClaude-style plain text, Markdown, and JSON formats; filenames infer the format from `.txt`, `.md`/`.markdown`, or `.json`, and `--format`/`-f` can override the extension.

```bash
/export                         # Pick format and destination interactively
/export chat.md                 # Export Markdown based on filename extension
/export --format json chat      # Export chat.json
/export -f text transcript.log  # Export transcript.txt
```

### /goal — Persisted Workflow Goals

Track multi-step tasks across sessions with persisted goals. Inspired by Codex `/goal` (r0.128.0). Goals survive restarts and can be resumed later.

```bash
# Terminal
duckhive goal Build user authentication system
duckhive goal create Build user authentication system
duckhive goal list
duckhive goal list all
duckhive goal list active
duckhive goal status goal_abc123
duckhive goal pursue goal_abc123
duckhive goal stop-autonomous goal_abc123
duckhive goal step add goal_abc123 Implement login API

# Inside the REPL
/goal Build user authentication system              # Codex-style shorthand create
/goal create Build user authentication system    # Create a new goal
/goal list                                          # List all goals
/goal list all                                      # Disable the 10-goal preview limit
/goal list active                                   # Filter by status
/goal list failed                                   # Show failed goals
/goal status goal_abc123                            # Show goal details
/goal pause goal_abc123                            # Pause a goal
/goal resume goal_abc123                           # Resume paused goal
/goal complete goal_abc123                         # Mark as done
/goal fail goal_abc123                             # Mark as failed
/goal pursue goal_abc123                           # Start autonomous goal work
/goal stop-autonomous goal_abc123                  # Stop autonomous work and pause the goal
/goal attach goal_abc123                           # Link the current session UUID
/goal step add goal_abc123 Implement login API     # Add a step
/goal clear goal_abc123                             # Delete a goal
```

The same goal manager is available outside the REPL as `duckhive goal ...` or
`duckhive g ...`, so goal status, creation, and recovery still work when you
are diagnosing terminal input or running from automation.

Goals persist in DuckHive's config home (default `~/.duckhive/config.json`) and survive across sessions. DuckHive now supports the simpler Codex-style shorthand `/goal <description>` in addition to `/goal create ...`, while still rejecting single-word unknown subcommands like typos instead of silently creating junk goals. `/goal pursue [id]` activates autonomous goal mode, creates an initial active step from the goal description when needed, and, when run from the live REPL, starts a background teammate for that goal; `/goal stop-autonomous [id]` clears the active agent run and pauses both the goal and its current active step. The REPL parser preserves escaped quotes in goal and step text, and rejects unterminated quoted input before creating or mutating goals. `/goal list` keeps a 10-goal preview by default and now reports the visible count accurately, while `/goal list all` really shows the full persisted set; filtered lists such as `/goal list active` and `/goal list failed` report both the filtered subset count and the overall persisted goal total. Unknown list filters are rejected instead of silently falling back to the full list, and failed goals are reachable with `/goal list failed`. `/goal attach` records the real active DuckHive session id instead of a synthetic placeholder, and goal status output shows that attached session so resumed work can be traced back to the conversation that owns it. Active steps now follow the goal lifecycle too: pausing a goal pauses its current step, resuming reactivates it, completing the goal marks the current step completed and clears the current-step pointer, and failing the goal marks the current step failed before clearing it. Adding a new current step now completes the previous current step so one goal does not accumulate multiple active steps. Step creation is restricted to active goals, so paused or completed goals cannot accumulate new active steps. Goal output uses ASCII-safe status labels like `[active]`, `[paused]`, `[done]`, and `[failed]` so Windows terminals and log captures do not render broken emoji/mojibake. When multiple active goals exist, `/goal pause`, `/goal complete`, `/goal clear`, and `/goal attach` now return command-specific guidance telling you which explicit `goal-id` form to run. Goal-first sessions also stay discoverable in portable history/list-sessions surfaces now: when a session starts with `/goal <objective>`, DuckHive reuses the command arguments as the session title instead of collapsing the thread to a bare `/goal` label. Search-provider preferences use that same resolved config-home `config.json`, so CLI and WebUI status now read/write one shared settings surface.

### Sub-Agent Spawning with Model Routing

Spawn specialized sub-agents with automatic model selection based on task type. When you do not pass `--model`, each sub-agent now gets a routed model from DuckHive's multi-model router based on the agent type and task text.

```bash
# Spawn a coding sub-agent (routes to GPT-4o or best available)
/subagent spawn coding "Implement a REST API"

# Spawn with explicit model
/subagent spawn --model qwen3.6-35b "Analyze this code"

# Route a task by complexity
/router route "build a Flutter app" complexity=7 vision=true
/router list
/router compare "analyze this architecture" --complexity=5
```

`/router` is now a real slash command instead of only a lower-level tool surface. It accepts the documented `key=value` syntax as well as `--key=value` flags for `complexity`, `vision`, `functionCalling`, `preferSpeed`, `preferQuality`, and `maxCost`.

`/spawn` and its `/subagent` alias now accept the README forms directly: an optional leading `spawn`, an optional leading agent type like `coding`, `--label`, and `--model`. Those values are forwarded into the teammate spawner instead of being silently treated as task text.

Regular prompt submissions now do a smaller version of that vision routing too: if the current main-loop model lacks image support but the prompt includes image blocks, DuckHive applies a route-aware model override to a known vision-capable model on that active provider when one exists. Queued prompt input also preserves pasted images and embedded inbound image blocks when pulled back into the REPL input buffer, preventing current-turn media from degrading to text-only context during follow-up or restore flows.

### AI Council Runtime

DuckHive’s `/council`, `/team`, `/senate`, and `/orchestrate` surfaces speak to the Hive Nation runtime on port `3007` by default. DuckHive now aligns with the merged Agent-Teams council API shape and can inspect the live council runtime when it is available, but the Council service itself is still a separately launched process in this checkout rather than an auto-started bundled daemon.

```bash
bun run council:serve

/council "Should we use microservices?" mode=deliberation
/council --status
/council --stop
/council --modes
/council --councilors
/team spawn analysis "Research Redis caching"
/senate show DECREE-001
```

`/council` now resolves its available modes from the live Hive Nation backend when one is running, with a local compatibility fallback when it is not. That keeps the CLI aligned with the merged Agent-Teams council server instead of freezing an older client-side mode list. DuckHive also exposes `/council --modes` for the live mode catalog and `/council --councilors` for the live councilor deck, so the command can inspect the upstream council runtime instead of only starting a deliberation blind. Council mode parsing accepts the upstream AI-Bot-Council-Concensus spelling by mapping `concensus` to `consensus`, accepts both `--mode=value` and `--mode value`, preserves escaped quotes in questions, and rejects unterminated quoted questions before starting a deliberation. The bridge now accepts the checked-in Council server's raw `/api/councilors` array shape directly, the bundled source-checkout runtime now exposes the `/api/team*` and `/api/decree*` routes that DuckHive's `/team`, `/senate`, and `/decree` surfaces already use, and the runtime health contract now includes `services`, `uptime`, and memory stats so DuckHive's governance context no longer treats a live Council server as partially offline by default. When Hive Nation is offline, the governance wrappers now consistently point source checkouts at `bun run council:serve` and `DUCKHIVE_COUNCIL_URL` instead of only `/council` doing it.

---

### MiniMax M2.7 — Default Model

DuckHive boots with **MiniMax M2.7** as the default model, shown right in the startup banner. MiniMax M2.7 is a powerful reasoning and coding model that handles complex agentic tasks efficiently. The Hybrid Orchestrator routes tasks intelligently:

The `/router` command preserves escaped quotes in routed task text, rejects unterminated quoted input before invoking model selection, and accepts both `--complexity=7` and `--complexity 7` style options for terminal use.

- **Complexity 1–3**: Fast path, direct execution
- **Complexity 4–6**: Best model routing + optional council
- **Complexity 7–10**: Full deliberation with AI Council

---

### DuckHive mmx — All MiniMax Modalities

DuckHive mmx gives you the full MiniMax CLI stack directly from the harness. Generate images, synthesize speech, create music, and produce video without leaving the CLI. `duckhive mmx` and the `duckhive minimax` alias run as provider-free terminal commands, so help and media jobs do not need to start the chat REPL first.

The MMX launcher honors `MMX_BIN` first, then checks Windows npm shim locations such as `%APPDATA%\npm\mmx.cmd`, `%LOCALAPPDATA%\Programs\npm\mmx.cmd`, and the user's `.npm-global/bin` path through the real home directory. It never falls back through a literal `~` path, so Windows installs without `HOME` still resolve correctly.

```bash
# Generate images
duckhive mmx image "A cyberpunk cat"
duckhive mmx image "A serene mountain lake at dawn" --aspect 16:9

# Text-to-speech
duckhive mmx speech synthesize --text "Hello from DuckHive" --out hello.mp3
duckhive mmx speech synthesize --text "System online" --voice narrator --out alert.mp3

# Music generation
duckhive mmx music generate --prompt "Upbeat electronic, driving beat" --out track.mp3
duckhive mmx music generate --prompt "Sad piano ballad" --lyrics "Verse 1: Lost in the rain..." --out ballad.mp3

# Video generation
duckhive mmx video "A drone flying through redwood trees"
```

---

### Ctrl-X Shell Toggle

Drop from AI mode into a real shell and return seamlessly — no second terminal needed.

```bash
# Inside duckhive
duckhive> Ctrl-X   # → drops to shell
$ ls -la
$ exit            # → returns to duckhive AI mode
```

Inspired by Kimi CLI's shell mode, built into the harness for zero-friction context switching.

---

### DUCK.md Context Loading

DuckHive loads hierarchical context from `DUCK.md` files (gemini-cli style), merging project context into every session. Place a `DUCK.md` in your project root:

```markdown
# My Project Context

## Project
- Name: MyApp
- Stack: Bun + TypeScript + Hono

## Key Files
- src/index.ts — entry point
- src/routes/ — API routes

## Commands
- bun run dev — start dev server
- bun run test — run tests
```

DuckHive automatically finds and loads the nearest `DUCK.md` up the directory tree, prepending it to every prompt.

Session memory follows the same terminal-first continuity goal. Inspired by Codex's dense memory-summary refresh, DuckHive's default session-memory file starts with a `v1` schema line, keeps sections as compact routing handles instead of long chronology, and asks the updater to preserve exact paths, symbols, commands, upstream commit ids, error strings, verification gates, and current blockers. Over-budget reminders now target a denser 6k-token file before compaction injects it back into the session.

---

### Desktop And Android Control

DuckHive ships the bundled `newest-desktop-control` MCP gateway in `skills/newest-desktop-control`. It consolidates cross-platform desktop automation, Android ADB control, and Codex Computer Use detection behind one MCP surface. The older `desktop_control` tool and `/desktop` command remain available for the legacy Python/OpenClaw workflow, but new agent integrations should prefer the MCP gateway because it exposes stable tool names and compatibility aliases. The `/desktop` help and command description use ASCII-safe terminal text so Windows shells and log captures do not render broken approval or action markers.

**Setup (one-time):**
```bash
python3 -m pip install pyautogui pillow
adb devices -l   # optional, for Android devices/emulators
```

**MCP config:**
```json
{
  "newest-desktop-control": {
    "command": "node",
    "args": ["${SKILL_DIR}/newest-desktop-control/src/server.js"]
  }
}
```

**Desktop MCP tools:**
```
mcp__newest-desktop-control__desktop_screenshot
mcp__newest-desktop-control__desktop_mouse_move
mcp__newest-desktop-control__desktop_mouse_click
mcp__newest-desktop-control__desktop_mouse_scroll
mcp__newest-desktop-control__desktop_keyboard_type
mcp__newest-desktop-control__desktop_keyboard_press
mcp__newest-desktop-control__desktop_keyboard_hotkey
mcp__newest-desktop-control__desktop_clipboard_read
mcp__newest-desktop-control__desktop_clipboard_write
mcp__newest-desktop-control__desktop_get_screen_size
mcp__newest-desktop-control__desktop_get_pixel_color
mcp__newest-desktop-control__desktop_window_list
mcp__newest-desktop-control__desktop_window_activate
mcp__newest-desktop-control__desktop_launch_app
mcp__newest-desktop-control__desktop_terminal
mcp__newest-desktop-control__desktop_file_read
mcp__newest-desktop-control__desktop_file_write
```

**Android MCP tools:**
```
mcp__newest-desktop-control__android_devices
mcp__newest-desktop-control__android_screenshot
mcp__newest-desktop-control__android_screen_size
mcp__newest-desktop-control__android_current_activity
mcp__newest-desktop-control__android_tap
mcp__newest-desktop-control__android_swipe
mcp__newest-desktop-control__android_text
mcp__newest-desktop-control__android_key
mcp__newest-desktop-control__android_launch_app
mcp__newest-desktop-control__android_ui_dump
mcp__newest-desktop-control__android_logcat
```

**Diagnostics and aliases:**
```
mcp__newest-desktop-control__backend_status
mcp__newest-desktop-control__permissions_check
mcp__newest-desktop-control__codex_mcp_config

# Legacy aliases are preserved by the gateway:
screenshot, mouse_click, keyboard, terminal, file_read, run_script,
computer_use_screenshot, computer_use_mouse_click, computer_use_keyboard
```

Desktop mouse/keyboard/app actions may require Accessibility and Screen Recording permissions on macOS. Android actions require Developer Options plus USB debugging or an emulator. Codex Computer Use is still detected through supported Codex integration points including a local `packages/computer-use-bundle/computer-use` checkout and the standard Codex.app bundle path `/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use`. Custom test bundles can use `DUCKHIVE_CODEX_COMPUTER_USE_PLUGIN_DIR` / `CODEX_COMPUTER_USE_PLUGIN_DIR`, or direct client overrides with `DUCKHIVE_CODEX_COMPUTER_USE_CLIENT` / `CODEX_COMPUTER_USE_CLIENT`; `/computer-use` and `newest-desktop-control` honor the same override names. Separate from that, DuckHive also has a CHICAGO_MCP-gated built-in `computer-use` runtime path in builds where that feature is compiled in; in those builds the `computer-use` MCP server name is reserved for DuckHive itself, so `/computer-use` becomes an inspection/status surface rather than a path that rewires the Codex plugin on top of it. Status guidance is state-aware: it now tells you whether the built-in runtime owns the slot, whether a stale project MCP entry exists, whether to reload MCP, whether a Codex plugin bundle is merely discoverable for inspection, or whether to fall back to the bundled `newest-desktop-control` gateway. `/computer-use disable` works on every platform so Windows/Linux users can remove stale project MCP entries even though native Codex computer-use is macOS-only. If the native Codex plugin is missing, use `newest-desktop-control` for desktop, Android, and `computer_use_*` compatibility aliases instead of being blocked on Codex.app. DuckHive does not patch or bypass proprietary Codex binaries.

The same inspection/control surface is available outside the REPL as
`duckhive computer-use ...`, `duckhive cu ...`, or `duckhive comput-use ...`.
That keeps Codex computer-use status and stale MCP cleanup reachable while
debugging terminal input, startup, or provider configuration.
Use `duckhive computer-use tools` or `/computer-use tools` to list the native
Codex MCP tool names alongside the bundled `newest-desktop-control` fallback
tools without opening the README.

The plugin marketplace details view now inspects local-source plugins before installation. When a marketplace entry points at a checked-out plugin directory, DuckHive shows discovered `commands/`, `agents/`, `skills/`, `output-styles/`, `hooks/hooks.json`, and `.mcp.json` components instead of a generic placeholder, so Codex-style plugin browsing is less guessy for local harness development.

---

### DuckHive Android — Run on Android via Termux

DuckHive runs natively on Android using Termux + glibc-runner. Based on [openclaw-android](https://github.com/AidanPark/openclaw-android).

**Quick Install (in Termux):**
```bash
curl -sL https://raw.githubusercontent.com/Franzferdinan51/DuckHive/main/scripts/duckhive-android/install.sh | bash
```

**Commands:**
```bash
dh update                           # Update DuckHive
dh backup                           # Backup config and skills
dh android screenshot               # Take device screenshot
dh android tap 500 500              # Tap screen coordinates
dh android swipe 100 500 300 500    # Swipe gesture
dh android text "hello"             # Input text
dh onboard                          # Initial setup
dh status                           # Show status
```

**Requirements:**
- Android with [Termux](https://f-droid.org/en/packages/com.termux/) (F-Droid recommended)
- ~200MB storage footprint

---

### BrowserOS MCP — Full Desktop Browser Automation

DuckHive integrates [BrowserOS](https://github.com/browseros-ai/BrowserOS) for full desktop browser automation via Chrome DevTools Protocol. BrowserOS MCP is pre-configured in `config/mcporter.json` and available to DuckHive's MCP tools.

**Requirements:** BrowserOS.app must be running. Start it with:
```bash
open -a BrowserOS
```

**Via DuckHive MCP tools (`/mcp`):**
```
/mcp list           — list available MCP servers and tools
/mcp call browseros.new_page url="https://github.com"
/mcp call browseros.take_snapshot
/mcp call browseros.get_page_content
```

**Via mcporter CLI (standalone):**
```bash
mcporter list                          — list servers
mcporter list browseros --schema       — show BrowserOS tool docs
mcporter call browseros.new_page url="https://example.com"
mcporter call browseros.screenshot     — capture current page
mcporter call browseros.take_snapshot   — interactive element tree
mcporter call browseros.click element=42
```

**Available BrowserOS tools (66 total):**
- Navigation: `new_page`, `navigate`, `get_url`, `get_page_content`
- Interaction: `click`, `type`, `key`, `hover`, `select`, `evaluate`
- Screenshot: `screenshot`, `take_snapshot`, `take_full_page_screenshot`
- Tabs: `new_tab`, `close_tab`, `list_tabs`, `switch_tab`
- Downloads: `download_start`, `download_list`, `download_cancel`
- Clipboard: `copy`, `paste`

**Configured at:** `~/.mcporter/mcporter.json` and `config/mcporter.json`

---

### Agent Teams

Spawn multi-agent crews that work in parallel on complex tasks. DuckHive integrates Agent Teams for structured delegation. `/team`, `/council`, `/orchestrate`, `/swarm`, `/senate`, and `/decree` now share hardened terminal argument behavior: escaped quotes survive inside names/questions/tasks/decrees, unterminated quoted input fails before spawning teams, starting deliberation, launching swarms, or issuing decrees, and orchestration/swarm flags accept both `--mode=value` / `--team=value` / `--domain=value` / `--count=value` and the separated `--mode value` / `--team value` / `--domain value` / `--count value` forms.

```bash
# Terminal
duckhive council "Should we use microservices here?" mode=deliberation
duckhive council --status
duckhive team research "Research Redis caching"
duckhive team spawn analysis "Research Redis caching"
duckhive senate "Proposal: switch to Bun runtime"
duckhive decree "DECREE-007: Use Bun for all new APIs"
duckhive orchestrate "Build a REST API" --mode=deliberation

# Inside the REPL
/council "Should we use microservices here?" mode=deliberation
/council --status                                  # Inspect the active session
/council --stop                                    # Stop the active session via Hive Nation
/team research "Research Redis caching"            # Shorthand template form
/team spawn analysis "Research Redis caching"      # Explicit spawn form
/senate "Proposal: switch to Bun runtime"         # 94 senators vote
/decree "DECREE-007: Use Bun for all new APIs"    # Issue binding law
/orchestrate "Build a REST API" --mode=deliberation
```

**Governance pipeline**: Council debates → Senate passes decree → Teams execute per decree.

`/orchestrate` now preserves quoted task text when you add flags like `--dry-run`, `--council`, `--mode=...`, or `--team=...`, so the orchestration router sees the same task text the user typed. The selected `--mode` value is now forwarded into the hybrid orchestrator instead of being parsed and then ignored, and when you omit `--mode` DuckHive prefers the live Hive backend default (`deliberation`) before falling back to older compatibility modes.

`/senate` now accepts the bare shorthand form shown above in addition to `/senate issue ...`, and `/decree` strips wrapper quotes from the decree title/content instead of persisting the quote characters as part of the law text.

Decrees issued without an explicit authority now default to `duckhive` across the shared Hive bridge and built-in Hive Senate tool, so governance payloads no longer inherit stale OpenClaude authority branding.

> **Hive Nation runtime** — DuckHive’s governance commands target the Hive Nation / Council service on port 3007 by default, but that service is not auto-started by the current source checkout. Start the Council runtime separately or point DuckHive at a running service with `DUCKHIVE_COUNCIL_URL`.

The bundled Council server can enrich live-context questions through Brave Search. Set `BRAVE_API_KEY` or `BRAVE_SEARCH_API_KEY` directly, or point `DUCKHIVE_OPENCLAW_CONFIG_PATH` / `OPENCLAW_CONFIG_PATH` at an OpenClaw `openclaw.json`; otherwise it falls back to `~/.openclaw/openclaw.json` using the OS home directory.

### Continuous Self-Improvement

For this source checkout, the built-in local Hive Nation runtime command is `bun run council:serve`.

DuckHive now has two separate background improvement loops:

- repeated-topic detection after memory extraction can author new `skills/<slug>/SKILL.md` entries when the same workflow keeps showing up
- a self-improvement review fork now inspects recent turns after extraction and can write actionable review notes under `~/.duckhive/self-improvement/reviews/` when it detects missing durable memory, reusable skill gaps, or unfinished harness friction worth fixing later

This is intentionally best-effort and asynchronous. It should not block the main REPL turn.

---

### /swarm — Code Swarming

Code swarming launches parallel sub-agents across DuckHive's current runtime routing buckets to tackle complex tasks from multiple angles simultaneously.

```bash
# Terminal
duckhive swarm "Build a REST API" --domain=coding --count=4
duckhive swarm "Audit this security vulnerability" --domain=security
duckhive swarm "Research new ML techniques" --domain=research
duckhive swarm --list          # Show all available swarm agents
duckhive swarm --list-domain   # List domain agent capabilities
duckhive swarm --dry-run       # Preview what would spawn

# Inside the REPL
/swarm "Build a REST API" --domain=coding --count=4
/swarm "Audit this security vulnerability" --domain=security
/swarm "Research new ML techniques" --domain=research
/swarm --list          # Show all available swarm agents
/swarm --list-domain   # List domain agent capabilities
/swarm --dry-run       # Preview what would spawn
```

`/swarm` accepts the higher-level aliases shown above such as `coding`, `security`, `code-review`, `analysis`, `backend`, and `frontend`, but resolves them onto the current runtime routing buckets: `build`, `audit`, `research`, `data`, `mobile`, and `game`. Unsupported domains are rejected clearly instead of falling through into a runtime error. `--count` is now validated as an integer from 1 to 8, so bad values like `0`, `-1`, `1.5`, or `9` stop before any teammate spawn is attempted. The review phase reports quality gates as configured targets until agent output supplies evidence; it no longer claims test/security/performance/documentation checks passed without proof. Swarm terminal output uses ASCII-safe phase, result, and vote labels so Windows terminals and log captures do not render broken emoji/mojibake.

### Swarm Voting — Multi-Agent Response Routing

When multiple agents respond, DuckHive routes the best response through three strategies:

```bash
# Terminal
duckhive swarm 'vote "response A" | "response B"'
duckhive swarm 'merge "response A" | "response B"'
duckhive swarm 'pick-best "response A" | "response B"'

# Inside the REPL
/swarm vote "response A" | "response B"           # Proxy peer tally
/swarm merge "response A" | "response B"          # Combine complementary responses
/swarm pick-best "response A" | "response B"      # Heuristic ranking
```

**Strategies:**
- `vote()` — use explicit mailbox ballots when teammates submit them; otherwise fall back to one proxy vote per agent for the strongest peer
- `merge()` — combine responses, deduplicate overlapping sections
- `pickBest()` — heuristic scoring: completeness (40%), correctness (30%), code quality (30%)

The `/swarm` slash command now exposes these modes directly for pasted candidate responses. The shared swarm voting helper no longer points at stub mailbox modules: it now reads the current collector inbox, resolves the latest response summary per agent, accepts structured or plain-text `swarm_vote` ballots when they exist, and only falls back to proxy voting when no explicit ballots were submitted.

---

### /acp — ACP Server for IDE Integration

Start the Agent Client Protocol server for IDE integration (Kimi CLI style).

```bash
/acp                    # Start ACP server
/acp status            # Check server status
/acp stop              # Stop server
```

`/acp status` and `/acp stop` now manage the in-process ACP listener instead of being README-only placeholders. ACP `tools/call` and `tools/call_batch` now execute real shell, file-read, file-write, directory-list, and search operations through DuckHive's ACP server. ACP `chat/message` also routes through DuckHive's SDK query path, and clients that negotiate the `tools` capability can use the local shell/filesystem/search tool family directly (`Bash`, `PowerShell`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `LSP`). Other tools still stay denied and should go through explicit ACP `tools/call`.

---

### /spawn — Subagent Spawning

Spawn a subagent teammate to handle a task in parallel (Hermes Agent style).

```bash
/spawn "Implement a REST API"
/spawn "Analyze this code" --label=reviewer
/subagent spawn coding "Implement a REST API"

duckhive spawn "Implement a REST API"
duckhive subagent spawn coding "Audit router" --model qwen3.6-35b
```

`--label` is now honored by the slash command itself and becomes the spawned teammate's display/name prefix instead of being ignored by the UI wrapper.
Outside the REPL, `duckhive spawn`, `duckhive subagent`, and `duckhive deep-dive`
register a queued AgentRun in the shared run store so terminal users can inspect
and control subagent requests through `duckhive ps`, `duckhive attach`,
`duckhive logs`, `duckhive kill`, `/run`, Telegram, and the WebUI. Use the REPL
`/spawn` surface when you need immediate in-session teammate execution.

---

### /introspect — DUCK.md Influence Analysis

Analyze how DUCK.md context files are influencing the current session (Gemini CLI style).

```bash
/introspect             # Analyze current session influence
/context load          # Reload context files
/context scan          # Scan for DUCK.md files in scope
```

When `DUCKHIVE_CONTEXT_COLLAPSE=1` or the compiled `CONTEXT_COLLAPSE` gate is
enabled, `/context` now remains safe to run: the context-collapse projection
helper is a real identity projection for the current direct-collapse mode, and
the collapse service notifies status subscribers when enablement or collapse
stats change.

---

### /prompt-suggest — Prompt Engineering Analysis

Analyze and suggest improvements to your prompts (Gemini CLI style).

```bash
/prompt-suggest "my complex prompt here"
```

---

### /instruct — DUCK.md Tuning Assistant

Helps you write and refine DUCK.md context files (Gemini CLI style).

```bash
/instruct "add a section about testing conventions"
```

---

### /changelog — Parse CHANGELOG from PR

Extract and format changelog entries from PR bodies or git commits.

```bash
/changelog                    # Parse current PR
/changelog 123               # Parse specific PR
/changelog --all              # Show all commits
/changelog --tag=v0.7.0      # Show commits since tag
```

Requires PR body format:
```markdown
<!-- CHANGELOG:START -->...<!-- CHANGELOG:END -->
```

---

### /pr-size — PR Size Classification

Classify the size of a pull request (XS→XL).

```bash
/pr-size                    # Current PR
/pr-size 123               # Specific PR
```

Output: `XS` (trivial), `S` (small), `M` (medium), `L` (large), `XL` (massive)

---

### Session Search — Literal + Keyword Search Across Sessions

Search past sessions by scanning persisted session message logs. The tool supports both longer keyword queries and short literal strings such as `UI`, `v2`, or punctuation-heavy searches.
Inspired by Hermes Agent's no-LLM session search rewrite, DuckHive's resume/search UI now ranks matches locally across tags, titles, branches, summaries, first prompts, and transcript excerpts instead of sending session lists to an auxiliary model. Quoted phrases and broad `OR` queries stay literal and provider-free, so searching old sessions remains fast even when no model is configured.

```bash
# Via /memory or context tools
/memory search "authentication bug"
/session search "REST API implementation"
```

---

### Skill Workshop — Local Skills + ClawHub Registry

Create and manage reusable skill scaffolds for future sessions through DuckHive's shared skills directory, and connect to the OpenClaw ClawHub skill registry for search, inspection, and installation.

```bash
/skill "my new skill"        # Create a reusable skill scaffold
/skill search "calendar"     # Search ClawHub
/skill inspect calendar      # Inspect a ClawHub skill
/skill install calendar      # Install a ClawHub skill into DuckHive's skills dir
/skill capture               # Scan repeated memory topics and author matching skills
/skill read my-new-skill     # Inspect a saved skill
/skill delete my-old-skill   # Delete a saved skill
/skills                      # Open the skills manager UI
/curate status               # Hermes-style skill library grading
/curate run                  # Write a curation report and identify archive candidates
```

The same Skill Workshop surface is available before full provider startup as top-level terminal commands:

```bash
duckhive skill --help
duckhive skill search "calendar"
duckhive skill inspect calendar
duckhive skill install calendar
duckhive skills              # List saved skills when running outside the REPL
```

ClawHub registry notes:
- DuckHive searches ClawHub directly through its public skill APIs and requests ClawHub's non-suspicious result filter by default.
- `/skill` and `duckhive skill` preserve escaped quotes in local skill names and ClawHub search queries, and reject unterminated quoted input before creating a local skill or calling the registry.
- `/skill inspect <slug>` surfaces ClawHub moderation verdicts, summaries, and reason codes when the registry provides them.
- `/skill install <slug>` refuses registry entries marked malware-blocked or `malicious` before downloading the archive.
- `/skill install <slug>` also validates the downloaded archive contains a root `SKILL.md`; invalid archives are removed instead of leaving an unloadable skill directory behind.
- Installed ClawHub skills are written under DuckHive's resolved `skills/` directory and get local provenance metadata at `.clawhub/origin.json`.
- Override the registry base with `DUCKHIVE_CLAWHUB_REGISTRY` or `CLAWHUB_REGISTRY` if you need a different ClawHub-compatible endpoint.
- `/curate` output uses ASCII-safe grades like `[A]` and plain separators so skill-library reports stay readable in Windows shells and log captures.

---

### MCP Server Management

Manage Model Context Protocol servers with the `dmcp` CLI.

```bash
duckhive dmcp list          # List installed MCP servers
duckhive dmcp add <server>  # Add an MCP server
duckhive dmcp remove <name> # Remove an MCP server
duckhive dmcp health        # Check MCP server health
```

The legacy `duckhive mcp` helper stores its `mcp-servers.json` file in the same resolved DuckHive config home as the rest of the CLI state, not a raw Unix-only `~/.config/duckhive` path. Set `CLAUDE_CONFIG_DIR` when you need to redirect that state for portable installs or tests.

---

### Memory & Intelligence — 3-Layer Recall System

DuckHive layers three memory systems for progressively smarter recall:

```
Query → BM25 (keyword, fast) → EmbedRecall (semantic) → LESSONS (permanent failure moat)
```

**BM25 Keyword Search** (`src/memdir/bm25.ts`) — From-scratch BM25, no external deps:
- Inverted index over shared DuckHive memory/config-home sources, stored in the resolved config home as `bm25-index.json`
- Tokenize: lowercase, strip punctuation, split on whitespace
- BM25 formula: k1=1.5, b=0.75
- `buildIndex()`, `search(query, limit?)`, `updateIndex()`, `clearIndex()`

**Embed Recall** (`src/memdir/embedRecall.ts`) — Semantic/conceptual search:
- Primary: LM Studio `/v1/embeddings` if `LM_STUDIO_URL` is set
- Fallback: TF-IDF cosine similarity (no external calls, runs locally)
- 82 stopwords filtered, IDF rebuilt on every index update
- Index and session bootstrap both use DuckHive's resolved config-home paths
- `indexDocument()`, `search()`, `clearIndex()`, `indexSessionContent()`

**FTS5 Search Layer** (`src/memdir/fts5.ts`) — SQLite-backed full-text indexing:
- Database and session roots now use DuckHive's resolved config-home and shared memory-base paths instead of separate hardcoded home directories
- `initFts5()`, `searchMemoriesFts5()`, `searchSessionsFts5()`, `getFts5Stats()`

**LESSONS.md** (`src/memdir/lessons.ts`) — Permanent failure moat:
- Append-only log of every provider failure, tool error, API limit, and infra mistake
- Never compacted, never deleted — the permanent record of what doesn't work
- `recordLesson()`, `getLessonsForTask(query)`, `recordProviderFailure()`, `recordToolError()`
- Auto-deduplication: 80% word overlap threshold prevents recording the same failure twice
- Pre-flight check: `getLessonsForTask()` called at session start before repeating past approaches
- Location: `<memdir>/LESSONS.md`, tags: `provider-failure`, `tool-error`, `api-limit`, `infra`, `code-pattern`, `permission`, `security`

### Task Planner — Structured Decomposition

DuckHive plans complex tasks before executing, with two planner strategies:

```bash
# Auto-selects based on task complexity
/plan "Build a REST API with auth"

# Force LLM planner for complex tasks
/plan --llm "Architect a microservices system"
```

**SimplePlanner** — Fast keyword heuristics, dependency ordering, per-step complexity scoring.

**LLMPlanner** — Full reasoning for complex tasks (complexity ≥7), JSON plan output, falls back to SimplePlanner on parse errors.

### Budget Tracker — Daily Spend Enforcement

Tracks spend per provider daily and auto-falls back when budgets are exhausted:

```bash
/budget                 # Show current spend and remaining
/budget set minimax 5.00  # Set $5/day limit on minimax
/budget set global 20.00  # Set the global daily budget cap
/budget reset          # Reset all spend counters
```

State: `~/.duckhive/budget-state.json` · Log: `~/.duckhive/budget-log.jsonl` · Fail-open (never blocks API calls). `/budget` rejects unterminated quoted input before changing provider or global limits, so malformed terminal input cannot partially mutate spend settings.

### Provider Cache — 30s Response Cache

Cache LLM responses for 30 seconds to skip redundant API calls:

```bash
/cache                 # Show provider-cache stats (entries, hits, misses, TTL)
/cache clear           # Flush the provider response cache and reset session cache metrics
/cache-stats           # Show per-request cache history for the current session
```

Keyed by `model::baseUrl::SHA256(messages)`, LRU eviction at 1000 entries. TTL configurable via `PROVIDER_CACHE_TTL=30`. `/cache` now wraps the actual shared provider response cache, rejects malformed quoted input before clearing cache state, and `/cache-stats` remains the detailed per-request observability surface.

### Custom Providers — OpenAI-Compatible Endpoints

Add any OpenAI-compatible API without code changes through the interactive provider manager:

```bash
/provider                 # Open the provider manager UI
duckhive provider status  # Inspect the active provider before starting the REPL
```

Config: `~/.duckhive/custom-providers.json` · Auto health-checks endpoints on add.

The current slash command opens the manager used to add, edit, delete, and activate provider profiles. Inline `/provider add|list|remove` subcommands are not currently implemented in the CLI. The top-level terminal `duckhive provider status` command is intentionally read-only and provider-free, so you can diagnose saved profile/model/endpoint routing before the chat UI starts.

First-class OpenAI-compatible presets are available through `/provider` and `--provider`, including OpenRouter and NVIDIA NIM:

```bash
duckhive --provider openrouter --model openrouter/auto
duckhive --provider nvidia-nim --model nvidia/llama-3.1-nemotron-70b-instruct
```

Use `OPENROUTER_API_KEY` for OpenRouter and `NVIDIA_API_KEY` for NVIDIA NIM. DuckHive maps them onto the OpenAI-compatible runtime for the active session without requiring you to overwrite `OPENAI_API_KEY`.

Gemini-compatible OpenGateway routes now preserve executable tool calls even when Gemini returns the fallback raw-text form:

```text
Tool calls requested:
- Write({"file_path":"style.css","content":"..."}) [id: call...]
```

DuckHive converts that text back into `tool_use` blocks in both streaming and non-streaming responses, so Gemini/OpenGateway sessions can keep using Write, Agent, Bash, and other harness tools instead of showing inert tool-call text in chat.

### Channel Adapters — Unified Messaging

DuckHive unifies messaging across channels through a shared interface — the agent loop doesn't know or care which channel it's talking to:

```bash
/channel list           # Show adapter readiness/config snapshot
/channel status         # Show all adapter readiness/config
/channel status telegram  # Check Telegram adapter health
/channel status webhook   # Check Webhook adapter config
/channel status email     # Check Email adapter config
/channel status console   # Check Console adapter availability
/channel send telegram "Hello"  # Send via Telegram
/channel send webhook "Hello"   # POST via configured outbound webhook
/channel send email "Hello"     # Send via configured SMTP/default recipient
/channel send console "Hello"   # Emit through the local console adapter
/channel connect telegram --token <TOKEN>
/channel connect webhook
/channel connect email
/channel disconnect telegram
/channel disconnect webhook
/channel disconnect email
```

Adapters: **TelegramAdapter** · **WebhookAdapter** (HTTP receiver) · **EmailAdapter** (IMAP/SMTP) · **ConsoleAdapter** (local TUI/REPL for debugging). All normalize to DuckHive's `Message` type. The `/channel` command now exposes real status snapshots for Telegram, Webhook, Email, and Console plus concrete Telegram connect/send, runtime Webhook connect/disconnect/send, runtime Email connect/disconnect/send, and Console send flows. Webhook status now reports inbound receive readiness, outbound send readiness, and current runtime connection state separately, and email status does the same for IMAP vs SMTP/default-recipient readiness plus live runtime state, so partially configured or currently disconnected adapters are shown accurately instead of looking fully ready. The ConsoleAdapter prompt, banner, help, status, and agent labels use ASCII-safe terminal text for Windows shells and log captures; `/connect` and `/channel` Telegram setup/status output now follows the same ASCII-safe rule.

Telegram supports `DUCKHIVE_TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN`. `/connect` is the Telegram credential setup surface; webhook, email, and console setup/status/send flows live under `/channel`. If a user types `/connect webhook`, `/connect email`, or `/connect console`, DuckHive now points them at the exact `/channel` command instead of treating the connector name as a malformed bot token. `/connect status`, `/channel status`, `bun run doctor:runtime`, and the WebUI `/api/status` payload now reflect env-backed Telegram configuration as well as secure-storage state, including whether config came from storage or the current process environment and whether a chat ID is available. `DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID` acts as both an inbound allowlist and, when `allowedChatId` is not passed directly, the default outbound reply target using the first chat ID in the list; malformed allowlists fail closed and `doctor:runtime` reports them as not ready instead of accepting every chat. `/connect` setup and success output now call out that allowlist explicitly, and channel labels use ASCII-safe `telegram:<bot-id>...` text for Windows terminals and copied logs. Env-backed status no longer inherits stale stored chat or connection-timestamp metadata from a different bot token, and `/connect disconnect` now clears both supported runtime token env vars inside the running DuckHive process. Tokens and registered chat IDs now restore correctly from secure storage across fresh starts. The long-polling path is hardened to keep polling after quiet `getUpdates` responses, bound Bot API calls with a timeout, and preserve later valid updates when earlier updates in a batch are filtered.

The same connector surfaces are available outside the REPL as `duckhive channel ...`, `duckhive connect ...`, and `duckhive telegram ...`. These paths are provider-free startup commands, so Telegram/channel setup and status stay reachable while debugging a frozen chat prompt or missing provider credentials.

### Custom Tools

DuckHive adds 40+ custom tools on top of the OpenClaude base:

| Tool | Command | Description |
|------|---------|-------------|
| **HiveCouncilTool** | `/council` | 46 AI councilors debate decisions |
| **HiveSenateTool** | `/senate` | 94 senators pass binding decrees |
| **HiveTeamTool** | `/team` | Spawn specialized multi-agent crews |
| **HiveDecreeTool** | `/decree` | Issue and enforce binding laws |
| **HiveOrchestrateTool** | `/orchestrate` | Smart complexity-based routing with parallel agent execution |
| **HiveSwarmTool** | `/swarm` | Code swarming — 17 domain agents in parallel |
| **SwarmVotingTool** | `/swarm vote\|merge\|pick-best` | Multi-agent response routing |
| **ConnectTool** | `/connect` | Connect Telegram bots and route other adapter setup to `/channel` |
| **MultiModelRouterTool** | `/router` | Route across 9+ providers |
| **ShadowGitTool** | `/shadow` | Git snapshots before changes (Gemini CLI style) |
| **CheckpointTool** | `/checkpoint` | Save and restore long AI sessions |
| **ContextTool** | `/context` | Hierarchical DUCK.md loading |
| **TaskPlannerTool** | `/plan` | Structured task decomposition (heuristic or LLM) |
| **AndroidTool** | `/android` | Full Android control via ADB |
| **VisionTool** | `/vision` | Phone screenshot + AI analysis |
| **MemoryTool** | `/memory` | Memory editor and recall surface |
| **LessonsTool** | — | Internal `LESSONS.md` failure moat used by memory/custodian flows |
| **BM25Tool** | — | Internal keyword index/search layer |
| **EmbedRecallTool** | — | Internal semantic recall layer |
| **KAIROSTool** | — | Internal proactive heartbeat/runtime surface |
| **MeshTool** | — | Internal agent mesh/networking surface |
| **SkillTool** | — | Internal runtime skill-generation primitive |

`/shadow` is now a real slash command wrapper around DuckHive's shadow Git safety net. It supports `/shadow checkpoint <message>`, `/shadow list`, and `/shadow restore <checkpoint-id> [--file <path>]` so the documented Gemini-style snapshot workflow is reachable from the CLI instead of only through the lower-level tool surface. `/shadow` preserves escaped quotes in checkpoint messages and rejects unterminated quoted input before creating or restoring checkpoints. `/checkpoint` and top-level `duckhive checkpoint` / `duckhive checkpoints` save/list/load/delete output use ASCII-safe status and separator text, run provider-free, and stay readable in Windows shells and plain log captures.
`/duckcustodian` keeps the OpenClaw/Crestodian-style diagnostics and rescue path available from the terminal. Approval prompts, rescue-mode health checks, and setup findings now use ASCII-safe status text so they remain readable when normal CLI output is being copied through Windows shells, logs, or Telegram.

`/android` and `/vision` are now real slash commands too. `/android` exposes the documented ADB control flow (`devices`, `screenshot`, `battery`, `tap`, `swipe`, `text`, `shell`), and `/vision` exposes `phone_screenshot`, `analyze`, and `phone_tap` directly from the CLI instead of relying on unrelated mobile-app aliases or tool-only entrypoints. Both commands preserve escaped quotes in user text and reject unterminated quoted input before running ADB actions.

`/loop` is the OpenClaude-inspired scheduled prompt loop surface. It supports `create`, `list`, `status`, `pause`, `resume`, and `clear`; `status` now works as documented instead of falling through to help. Its REPL parser matches the rest of the terminal harness by preserving escaped quotes in loop prompts and rejecting unterminated quoted input before storing scheduled loops. Loop creation accepts both `--every=20`/`--times=4` and separated `--every 20`/`--times 4` forms, rejects invalid options before mutation, and lifecycle commands reject ambiguous partial loop IDs instead of mutating the wrong schedule.

`/memory`, `/skill`, and `/skills` are the actual user-facing memory/skill commands today. `/skill` now provides a lightweight workshop surface for scaffold/list/read/delete workflows against DuckHive's shared `skills/` directory, while `/skills` still opens the richer interactive manager UI. The lessons, BM25, embed recall, KAIROS, mesh, and runtime skill-generation entries above are implemented subsystems or tool primitives, but they are not currently registered as standalone slash commands in the DuckHive CLI.
| **SkillWorkshopTool** | `/skill` | Scaffold local skills, search/inspect/install ClawHub skills, and block malicious registry installs |
| **SkillManageTool** | `/skills` | Interactive skill manager UI |
| **SessionSearchTool** | — | Literal + keyword search across past sessions |
| **CronRunTool** | — | Internal scheduled-job trigger surface |
| **BudgetTrackerTool** | — | Internal daily spend enforcement and fallback logic |
| **ProviderCacheTool** | — | Internal provider response cache layer |
| **CustomProvidersTool** | `/provider` | OpenAI-compatible endpoint config via the provider manager |
| **ChannelAdapterTool** | `/channel` | Unified messaging — Telegram/Webhook/Email/Console |

Hermes-style autonomous skill creation and `SkillManageTool` now use the same shared DuckHive roots as the rest of the harness: repeated-topic detection reads from the resolved memory base, `/skill capture` can trigger the scan on demand, and authored or managed `SKILL.md` files are written under DuckHive's resolved config-home `skills/` directory rather than separate hardcoded home paths.
| **SecretScannerTool** | — | Detect secrets before writing to memory |
| **SSRFValidationTool** | — | DNS-based URL validation for SSRF protection |
| **TrustedFoldersTool** | `/trusted-folders` | Folder-level security boundaries |
| **ShellModeTool** | `/shell-mode` | Ctrl-X AI↔shell toggle |
| **SwapTool** | — | Internal AI/shell mode switching primitive |
| **MCPManageTool** | `/mcp` | MCP server management |
| **ConfirmTool** | — | Internal interactive confirm/prompt primitive |
| **StatusBarTool** | `/statusline` | Status line rendering/toggles |
| **StreamTool** | — | Internal spinners/progress/thinking indicators |
| **REPLPanelTool** | — | Internal Bubble Tea table/panel renderer |
| **DeskDevTool** | `/desktop` | Desktop automation mode |
| **ACPCommand** | `/acp` | ACP server for IDE integration (Kimi CLI style) |
| **SpawnCommand** | `/spawn` | Spawn a subagent teammate (Hermes Agent style) |
| **InspectCommand** | `/introspect` | Analyze DUCK.md influence on current session |
| **PromptSuggestCommand** | `/prompt-suggest` | Prompt engineering analysis (Gemini CLI style) |
| **InstructCommand** | `/instruct` | DUCK.md tuning assistant (Gemini CLI style) |
| **ChangelogCommand** | `/changelog` | Parse CHANGELOG entries from PR body |
| **PrSizeCommand** | `/pr-size` | PR size classification (XS→XL) |

---

## Architecture

```
DuckHive v0.13.7
├── MiniMax M2.7 (default model)
├── DuckHive mmx (MiniMax CLI integration)
│   ├── Image generation
│   ├── Speech synthesis
│   ├── Music generation
│   └── Video generation
├── Agent Teams (multi-agent orchestration)
│   ├── /council   — 46 adversarial councilors
│   ├── /senate    — 94 senators, binding decrees
│   ├── /team      — spawn by role (researcher, coder, reviewer...)
│   ├── /swarm     — 17 domain agents in parallel (code-swarm)
│   ├── /decree    — binding laws enforced across agents
│   └── Swarm Voting — vote / merge / pick-best response routing
├── 3-Layer Memory & Intelligence
│   ├── BM25 (keyword) — inverted index in DuckHive's resolved config home (`bm25-index.json`)
│   ├── Embed Recall (semantic) — TF-IDF or LM Studio embeddings
│   └── LESSONS.md (permanent) — append-only failure moat, never deleted
├── Task Planner — SimplePlanner (heuristic) + LLMPlanner (complexity ≥7)
├── Budget Tracker — daily spend enforcement, ~/.duckhive/budget-state.json
├── Provider Cache — 30s LRU response cache, ~/.duckhive/provider-cache/
├── Custom Providers — OpenAI-compatible endpoint config
├── Channel Adapters — Telegram / Webhook / Email / Console
├── AI Council (46 councilors)
├── Hybrid Orchestrator
│   ├── Task Complexity Classifier (1–10)
│   ├── Model Router (MiniMax M2.7, Kimi K2.5, Gemma 4, more)
│   ├── Parallel Agent Execution (auto-spawn on complex tasks)
│   └── Fallback Chain (retry → fallback → never fail)
├── Auto-Compact (CONTEXT_COLLAPSE=true, auto-shrinks context)
├── MCP support (dmcp CLI)
├── Ctrl-X shell toggle
├── DUCK.md hierarchical context
└── 40+ Custom Tools
```

---

## What DuckHive Adds Over OpenClaude

| Feature | OpenClaude | DuckHive |
|---------|-----------|---------|
| **Default Model** | Claude | MiniMax M2.7 ✅ |
| **MiniMax mmx** | ❌ | ✅ Image / Speech / Music / Video |
| **Code Swarming** | ❌ | ✅ /swarm — 17 domain agents in parallel |
| **Agent Teams** | ❌ | ✅ Spawn multi-agent crews |
| **AI Council** | ❌ | ✅ 46 adversarial councilors |
| **Senate** | ❌ | ✅ 94 senators, binding decrees |
| **Ctrl-X Shell Toggle** | ❌ | ✅ Seamless AI↔shell |
| **DUCK.md Context** | ❌ | ✅ Hierarchical gemini-cli style |
| **Auto-Compact** | ❌ | ✅ CONTEXT_COLLAPSE=true auto-shrinks |
| **Session Search** | ❌ | ✅ FTS5 full-text search across sessions |
| **Skill Workshop** | ❌ | ✅ Skill workshop scaffold/list/read/delete surface (`/skill`) |
| **MCP CLI** | Basic | dmcp (enhanced) |
| **Governance** | ❌ | ✅ Council → Senate → Decree pipeline |
| **Shadow Git** | ❌ | ✅ Pre-change git snapshots |
| **Checkpoints** | ❌ | ✅ Session save/restore |
| **Bubble Tea TUI** | ❌ | ✅ Rich terminal rendering |
| **Multi-Model Router** | ❌ | ✅ 9+ provider routing |
| **Android Control** | ❌ | ✅ Full ADB integration |
| **KAIROS Daemon** | ❌ | ✅ Proactive heartbeat |
| **IDE Integration** | ❌ | ✅ /acp ACP server |
| **PR/Changelog Tools** | ❌ | ✅ /changelog, /pr-size, /introspect |
| **Secret Scanner** | ❌ | ✅ Detect secrets before memory writes |
| **SSRF Protection** | ❌ | ✅ DNS-based URL validation |
| **BM25 Keyword Search** | ❌ | ✅ Full-text session search, no deps |
| **Embed Recall** | ❌ | ✅ Semantic search (TF-IDF or LM Studio) |
| **LESSONS.md** | ❌ | ✅ Permanent failure moat, never deleted |
| **Task Planner** | ❌ | ✅ Heuristic + LLM task decomposition |
| **Budget Tracker** | ❌ | ✅ Daily spend enforcement + auto-fallback |
| **Provider Cache** | ❌ | ✅ 30s LRU response cache for all providers |
| **Custom Providers** | ❌ | ✅ OpenAI-compatible endpoint config |
| **Channel Adapters** | ❌ | ✅ Telegram / Webhook / Email / Console |
| **Swarm Voting** | ❌ | ✅ vote / merge / pick-best response routing |

---

## Installation

### Prerequisites

- **Bun** 1.3+ (for build/test)
- **Node.js** 22+ (runtime)
- **Git**

### Build from Source

```bash
git clone https://github.com/Franzferdinan51/DuckHive.git
cd DuckHive
bun install
bun run build
```

### Run

```bash
./bin/duckhive
```

For convenience, add `bin/` to your PATH or symlink:

```bash
ln -s "$(pwd)/bin/duckhive" ~/.local/bin/duckhive
```

---

## Configuration

DuckHive inherits the OpenClaude configuration model, while also carrying some compatibility paths from the upstream fork history. Set up your environment:

```bash
# MiniMax auth for the default model + mmx
export MINIMAX_API_KEY=sk-your-key-here

# Optional alias if you already use the mmx ecosystem naming
export MMX_API_KEY=sk-your-key-here

# Or sign in once with the MiniMax CLI and DuckHive will reuse ~/.mmx/config.json
# plus ~/.mmx/credentials.json OAuth access tokens, refreshing them with
# `mmx auth refresh` on demand during MiniMax requests when needed.
# mmx auth login --api-key sk-your-key-here

# Optional: other providers
export KIMI_API_KEY=sk-kimi-...
export OPENAI_API_KEY=sk-...
export OPENROUTER_API_KEY=sk-or-...
export LMSTUDIO_URL=http://localhost:1234

# Optional: configure default model
export DUCK_CHAT_MODEL=MiniMax-M2.7
```

See `~/.openclaude/`, project `.openclaude/`, and `~/.duckhive/config.json` for the current configuration surfaces carried by this fork.

### Meta-Agent Configuration

Configure meta-agent models, features, and limits in `~/.duckhive/config.json`:

```bash
# Initialize default config
duckhive config init

# View current config
duckhive config show

# Find config file path
duckhive config path
```

**Config schema:**

```json
{
  "meta": {
    "enabled": true,              // enable/disable meta-agent orchestration
    "complexityThreshold": 4,      // complexity level that triggers meta-agent (1-10)
    "models": {
      "orchestrator": "auto",     // model for task routing (auto, minimax/MiniMax-M2.7, etc.)
      "fast": "auto",              // model for simple tasks (complexity 1-3)
      "standard": "auto",           // model for medium tasks (complexity 4-6)
      "complex": "auto",           // model for complex tasks (complexity 7-10)
      "android": "auto",           // model for Android control tasks
      "vision": "auto",            // model for vision/screenshot analysis
      "coding": "auto"             // model for code generation tasks
    },
    "features": {
      "councilEnabled": true,      // enable AI Council deliberation
      "fallbackEnabled": true,     // enable automatic model fallback
      "selfHealing": true,         // enable self-healing on failures
      "learning": true              // enable learning from feedback
    },
    "limits": {
      "maxConcurrent": 3,          // max parallel sub-agents
      "maxRetries": 3,             // max retry attempts per task
      "timeoutMs": 60000           // default task timeout in ms
    }
  },
  "providers": {
    "default": "minimax",          // default provider (minimax, kimi, openai, lmstudio)
    "fallback": "openrouter"       // fallback provider
  }
}
```

**Model alias examples:**
- `"auto"` — use DuckHive's default routing
- `"minimax/MiniMax-M2.7"` — specific provider/model
- `"kimi/kimi-k2.5"` — Kimi vision model
- `"local/qwen3.5-9b"` — local via LM Studio
- `"free"` — OpenRouter free tier

---

## Usage

```bash
# Start interactive session
./bin/duckhive

# Single command
./bin/duckhive -- "Explain this codebase"

# With specific provider
./bin/duckhive -- --provider minimax --model MiniMax-M2.7

# Version
./bin/duckhive --version

# Command ownership check
duckhive --version      # 0.13.7 (DuckHive)
openclaude --version    # upstream OpenClaude, if installed separately
```

---

## Verification

Current shipping/runtime gates:

```bash
npm run typecheck
bun test
npm run build
npm run verify:privacy
npm run smoke
npm run doctor:runtime
npm run doctor:runtime:strict
npm run doctor:runtime:strict:json
npm pack --dry-run --json
cd tui && go test ./...
```

The current strict completion audit is tracked in
[`docs/completion-audit-2026-05-17.md`](docs/completion-audit-2026-05-17.md).
It separates verified CLI/runtime surfaces from remaining manual checks. This
checkout now includes a Windows `tui\duckhive-tui.exe` artifact built from a
locally verified Go 1.25.4 toolchain under `.tmp\go-toolchain`. In this shell,
the TUI gate includes both `cd tui && go test ./...` through that toolchain and
the packaged binary/input path through `runtime-doctor` and `npm run smoke`.

`bun run doctor:runtime` reports the CLI input mode, terminal stdio attachment, provider-free `duckhive input-test` reachability, terminal TUI launch path, packaged TUI `--input-smoke` and `--submit-smoke` readiness, computer-use fallback readiness, ClawHub skill-hub registry, the terminal-first harness command manifest, AI Council/Hive Nation runtime readiness, the live councilor catalog when reachable, and a read-only harness-state readiness snapshot for checkpoints, budget state/log files, MCP, ACP, and permissions. It mirrors DuckHive startup defaults by reporting MiniMax when no explicit provider env is active, while still preserving Anthropic only when selected explicitly. Use `bun run doctor:runtime:strict` in the terminal where you plan to type into DuckHive when you need a failing exit code for redirected or non-interactive stdin/stdout, or `bun run doctor:runtime:strict:json` when you need that failure in machine-readable form. The harness surface check declares the required core `/goal`, `/loop`, `/run`, `/computer-use`, `/channel`, `/connect`, `/skill`, `/spawn`, `/orchestrate`, `/team`, `/council`, `/senate`, `/decree`, `/swarm`, `/tui`, and `/doctor` surfaces, plus slash-only surfaces such as `/android`, `/vision`, `/shadow`, `/checkpoint`, `/router`, `/budget`, `/cache`, and `/export`, and high-value aliases like `/g`, `/subagent`, and `/cu`; the CLI smoke gate verifies the exact `package.json` version from `duckhive --version`, top-level help, the provider-free TUI snapshot render, the packaged TUI `--input-smoke` Bubble Tea input-loop diagnostic and `--submit-smoke` type-and-Enter diagnostic through both Node and Windows wrapper launch paths, plus provider-free headless slash entrypoints including `/loop`, `/android`, `/vision`, `/shadow`, `/checkpoint`, `/router`, `/budget`, `/cache`, `/export`, `/permissions profile`, `/spawn`, `/swarm`, `/senate`, and `/decree`, top-level `duckhive checkpoint list`, slash-print and top-level `checkpoint resume` aliases, and rejects provider-auth warnings on those local paths. The smoke gate also submits a real `--bare -p` prompt against an in-process OpenAI-compatible `/v1/chat/completions` mock to prove prompt submission returns text and does not regress to `Cannot read properties of undefined (reading '_zod')`. The `/permissions profile` and top-level `duckhive permissions profile` surfaces provide Codex-style permission/sandbox presets: `safe`, `balanced`, `edit`, `yolo`, and `off`, writing to local project settings by default or `--project` / `--user` when requested; `duckhive allowed-tools profile status` is kept as a compatibility alias for the same terminal-safe status path. The `/export` smoke coverage includes both help text and a real JSON file write from `--bare -p`, so OpenClaude-style Markdown/JSON conversation exports stay available outside the interactive dialog. `/channel --help` now resolves to the same adapter readiness snapshot as `/channel`, and `/spawn --help`, `/swarm --help`, `/senate --help`, and `/decree --help` are available in headless slash mode so automation can inspect Agent Teams/AI Council governance surfaces without starting providers or the Hive Nation backend. The skill-hub check reports the active ClawHub registry from `DUCKHIVE_CLAWHUB_REGISTRY`, `CLAWHUB_REGISTRY`, or the default `https://clawhub.ai`, and confirms that `/skill search`, `/skill inspect`, and `/skill install` are available. On Windows the launcher uses data-event stdin by default, disables early input capture, forces no-args startup to the classic REPL, clears inherited TUI handoff flags, and clears fragile stdin overrides unless `DUCKHIVE_ALLOW_FRAGILE_STDIN=1` is set; `duckhive --stdin-mode readable` is the compatibility comparison path when you intentionally want to compare DuckHive's readable input reader. The `npm run smoke` gate now runs the Ink stdin delivery and `TextInput` prompt-rendering tests before launching the CLI smoke cases, so default REPL typing coverage is part of the normal release check instead of a separate manual test. On Windows, the packaged `tui\duckhive-tui.exe` keeps `duckhive tui` reachable without requiring a local Go install; `duckhive tui --snapshot` renders one frame and exits for CI/log verification, `duckhive tui --input-smoke "typed text"` runs the compiled Bubble Tea input loop, and `duckhive tui --submit-smoke "submitted text"` verifies typing plus Enter submission without depending on the Python PTY helper. If the TUI artifact is missing in a source checkout, `duckhive tui` can still build it on demand when Go is installed. On non-macOS hosts, the computer-use check confirms that the bundled `newest-desktop-control` gateway is available for desktop, Android, and `computer_use_*` compatibility aliases instead of requiring Codex.app. The local TUI command deck also exposes the same read-only harness-state card for `/checkpoint`, `/budget`, `/mcp`, `/acp`, and `/permissions`, keeping checkpoint counts, MCP/ACP readiness, permission mode, and session spend visible while mutation remains in shared backend slash commands.

The query loop also includes the upstream OpenClaude repeated-tool-failure guard. If the same tool, error category, or file path fails repeatedly without an intervening successful tool result, DuckHive stops the loop with a path-safe diagnostic instead of burning turns forever. The default threshold is `3`; set `DUCKHIVE_TOOL_FAILURE_LOOP_THRESHOLD=0` to disable it, or set a higher integer when intentionally debugging repeated failures. `CLAUDE_CODE_TOOL_FAILURE_LOOP_THRESHOLD` remains supported as an upstream compatibility fallback.

Tool schema conversion is also hardened against malformed nested Zod schemas. If a tool exposes a broken field schema, DuckHive now logs the conversion failure and falls back to an empty object schema instead of crashing prompt submission with `Cannot read properties of undefined (reading '_zod')`. The post-build bundle patch that protects the remaining Zod v4 conversion sites is now strict: `scripts/postbuild-patch.mjs` fails the build if any expected `_zod` patch target disappears instead of silently shipping an unpatched CLI, and `scripts/postbuild-patch.test.ts` covers both the successful patch path and the failure path. Runtime doctor network probes also use cleanup-safe timeout signals instead of raw `AbortSignal.timeout`, guarded by `scripts/no-raw-abort-signal-timeout.test.ts`.

The API retry path also applies the Hermes-style auxiliary fallback lesson to quota and payment exhaustion: when a primary model returns explicit 402/payment, credit, daily quota, or quota-exhausted 429 signals and `--fallback-model` is configured, DuckHive switches to the fallback model instead of failing immediately. Generic 429 rate limits still follow the normal retry path. If no fallback is configured, DuckHive still fails closed with explicit billing/provider guidance.

The model-facing prompts now explicitly point DuckHive at its integrated team surfaces instead of leaving them as hidden commands. The normal system prompt tells the agent to use subagents for independent parallel work, prefer any native subagent/spawn surface provided by the active runtime for ordinary subagents, and reach for DuckHive `/spawn`, Agent Tool, `/council`, `/team`, and `/skills` when those tools genuinely simplify DuckHive, ACP, or team delegation. `DEFAULT_AGENT_PROMPT` carries the same native-subagent preference plus `/council` and `/spawn` guidance for spawned agents.

Codex-compatible HTTP surfaces now keep DuckHive attribution instead of leaking the upstream OpenClaude originator. Runtime doctor Codex probes, Codex Responses requests, Codex web search, Codex usage reads, and `/cache-probe` share the `duckhive` originator header while preserving Codex's own OAuth originator where the login protocol requires it.

GitHub workflow setup is DuckHive-facing while preserving compatible Claude GitHub Action runtime templates. The setup dialog, existing-workflow warning, generated PR title/body, and workflow-file commit messages now describe DuckHive PR assistant/code-review workflows; the underlying workflow filenames, Anthropic action URL, and `@claude` trigger remain unchanged for compatibility.

For installed CLI diagnostics, use `duckhive runtime-doctor` or `duckhive doctor-runtime`. `duckhive doctor:runtime` is also accepted as a compatibility alias for users copying the npm script naming style, and it runs the same terminal-safe checks without starting the REPL.

When the installed CLI is run without an attached terminal and without
`-p/--print`, DuckHive fails fast with guidance instead of waiting in a REPL that
cannot accept keyboard input. This protects PowerShell pipes, CI shells, and
Codex-style subprocess checks from looking like a frozen startup screen.

The Go TUI prompt and streaming markers use ASCII-safe `> ` and `|` indicators across the legacy and component input paths, avoiding mojibake in Windows terminals and plain log captures. Its standalone header now tracks the current DuckHive version and MiniMax M2.7 default model instead of stale OpenClaude/Claude-era labels. The Go TUI test suite now covers direct key-message updates, a Bubble Tea program loop that reads typed bytes from its input stream, and a submit diagnostic that types text then presses Enter; `duckhive tui --input-smoke "typed text"` verifies that the packaged binary receives typed bytes through the real launcher path, and `duckhive tui --submit-smoke "submitted text"` verifies the submit path clears the composer and appends the user message. Inspired by Codex's configurable terminal keymaps, the Go TUI now loads optional JSON overrides from `DUCKHIVE_TUI_KEYMAP_PATH` and `DUCKHIVE_TUI_KEYMAP`, for example `{"model":"ctrl+q","shell":"ctrl+s","undo":"ctrl+u"}`. Inline overrides win over the file, unknown actions warn and keep defaults, and the key resolver dispatches by action instead of hardcoded key strings so remapped model picker, shell mode, fast mode, external editor, undo, suspend, submit, history, confirmation, transcript, deck, search, exit, interrupt, and redraw actions still invoke the right backend behavior. `ctrl+p` opens the bridged backend `/model` selector when available and now falls back to a local model-picker panel with fast/coding/reasoning/vision route presets when offline, instead of dumping users into generic settings. Argument-bearing backend slash commands now stay command-shaped in the TUI bridge too: `/goal Build...`, `/council <question>`, `/permissions profile ...`, `/budget set ...`, `/channel status ...`, and `/computer-use tools` dispatch through the backend when bridged, while offline sessions show the matching local status card instead of sending those commands as normal chat. When `/tui` is run from the classic REPL, DuckHive now waits for the child TUI to survive a short startup window before exiting the parent REPL; if the TUI fails immediately, the classic REPL stays usable and reports that `duckhive tui` can be run directly for the full startup message.

Android and Vision terminal helpers now keep screenshot artifacts in the OS temp directory instead of Unix-only `/tmp` paths, and quote local ADB pull destinations so Windows temp paths with spaces remain valid. This applies to both the slash commands and the built-in `AndroidTool` / `VisionTool` entrypoints. The focused regressions cover screenshot output paths, escaped prompt text, tool-level screenshot paths, and no-exec rejection on unterminated quoted input.

Init, MemPalace, and Agent Soul storage now resolve their DuckHive state through the shared config-home resolver instead of raw `HOME` / `~` path construction. That keeps config writes, MemPalace storage, agent identity files, and status output aligned with `CLAUDE_CONFIG_DIR`, Windows profile paths, and DuckHive's `~/.duckhive` migration behavior; focused regressions cover config writes, quoted palace paths, missing MemPalace detection, and Agent Soul storage.

The `/statusbar session` surface now reads the same public build version used by the CLI instead of carrying a stale hardcoded `DuckHive v0.8.0` string, and the status bar regression compares against `package.json` so future release bumps fail fast when terminal version copy drifts.

Recent verification snapshot:

- `npm run typecheck`, `npm run build`, `npm run smoke`, `npm run verify:privacy`, and `node dist\cli.mjs runtime-doctor`: passing on Windows for `duckhive@0.13.7`
- `bun test src\utils\api.test.ts scripts\postbuild-patch.test.ts`: `9 pass`, `0 fail`, covering Zod schema conversion, every built-in tool schema, and fail-closed bundle patching
- `npm run smoke`: `12 pass`, `0 fail`, plus `CLI smoke passed (80 commands plus Windows wrapper checks)`
- focused 0.13.7 checks cover Zod 4 schema conversion, a real mock-provider prompt submission, Windows stdin delivery, TextInput buffering, provider-free command surfaces, provider-free voice readiness, TUI backend slash-command routing, and packaged TUI input/submit smoke
- `cd tui && go test ./...`: passing with local Go 1.25.4 from `.tmp\go-toolchain`; the packaged `tui\duckhive-tui.exe` was rebuilt from that tested source
- `duckhive --version`: `0.13.7 (DuckHive)`
- `openclaude --version`: upstream OpenClaude remains separately owned when installed
- package dry-run publishes as `duckhive@0.13.7`, includes the `duckhive` launcher, `duckhive/sdk`, `duckhive/harness`, `config/`, `tui\duckhive-tui.exe`, and the runtime `skills/newest-desktop-control/` skill files without test fixtures

Known local limitation: `duckhive tui` is an interactive terminal app, so final keyboard verification in the exact user shell still requires a real PowerShell terminal. Use `duckhive tui --snapshot` for non-interactive CI/log rendering, `duckhive tui --input-smoke "typed text"` for the packaged Bubble Tea input-loop diagnostic, `duckhive tui --submit-smoke "submitted text"` for the type-and-Enter submission diagnostic, local Go 1.25.4 with `cd tui && go test ./...` for component-level regressions, and `duckhive tui --help` for launcher diagnostics.

---

## DuckHive mmx Quick Reference

```bash
duckhive mmx image "prompt" [--aspect 1:1|16:9|9:16]  # Generate image
duckhive mmx speech synthesize --text "..." --out file.mp3  # TTS
duckhive mmx music generate --prompt "..." --out track.mp3  # Music
duckhive mmx video "prompt"  # Video generation
```

---

## License

MIT License — see [LICENSE](LICENSE) file.

---

*Forked from [Gitlawb/openclaude](https://github.com/Gitlawb/openclaude) · Powered by [MiniMax](https://www.minimax.io/) · DuckHive DNA*

---

## Known Issues & Troubleshooting

### Yolo Mode (`--yolo` flag)
DuckHive supports yolo mode both as a startup CLI flag and as an in-app toggle:
```bash
# Start with yolo mode already enabled
duckhive --yolo

# Or inside duckhive REPL, type:
/yolo on   # enable
/yolo off  # disable
/yolo      # toggle
```

### OpenClaw Integration
DuckHive includes internal OpenClaw gateway helper operations in the Crestodian diagnostics layer:
- `openclaw-status` - Check OpenClaw gateway status
- `openclaw-restart` - Restart OpenClaw gateway

These are helper operations to manage OpenClaw, not top-level DuckHive slash commands. OpenClaw and DuckHive are separate:
- `openclaw` - OpenClaw gateway/agent (standalone)
- `duckhive` - DuckHive AI coding harness

### Timer in TUI
The Go TUI (`duckhive-tui`) now shows a live session elapsed clock in the header and status rail.
The bridge-backed API-duration aggregate is still a partial metric in this surface until the bridge forwards the same duration totals the legacy REPL already tracks.

### Terminal Freezes During Heavy Tasks
The SerialBatchEventUploader has a blocking queue. During heavy tool use,
the queue fills and `enqueue()` blocks the Node.js event loop.
Workarounds: split tasks, reduce concurrent calls, use `/yolo on`.

### Building from Source
```bash
cd ~/Desktop/DuckHive-git
bun run build
# Rebuilds dist/cli.mjs from TypeScript source
```

---

## ⚠️ IMPORTANT: OpenClaw vs OpenClaude (2026-05-09)

DuckHive is based on **OpenClaude** (https://github.com/Gitlawb/openclaude), NOT OpenClaw.

| Project | URL | Role in DuckHive |
|---------|-----|------------------|
| **OpenClaude** | https://github.com/Gitlawb/openclaude | DIRECT UPSTREAM - DuckHive is forked from this |
| **OpenClaw** | https://github.com/openclaw/openclaw | SEPARATE project - DuckHive can interact with it via built-in commands |
| **DuckHive** | https://github.com/Franzferdinan51/DuckHive | Ryan's fork with MiniMax/MMX/Agent Teams |

### Built-in OpenClaw Gateway Helpers
These internal helper operations let DuckHive check/manage the **OpenClaw gateway** running separately:
- `openclaw-status` - Check OpenClaw gateway status (must be running at localhost:18789)
- `openclaw-restart` - Restart OpenClaw gateway

These are helper operations to manage OpenClaw, not DuckHive slash commands and not DuckHive's upstream.

### Common Confusion
- Type `duckhive` → starts DuckHive (based on OpenClaude)
- Type `openclaw` → starts OpenClaw gateway (separate process)

They CAN run together - DuckHive uses OpenClaw commands as helpers, but they are completely separate programs.
