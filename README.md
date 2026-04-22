<div align="center">

![DuckHive](https://img.shields.io/badge/DuckHive-v0.6.0-gold?style=for-the-badge&logo=buymeacoffee)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=for-the-badge&logo=typescript)](package.json)
[![Bun](https://img.shields.io/badge/Bun-1.1-yellow?style=for-the-badge&logo=bun)](package.json)

**🦆 DuckHive — The Mega AI Coding Harness**

*One harness. All systems. Infinite capability.*

 duck-cli · Agent Teams · AI Council · Charm.sh · Kimi CLI · Gemini CLI · Codex · Crush

</div>

---

## What is DuckHive?

DuckHive merges the **best features from 8 AI/CLI systems** into one unified harness on OpenClaw:

```bash
git clone https://github.com/Franzferdinan51/DuckHive.git
cd DuckHive && bun install && bun run build
./bin/duckhive
```

---

## 24 Custom Tools

| Tool | Command | Source | Description |
|------|---------|--------|-------------|
| **HiveCouncilTool** | `/council` | Agent Teams | 46 AI councilors debate decisions |
| **HiveSenateTool** | `/senate` | Agent Teams | 94 senators pass binding decrees |
| **HiveTeamTool** | `/team` | Agent Teams | Spawn specialized agents |
| **DecreeTool** | `/decree` | Agent Teams | Issue & enforce binding laws |
| **OrchestrateTool** | `/orchestrate` | duck-cli | Smart routing (complexity 1-10) |
| **MultiModelRouterTool** | `/router` | Crush | Route across 9+ providers |
| **ShadowGitTool** | `/shadow` | Gemini CLI | Git snapshots before changes |
| **CheckpointTool** | `/checkpoint` | Gemini CLI | Session save/restore |
| **ContextTool** | `/context` | Gemini CLI | Hierarchical GEMINI.md loading |
| **AndroidTool** | `/android` | duck-cli | Full Android control via ADB |
| **VisionTool** | `/vision` | duck-cli | Phone screenshot + AI analysis |
| **MemoryTool** | `/memory` | duck-cli | Long-term remember/recall |
| **KAIROSTool** | `/kairos` | duck-cli | Proactive heartbeat daemon |
| **MeshTool** | `/mesh` | duck-cli | Agent mesh networking |
| **SkillTool** | `/skill` | duck-cli | Runtime skill creation |
| **TrustedFoldersTool** | `/trusted-folders` | Gemini CLI | Folder-level security |
| **ShellModeTool** | `/shell-mode` | Kimi CLI | Ctrl-X AI↔shell toggle |
| **SwapTool** | `/swap` | Kimi CLI | AI/shell mode switch |
| **MCPManageTool** | `/mcp` | Kimi CLI | MCP server management |
| **ConfirmTool** | `/confirm` | Charm.sh/Gum | Gum-style prompts |
| **StatusBarTool** | `/statusbar` | Charm.sh | Bubble Tea status bar |
| **StreamTool** | `/stream` | Charm.sh | Spinners, progress, thinking |
| **REPLPanelTool** | `/panel` | Charm.sh | Bubble Tea table/panel rendering |
| **DeskDevTool** | `/deskdev` | duck-cli | Desktop development mode |

---

## 5 Orchestrator Modules

| Module | Source | Description |
|--------|--------|-------------|
| **Hybrid Orchestrator** | duck-cli | Complexity scoring + model routing |
| **ACP Bridge** | Kimi CLI | Agent communication protocol |
| **Checkpoint Manager** | Gemini CLI | Session persistence |
| **FallbackChain** | duck-cli | Retry + provider fallback |
| **Shadow Git** | Gemini CLI | Pre-modification Git snapshots |
| **MultiModel Router** | Crush | 9+ provider intelligent routing |

---

## Sources Integrated

| Source | Top Feature |
|--------|-------------|
| **duck-cli** | Hybrid Orchestrator, KAIROS, Memory, Skill Creator |
| **Agent Teams** | Council/Senate/Team governance, decrees |
| **AI Council** | 46 councilors, adversarial deliberation |
| **Charm.sh** | Bubble Tea TUI, Gum prompts, ANSI styling |
| **Kimi CLI** | ACP protocol, shell mode, Ctrl-X |
| **Gemini CLI** | Checkpoints, trusted folders, GEMINI.md context |
| **Codex** | Via OpenClaw IDE patterns |
| **Crush** | Multi-model routing, context per project |

---

## Architecture

```
DuckHive v0.6.0 (OpenClaw 2026.4.x)
├── Hybrid Orchestrator
│   ├── TaskComplexityClassifier (1-10)
│   ├── ModelRouter (Gemma 4 Android, Kimi K2.5 vision, MiniMax M2.7 reasoning)
│   └── FallbackChain (retry → fallback → never fail)
├── Governance Layer
│   ├── AI Council (46 councilors)
│   ├── Senate (94 senators → binding decrees)
│   └── Team System (spawn agents by role)
├── ACP Bridge (kimi-cli style inter-agent protocol)
├── Shadow Git (Gemini CLI style pre-change snapshots)
├── MultiModel Router (Crush style 9+ provider routing)
└── 24 Custom Tools
```

---

## TOP 10 Features (from Agent Teams research)

1. Hybrid Orchestrator — complexity routing, skip council for simple tasks
2. ACP — inter-agent communication for mesh networking
3. Council/Senate — formal deliberation → decree → execution
4. Checkpoints — save/resume long AI tasks
5. Fallback Chain — never fail, always retry + fallback
6. Bubble Tea TUI — rich terminal rendering
7. IDE Patterns — Codex-style code editing
8. Multi-Model Routing — right model for each task
9. Crush Math/Shell — calculator + shell fusion
10. Tree-sitter — syntax parsing foundation

---

## Running

```bash
./bin/duckhive              # or
node dist/cli.mjs           # or
duckhive                    # (if ~/.local/bin is in PATH)
```

---

## Metrics

- **24 custom tools** (all registered, all build clean)
- **6 orchestrator modules** (Hybrid, ACP, Checkpoint, Fallback, Shadow Git, MultiModel)
- **8 sources** fully integrated
- **Build**: ✅ `bun run build` → `dist/cli.mjs`
- **Commits**: 15+ pushed
- **Repo**: https://github.com/Franzferdinan51/DuckHive

*Built on OpenClaw · Powered by MiniMax M2.7 · duck-cli DNA*
