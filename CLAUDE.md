# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Build (produces dist/cli.mjs, dist/sdk.mjs, dist/harness.mjs)
npm run build

# Run all tests (3400+ tests, ~40s)
npx bun test

# Run a single test file
npx bun test src/commands/goal/goal.test.ts

# Run tests matching a pattern
npx bun test --test-name-pattern "SQLite"

# TypeScript check (no emit)
npx tsc --noEmit

# Install globally after building
npm install -g .
```

## Architecture

DuckHive is a fork of OpenClaude (Claude Code CLI) extended with multi-agent coordination (Hive commands), MiniMax AI Platform integration, and a buddy system. Built with Bun + TypeScript + React/Ink for the terminal UI.

### Entry Points

- `src/main.tsx` — CLI entry point, command dispatch, REPL setup
- `src/entrypoints/sdk.ts` — SDK bundle for programmatic use
- `src/entrypoints/harness.ts` — Agent harness bundle

### Core Pipeline

**User input → query loop → API → tool execution → response**

1. `src/screens/REPL.tsx` — Main REPL screen, handles input/output, manages conversation state
2. `src/utils/handlePromptSubmit.ts` — Processes user input, handles slash commands, queues work
3. `src/query.ts` — The main query loop. Sends messages to the API, processes tool calls, handles auto-compact, continuation nudges, and tool failure loops
4. `src/services/api/client.ts` — API client with provider routing, retry logic, error classification
5. `src/services/api/openaiShim.ts` — Translates between OpenAI-compatible providers and the internal message format

### Command System

Commands live in `src/commands/<name>/`. Each has an `index.ts` with a lazy-loaded `load()` function. Registration is in `src/commands.ts`. Commands return strings (displayed to user) or objects with `message`/`attachments`.

Key commands:
- `goal` — Autonomous goal mode (Codex-style). Multi-word `/goal "do X"` creates and starts pursuing
- `hive-council`, `hive-team`, `hive-senate` — Multi-agent coordination
- `mmx` — MiniMax AI Platform (text, image, speech, music, video)
- `provider` — Provider management (OpenAI, Gemini, DeepSeek, Ollama, etc.)

### Tool System

Tools live in `src/tools/<ToolName>/`. Each tool implements `ToolDefinition` with `call()`, `renderToolUseMessage()`, and `renderToolResultMessage()`. Tools are registered in `src/tools/index.ts`.

### MCP (Model Context Protocol)

`src/services/mcp/client.ts` — MCP client with connection management, tool exposure, and reconnection logic. MCP servers are configured via `.mcp.json` or plugin manifests.

### Plugin System

`src/plugins/` — Plugin loading, manifest parsing, skill/hook/MCP integration. Plugins are discovered from `~/.openclaude/plugins/` and can provide commands, tools, skills, hooks, and MCP servers.

### State Management

- `src/state/AppStateStore.ts` — Global app state (Zustand-based)
- `src/bootstrap/state.ts` — Session state (session ID, cost tracking, timing)
- `src/utils/globalConfig.ts` — User config (`.openclaude.json`)

### Bridge (Remote/IDE)

`src/bridge/` — Connects local REPL to remote sessions (CCR) or IDE extensions. Uses SSE transports with reconnection and 401 recovery.

### Context & Compaction

- `src/context.ts` — Builds system prompt (git status, repo map, goal context)
- `src/services/compact/` — Auto-compact and reactive compact for context window management
- `src/services/contextCollapse/` — Context collapse for mid-turn overflow

## Key Patterns

### Feature Flags

`scripts/build.ts` defines feature flags (`CONTEXT_COLLAPSE`, `REACTIVE_COMPACT`, etc.) that gate code at build time. Check `feature('FLAG_NAME')` in source.

### Provider System

Providers are configured in `.openclaude.json` under `providers`. The `src/providers/customProviders.ts` handles custom OpenAI-compatible endpoints. Provider routing happens in `src/services/api/client.ts`.

### Error Classification

`src/services/api/openaiErrorClassification.ts` classifies API errors (auth, rate limit, overloaded, context window) and determines retry behavior.

### Testing

Tests use Bun's built-in test runner. Mock with `mock.module()` for ESM modules. SQLite tests need 30s timeouts (`it('...', async () => { ... }, 30_000)`). Parallel test results may need sorting before assertion.

## GitNexus

This project is indexed by GitNexus (72586 symbols, 142203 relationships). Use for architecture questions and risky refactors, not routine edits.

| Task | Tool |
|------|------|
| Find code by concept | `gitnexus_query` |
| Blast radius | `gitnexus_impact` |
| Detect changes | `gitnexus_detect_changes` |
