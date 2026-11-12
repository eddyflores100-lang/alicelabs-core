# Implementation plan

## Milestone 0 — Foundation
- Workspace manifests, CI, formatting and linting.
- Tauri shell and React application.
- Rust domain/protocol/storage/daemon crates.
- Versioned JSON schemas and ADR process.
- Health endpoint and UI shell.

## Milestone 1 — Workspace IDE
- Project registry and project switching.
- File explorer, Monaco, tabs and split editor.
- PTY-backed terminal.
- Git status/diff/branch operations.
- Window/session persistence.

## Milestone 2 — Provider connectivity
- Provider trait and streaming event contract.
- Anthropic, OpenAI, Google and OpenRouter adapters.
- Model catalog and capability registry.
- OS credential vault integration.
- Usage and error telemetry.

## Milestone 3 — Hybrid routing
- Task classifier and complexity estimate.
- Capability filtering before scoring.
- Manual/recommended/automatic policies.
- Budget enforcement and approval.
- Provider fallback and evaluation harness.

## Milestone 4 — Agents and orchestration
- Agent profiles, sessions and task state machine.
- Tool-call request/approval lifecycle.
- DAG orchestration and bounded parallelism.
- Git worktree isolation.
- Recovery and cancellation.

## Milestone 5 — Universal Bridge
- MCP stdio and HTTP transports.
- Tool registry, project grants and audit.
- REST/GraphQL and CLI adapters.
- ACP client integration.
- Skill registry and static review pipeline.

## Milestone 6 — Productization
- Memory, workflow builder, marketplace and analytics.
- Windows/macOS/Linux packaging and signing.
- E2E, security and performance testing.
- Upgrade, migration and recovery strategy.
