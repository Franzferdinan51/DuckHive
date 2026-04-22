# DuckHive

**The all-in-one AI coding agent harness — built from duck-cli, Agent Teams, AI Council, and OpenClaude.**

DuckHive is a next-generation coding-agent CLI that fuses the best ideas from duck-cli, Agent Teams (Hive Nation), OpenClaude, Crush, Kimi CLI, Gemini CLI, and Codex into a single cohesive harness. It runs natively as a CLI with full terminal-first workflows, integrates deeply with Android phone control, governance, multi-agent orchestration, and ships with a premium built-in dashboard.

[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb.svg)](LICENSE)
[![OpenClaude-based](https://img.shields.io/badge/base-OpenClaude%20v0.5.2-7c3aed.svg)](https://github.com/openclaw/openclaw)

[Why DuckHive](#why-duckhive) · [Quick Start](#quick-start) · [Core Features](#core-features) · [Built-in Tools](#built-in-tools) · [Governance](#governance-hive-nation) · [Providers](#providers) · [Architecture](#architecture) · [Source Build](#source-build)

---

## Why DuckHive

DuckHive starts from OpenClaude's solid CLI foundation — 200+ LLM providers, streaming, MCP, agents, tasks — and layers on everything from your other systems:

| Feature | Source |
|---------|--------|
| Android phone control via ADB | duck-cli |
| AI Council deliberation (46 councilors) | Agent Teams / Hive Nation |
| Senate governance (94 senators, binding decrees) | Agent Teams / Hive Nation |
| Team spawning (8 templates: research, code, swarm...) | Agent Teams |
| Conversation checkpointing | Gemini CLI |
| Trusted folder execution policies | Gemini CLI |
| MCP server management | Crush / Kimi CLI |
| Shell agent mode (Ctrl-X AI↔shell toggle) | Kimi CLI |
| Desktop development tools (screenshot, click, type) | duck-cli |
| 200+ model providers (MiniMax, Kimi, OpenRouter, Ollama...) | OpenClaude |
| VS Code extension | OpenClaude |
| Headless gRPC server | OpenClaude |

**One CLI. Every capability. No switching between tools.**

---

## Quick Start

### Install

```bash
git clone https://github.com/Franzferdinan51/openclaude.git
cd openclaude
npm install   # or: bun install
npm run build # or: bun run build
```

### Run

```bash
node dist/cli.mjs
```

Or symlink for global access:

```bash
ln -s "$(pwd)/dist/cli.mjs" ~/.local/bin/duckhive
duckhive
```

### First-Time Setup

Inside DuckHive:

```
/provider              # Guided provider setup (MiniMax, Kimi, OpenRouter, Ollama, Gemini, Codex...)
/onboard-github       # GitHub Models OAuth onboarding
```

### Fastest Local Setup (Ollama)

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=qwen2.5-coder:7b
node dist/cli.mjs
```

---

## Core Features

### 🦆 Android Phone Control

Full Android device control via ADB — no separate tool needed.

```
/android screenshot                    # Screencap, pull to /tmp
/android tap 540 960                   # Tap at coordinates
/android swipe up                      # Swipe gestures
/android type "hello world"           # Input text
/android launch com.app.example        # Launch app
/android battery                      # Battery status
/android shell "ls /sdcard"           # Run shell command
```

Works with any ADB-connected Android device. Default target: `192.168.1.251:40835` (Moto G Play 2026).

### 🏛️ Governance (Hive Nation)

Integrated 46-councilor deliberation + 94-senator governance system.

```
/hive_council deliberate "Should we refactor the auth module?"
/hive_senate list                        # View active decrees
/hive_senate issue --title "Security Fix" --content "Patch CVE-2026..."
/hive_team spawn --name "security-audit" --template security
```

**8 Team Templates:** `research`, `code`, `security`, `emergency`, `planning`, `analysis`, `devops`, `swarm`

**9 Deliberation Modes:** `balanced`, `adversarial`, `consensus`, `brainstorm`, `swarm`, `devil-advocate`, `legislature`, `prediction`, `inspector`

### 💾 Checkpointing

Conversation checkpointing — save and restore session state (inspired by Gemini CLI).

```
/checkpoint save --name "auth-refactor" --note "Mid-way through token rewrite"
/checkpoint list        # View all checkpoints
/checkpoint load --id auth-refactor
/checkpoint auto        # Auto-save during long tasks
```

Checkpoints saved to `~/.config/openclaude/checkpoints/` by default.

### 🔒 Trusted Folders

Execution policies that restrict file operations to approved paths only (inspired by Gemini CLI).

```
/trusted_folders list
/trusted_folders add /workspace/myproject
/trusted_folders check /workspace/myproject/src
/trusted_folders enable
/trusted_folders disable
```

Enforces safe execution boundaries for untrusted code or shared environments.

### 🖥️ Desktop Development Tools

macOS desktop automation — screenshot, click, type, open apps.

```
/desktop_dev screenshot           # Full screen capture → base64
/desktop_dev click 540 960        # Click at coordinates
/desktop_dev type "hello"         # Type text
/desktop_dev open "Safari"        # Launch app by name
/desktop_dev front "Xcode"         # Bring app to front
/desktop_dev windows               # List open windows
```

### 🐚 Shell Mode

Toggle between AI-assisted mode and direct shell execution with Ctrl-X (inspired by Kimi CLI).

```
/shell_mode switch --mode shell   # Direct shell — type commands directly
/shell_mode switch --mode ai      # Back to AI assistance
/shell_mode status               # Show current mode
```

### 🔌 MCP Server Management

Manage MCP (Model Context Protocol) servers — add, remove, list, health-check.

```
/mcp_manage list                  # Show all configured servers
/mcp_manage add --name filesystem --transport stdio --url "npx..."
/mcp_manage remove --name old-server
/mcp_manage health                # Check server health
/mcp_manage reload               # Flag servers for reload on restart
```

---

## Built-in Tools

| Tool | Name | Description |
|------|------|-------------|
| 🦆 Android | `/android` | Full Android device control via ADB |
| 🏛️ Hive Council | `/hive_council` | 46-councilor AI deliberation |
| 🏛️ Hive Senate | `/hive_senate` | Binding decree governance |
| 🤖 Hive Team | `/hive_team` | Spawn multi-agent teams |
| 💾 Checkpoint | `/checkpoint` | Session save/restore |
| 🔒 Trusted Folders | `/trusted_folders` | Execution path policies |
| 🖥️ Desktop Dev | `/desktop_dev` | macOS automation |
| 🐚 Shell Mode | `/shell_mode` | AI↔shell toggle |
| 🔌 MCP Manage | `/mcp_manage` | MCP server lifecycle |

Plus all OpenClaude built-in tools: bash, file read/write/edit, grep, glob, agents, tasks, MCP, web search, web fetch, and more.

---

## Providers

DuckHive supports 200+ models through OpenClaude's multi-provider stack:

| Provider | Setup | Notes |
|----------|-------|-------|
| **MiniMax** (primary) | `/provider` or env | Generous quota, M2.7 reasoning model |
| **Kimi/Moonshot** | `/provider` or env | Top-tier vision + coding |
| **OpenAI** | `/provider` or env | GPT-4o, o3, o4 family |
| **OpenRouter** | `/provider` or env | 28+ free tier models |
| **Gemini** | `/provider` or env | Google AI models |
| **GitHub Models** | `/onboard-github` | OAuth, no API key needed |
| **Codex OAuth** | `/provider` | ChatGPT subscription tier |
| **Ollama** | `ollama launch` or env | Local inference, free |
| **LM Studio** | env vars | Local GPU inference |
| **Atomic Chat** | `/provider` or env | Local model provider |

---

## Architecture

```
DuckHive
├── OpenClaude Core (CLI, streaming, tools, MCP)
├── 9 Native Tools
│   ├── AndroidTool       — ADB phone control
│   ├── HiveCouncilTool  — AI Council deliberation
│   ├── HiveSenateTool   — Senate decree system
│   ├── HiveTeamTool     — Team spawning
│   ├── CheckpointTool   — Session checkpointing
│   ├── TrustedFoldersTool — Execution policies
│   ├── DeskDevTool      — macOS automation
│   ├── ShellModeTool    — AI/shell toggle
│   └── MCPManageTool    — MCP server management
├── Hive Nation Bridge   — Connects to localhost:3131
├── Provider Stack       — 200+ models via OpenAI-compatible APIs
└── VS Code Extension    — Launch integration + theme
```

**Hive Nation Services** (run separately):

```bash
# Start Hive Nation API (port 3131)
cd ~/Desktop/AgentTeam-GitHub
node council-api-server.cjs
```

---

## Source Build

```bash
bun install
bun run build
node dist/cli.mjs
```

Development:

```bash
bun run dev           # Watch mode development
bun test              # Run test suite
bun run smoke         # Smoke tests
bun run doctor:runtime # Diagnose runtime issues
```

---

## DuckHive vs. Other Systems

| Feature | DuckHive | duck-cli | Agent Teams | Gemini CLI | Kimi CLI |
|---------|----------|----------|-------------|------------|----------|
| Multi-provider (200+) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Android phone control | ✅ | ✅ | ❌ | ❌ | ❌ |
| AI Council (46 councilors) | ✅ | ❌ | ✅ | ❌ | ❌ |
| Senate governance | ✅ | ❌ | ✅ | ❌ | ❌ |
| Team spawning | ✅ | ✅ | ✅ | ❌ | ❌ |
| Checkpointing | ✅ | ❌ | ❌ | ✅ | ❌ |
| Trusted folders | ✅ | ❌ | ❌ | ✅ | ❌ |
| MCP management | ✅ | ✅ | ❌ | ✅ | ✅ |
| Shell mode | ✅ | ❌ | ❌ | ❌ | ✅ |
| Desktop automation | ✅ | ✅ | ❌ | ❌ | ❌ |
| VS Code extension | ✅ | ❌ | ❌ | ❌ | ✅ |
| gRPC server | ✅ | ❌ | ❌ | ❌ | ❌ |
| Free local inference | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## Credit & Sources

DuckHive stands on the shoulders of giants:

- **[OpenClaude](https://github.com/openclaw/openclaw)** — Base CLI harness (MIT)
- **[duck-cli](https://github.com/Franzferdinan51/duck-cli)** — Phone control, AI Council, agent mesh (MIT)
- **[Agent Teams / Hive Nation](https://github.com/Franzferdinan51/Agent-Teams)** — Governance, Senate, team orchestration (MIT)
- **[Crush](https://github.com/grantcull/ Crush)** — Glamourous CLI patterns, MCP support
- **[Kimi CLI](https://github.com/MoonshotAI/kimi-switch)** — Shell agent mode inspiration
- **[Gemini CLI](https://github.com/google-gemini)** — Checkpointing, trusted folders inspiration
- **[Fantasy](https://charm.land/fantasy)** — Go agent library patterns (Apache-2.0)

---

## Disclaimer

DuckHive is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic, MiniMax, Moonshot AI, or any other provider.

"Claude" and "Claude Code" are trademarks of Anthropic PBC. See [LICENSE](LICENSE) for details.

## License

MIT License. See [LICENSE](LICENSE).
