# Architecture overview

Core is a local-first modular desktop application.

## Process model
1. Tauri desktop shell owns windows and native OS integration.
2. Core Daemon owns durable sessions, task orchestration and tool authorization.
3. Provider adapters translate the internal model contract to vendor APIs.
4. Agent runtime manages task state and delegates work.
5. Universal Bridge brokers all external tool invocations.
6. Storage owns persistence behind repository interfaces.

## Critical boundaries
- UI never stores provider secrets.
- Models never receive raw credentials.
- Providers cannot invoke tools directly; they request tool calls through the agent runtime.
- Tool calls are authorized at execution time, scoped to project and agent.
- Project context is partitioned by project ID.
- External CLI agents run as supervised child processes with explicit working directories and permissions.

## Deployment
Desktop + local daemon are the default. Optional remote control is a later feature and must be disabled by default until authenticated transport, device pairing and authorization are implemented.
