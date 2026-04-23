# DuckHive Harness Feature Matrix

Last updated: 2026-04-23

This matrix tracks the harness capabilities we want to absorb from the upstream CLI products the project is drawing from. It is intentionally additive: DuckHive remains based on OpenClaude, and imported features should land in the shared core first, then fan out across the Go TUI, the legacy REPL, print/headless mode, and backend services.

## Upstream Baseline

| Source | Key traits to absorb | Shared harness status | Surface status |
| --- | --- | --- | --- |
| OpenClaude | base harness, session flow, tool runtime, REPL/print foundations | active base platform | keep core compatibility while replacing user-facing shell and provider ergonomics |
| Crush | dense terminal shell, layout confidence, keyboard-first navigation, polished rails | Go TUI foundation exists | default shell still needs a stronger Crush-like command deck and panel model |
| Codex | local coding loop, repo instructions, desktop/editor surface | AGENTS-based onboarding already exists; codex provider support exists in repo | needs shared session/task UX across TUI, REPL, print, and editor-adjacent flows |
| Gemini CLI | checkpointing, context files, scripting/headless posture, trusted workspace feel | checkpoint manager exists; session recovery exists | needs checkpoint/session features across TUI, slash commands, and automation paths |
| Kimi CLI | shell mode, ACP bridge, MCP management, IDE adjacency | ACP bridge exists; MCP stack exists | shell mode and ACP need shared harness semantics, not just TUI bindings |
| OpenClaw | multi-agent routing, voice, channel surfaces, live workspace concepts | voice + ACP/MCP + remote/channel foundations exist | orchestrator and voice/channel features should land in shared core, then fan out to all clients |
| hermes-agent | agent loop discipline, autonomous planning/execution handoff, research-oriented agent posture | orchestration heuristics exist; council/team paths exist | needs stronger autonomous worker orchestration and better long-task execution flow |
| NemoClaw | NVIDIA-backed agent/runtime patterns, GPU/provider-aware flows, multimodal system posture | NVIDIA NIM routing exists; multimodal surfaces partially exist | needs deeper NVIDIA-aware model/runtime UX and better multimodal execution flows |
| duck-cli | AI council, mesh networking, proactive orchestration, Android/phone workflows | hybrid router, council heuristics, android/vision routing exist | council/orchestration should be reusable from TUI, REPL, commands, and background workflows |
| MiniMax Agent CLI | text/image/video/speech/music/search/vision workflows | MiniMax routing exists; multimodal provider support exists in repo | media jobs should become first-class harness workflows, then gain UI surfaces |
| mercury-agent | permission hardening, budgets, daemon posture, soul/persona files, multi-channel access | permission flows, analytics budgets, channel/daemon concepts partially exist | budget/approval/daemon work should be shared infra with multiple frontends |

## Current Build Order

1. Stabilize the harness baseline: provider auth, council/team reachability, slash-command viability, and TUI startup behavior.
2. Convert upstream repos into shared workstreams: shell UX, provider UX, orchestration, multimodal jobs, voice/channels, and desktop/runtime integration.
3. Expose those workstreams through the default `duckhive` command, Go TUI, REPL, and print/headless paths instead of building TUI-only features.
4. Keep the TUI as a strong primary shell, but not the only place where imported capabilities exist.
5. Layer in deeper workflows: checkpoints, model routing, orchestration, media jobs, voice, channels, approvals, budgets, and desktop surfaces.
