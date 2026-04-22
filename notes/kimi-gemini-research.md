# Kimi CLI + Gemini CLI Research

## Kimi CLI (MoonshotAI)
- ACP protocol: JSON-RPC over WebSocket/HTTP, session handoff
- Ctrl-X shell toggle: seamless AI↔shell without leaving session
- Session export: ZIP with context.jsonl, wire.jsonl, state.json
- `/init`: analyze project → generate AGENTS.md

## Gemini CLI (Google)
- Checkpoint: Git snapshots in ~/.gemini/history/ before any file change
- Trusted Folders: interactive folder trust dialog on first run
- Hierarchical context: global ~/.gemini.md → workspace .gemini.md → JIT
- GitHub Actions: PR review, issue triage, @gemini-cli mention
