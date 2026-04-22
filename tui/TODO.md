# DuckHive Harness Todo

Last updated: 2026-04-22

This file started with the Go TUI work, but it now tracks harness-wide integration requirements as well.

## In Progress

- Fix TUI-first startup so `duckhive` does not appear blank or stuck when the PTY helper is active.
- Shift imported feature work from TUI-only surfaces into shared harness layers first.
- Add richer model-routing controls and a dedicated model picker surface backed by shared provider state.
- Add deeper OpenClaw and mercury-agent capabilities: voice, daemon/channel controls, budgets, and approvals across the harness.

## Next

- Move checkpoint, council, media, MCP, ACP, permission, and budget state into shared harness services that every client can consume.
- Surface imported feature pillars from Codex, Gemini CLI, Kimi CLI, OpenClaw, duck-cli, MiniMax Agent CLI, and mercury-agent in the right rail and welcome screen.
- Add a session/status layer for checkpoints, permissions, budgets, model routing, MCP, ACP, and bridge health that works in TUI, REPL, and automation.
- Add a Kimi-style shell mode with real command execution and output capture, shared between the TUI and other shell-facing flows.
- Make the transcript panel usable as a persistent rail instead of a modal-like dump.

## Later

- Build a real model picker with fast/coding/reasoning/vision presets and provider details.
- Add checkpoint browsing and resume flows across TUI, slash commands, and print mode.
- Add multi-agent and council execution views with task state plus shared orchestration APIs.
- Add media workflow panels for image, video, speech, music, and search jobs on top of shared media job primitives.
- Add voice, daemon, and channel controls inspired by OpenClaw and mercury-agent.
- Add Kanban-backed progress counters and richer task tracking in the rail.

## Done

- Stabilized the Bubble Tea root model so window sizing, input submission, and backend bridge events work.
- Replaced the old stacked REPL with a capability-first shell layout.
- Added explicit composer modes for agent, shell, council, and media workflows.
- Added additive repo-local tracking files for the TUI scope.
