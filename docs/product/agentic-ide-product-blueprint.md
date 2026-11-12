# Product blueprint: an agentic engineering environment

Status: Product requirements and architecture decisions. This document does not claim these features are implemented.

## Product definition

AliceLabs Core is a local-first, multi-agent software engineering environment with a cloud coordination plane. It must support the complete development loop:

**Understand a repository → plan a change → delegate work → inspect/edit files → run commands/tests → review diffs → verify behavior → commit/publish with approval → preserve the full execution history.**

The product is not a code editor with a chatbot sidebar, a dashboard of cards, or a wrapper around one model API. The IDE shell is the workspace for a persistent engineering runtime.

## Competitive study: what to learn, not copy

The products below are reference points for distinct product strengths. Their names are not feature requirements and their interfaces should not be copied pixel-for-pixel. Verify exact current feature availability against each vendor's documentation before implementation.

| Reference | Product pattern to study | AliceLabs design implication |
|---|---|---|
| Google Antigravity | Agent-first workspace, task orchestration and review of agent-produced artifacts | Tasks and artifacts are first-class objects; agents need a visible work queue and inspectable results |
| Claude Code | Repository-aware coding agent, terminal-centric workflows, permissions, hooks and subagents | Strong tool lifecycle, explicit permissions, task hooks and delegated agent sessions |
| OpenAI Codex | Parallel coding tasks, isolated workspaces/worktrees and reviewable changes | Every concurrent task needs isolation, status, diff, test evidence and clear handoff |
| Cline | Tool-using coding agent, explicit approvals, checkpoints and MCP extensibility | Approval lifecycle, recoverable checkpoints and a governed integration registry |
| Paseo | Desktop agent session management, connected hosts, terminal activity and floating panels | Multi-session orchestration, flexible panel layout, connected runtime visibility and session continuity |

Primary reference repositories:
- https://github.com/cline/cline
- https://github.com/getpaseo/paseo
- https://github.com/eddyflores100-lang/alicelabs-core

Other AliceLabs projects are sources of reusable capabilities, not hard-coded product content:
- OpenSAM: workflow orchestration, structured opportunity analysis and evidence-based scoring patterns.
- Orbita: media/workspace flows, project APIs and visual workspaces.
- Vigía ML: worker-based compute separation, explainability, replay and analysis presentation.
- UTA / UTA Shield: protocol adaptation, provenance, trust policy and security inspection.
All reuse must be done through documented module boundaries and license review. Do not import unrelated product UI or data into the IDE.

## Information architecture

### Global application frame

1. **Command Center** — global command palette, quick open, task creation, provider/model selector and settings.
2. **Activity / Tasks** — running, queued, waiting approval, completed and failed work across workspaces.
3. **Projects** — dynamically discovered Git providers and local workspaces. Never seed personal repositories or demo projects.
4. **Agent Sessions** — multi-agent hierarchy, session history, delegation, checkpoints and context.
5. **Integrations** — model providers, MCP servers, ACP-compatible agents, CLI tools, APIs and reviewed skills.
6. **Observability** — activity timelines, structured logs, audit, traces, metrics, usage and cost.
7. **Settings** — profiles, keybindings, themes, model routing, budgets, security, sync, retention and accessibility.

### Main IDE workspace

The primary workspace is a resizable panel system with persisted layouts:

- Left activity rail and project explorer: source tree, symbols, search, Git, tests, debug, extensions and integrations.
- Center editor: tabs, split editors, diff/merge editor, previews, breadcrumbs, diagnostics and navigation.
- Agent workspace: task prompt, plan, checklist, agent messages/summaries, tool activity, artifacts and approvals.
- Right inspector: context, selected symbol/file, agent details, model/provider, permissions and tool invocation details.
- Bottom panel: multiple terminals, problems, output, debug console, tests, ports, network and task logs.
- Status bar: branch, worktree, language/server status, diagnostics, encoding, line/column, runtime and sync state.

Every panel must be resizable, movable, hideable and restorable. Support multiple named layouts, keyboard-first operation, command palette, quick open, shortcuts, accessible focus states and high-DPI displays. Do not force all users into a fixed three-column layout.

### Task and agent views

A task is a durable object with:
- goal, acceptance criteria, project/worktree, owner and priority;
- plan and plan revisions;
- root agent and child agents;
- context sources and memory references;
- tool invocations and permission decisions;
- artifacts, changed files, tests and verification evidence;
- cost/usage, timings, checkpoints and final outcome.

Agent states must be explicit: queued, planning, running, waiting for tool, waiting for approval, validating, paused, completed, failed and cancelled. Each state transition produces a durable event.

### Source control and review

- Native local Git repository discovery and workspace selection.
- Branch and worktree creation per parallel task.
- Status, blame, history, staged/unstaged diffs and conflict resolution.
- Checkpoints before agent writes and recoverable rollback.
- Review file-by-file and hunk-by-hunk; accept/reject agent changes.
- Commit and push are explicit actions with a preview and confirmation.
- Never silently rewrite a user's branch or overwrite uncommitted changes.

### Runtime and debugging

- Real PTY-backed terminal sessions with process lifecycle and exit codes.
- Task runner for tests, builds, lint and user-defined commands.
- Debug adapter integration (DAP) and language-server integration (LSP).
- Local preview servers, port detection and browser preview.
- Process list, CPU/memory, logs, diagnostics and cancellation.
- Browser automation is a permissioned tool, not a simulated screenshot panel.

## Core agent workflow

1. User opens a local project or selects a repository from their own connected Git provider.
2. Workspace engine inspects repository metadata, project instructions and permitted context.
3. User defines goal and acceptance criteria.
4. Planner produces a reviewable plan and estimates required capabilities/budget.
5. Runtime chooses a configured agent profile and model policy.
6. Orchestrator creates an isolated worktree and assigns bounded subtasks.
7. Tool requests pass through policy evaluation and user approval when required.
8. Agent edits files and runs tests through supervised local processes.
9. Verification checks diffs, tests, lint, build and stated acceptance criteria.
10. User reviews the final diff and evidence, then explicitly commits/pushes/opens a PR.
11. Task timeline, logs, audit and artifacts remain searchable and exportable.

No panel should imply an agent ran, a command executed, a test passed or a file changed unless the runtime produced corresponding evidence.

## Agent runtime and protocol architecture

- A provider-neutral model contract supports streaming, cancellation, usage, errors and capability metadata.
- Agent runtime owns the state machine, context assembly, tool requests and result interpretation.
- Orchestrator owns DAGs, bounded concurrency, dependencies, retries, checkpoints and recovery.
- Universal Bridge is the only path for external tools. It supports MCP transports, ACP agent sessions, local CLI adapters and scoped HTTP/API integrations.
- Workspace service provides project roots, Git worktrees, file operations and search.
- Policy engine authorizes each invocation at execution time using user, workspace, agent, integration and action scopes.
- Storage repositories abstract SQLite/local artifacts and optional cloud metadata/sync.
- UI consumes typed events and commands; it does not own process execution or secrets.

## Model gateway and intelligence

- Provider registry: Anthropic, OpenAI, Google, OpenRouter and OpenAI-compatible endpoints, with local model adapters as a later provider.
- Model catalog records capabilities, context limits, modalities, tool support, pricing provenance and availability.
- Routing policy supports manual, recommended and automatic selection.
- Filter candidates by required capabilities before scoring; never choose a model that cannot satisfy the task.
- Routing considers quality, cost, latency, context, reliability, user preferences and budget.
- Show the reason for a routing decision and allow the user to override it.
- Fallbacks must preserve tool-call semantics and disclose model changes.
- Secrets stay in the OS credential vault; SQLite stores opaque credential references only.

## Memory and project knowledge

Memory is separated into:
- project instructions and repository facts;
- task/session history and artifacts;
- user-approved durable preferences;
- ephemeral working notes and scratch space;
- retrieval index with source provenance and deletion/retention policy.

Never mix private context across projects or tenants. Every retrieved memory item carries provenance and scope. Users can inspect, correct, export and delete stored project context.

## Cloudflare deployment architecture

The cloud plane is optional for a fully local single-user experience and is not the place where desktop code execution occurs.

| Service | Responsibility |
|---|---|
| Workers | API gateway, auth, tenancy, provider metadata, event ingestion and static web control plane |
| Durable Objects | Live task/session coordination, ordered event fan-out and WebSocket presence |
| D1 | Account, installation, workspace metadata, event indexes, policy and usage aggregates |
| R2 | Encrypted archives and optional large artifacts with lifecycle rules |
| Queues | Asynchronous ingestion, indexing, aggregation, retry and dead-letter processing |
| Workflows | Long-running cloud-side processes requiring durable retries and approval checkpoints |
| Workers Logs / Analytics Engine | Infrastructure observability and aggregate metrics |
| AI Gateway | Optional provider traffic observability, rate limits, caching and fallback where applicable |

Desktop-to-cloud sync is opt-in and authenticated. The local daemon remains responsible for local files, terminal processes and local Git. Remote execution requires an explicit paired host and scoped authorization.

## Security and trust model

- Default-deny tool execution and project-scoped filesystem grants.
- Per-tool and per-agent permissions; approval for destructive or externally visible actions.
- MCP server and skill trust states: unreviewed, approved, blocked.
- Skills are inert content until reviewed; no automatic installation scripts.
- Prompt injection is treated as untrusted data, never as authority.
- Child processes have explicit cwd, environment allowlists, timeouts, output caps and cancellation.
- Audit records cover all permission decisions and external side effects.
- Provider credentials never enter model prompts, logs or source files.
- Cloud services use least-privilege bindings and tenant isolation.
- The local daemon binds loopback only and authenticates non-health endpoints.

## Performance and reliability

- Keep the editor responsive during indexing, model streaming and terminal output.
- Run repository indexing, embeddings, log parsing and large file operations off the UI thread.
- Use incremental file watching, cancellation tokens and bounded worker pools.
- Virtualize large trees, logs, diffs and session histories.
- Batch terminal output and UI events; apply backpressure.
- Recover sessions after app restart and replay durable events by cursor.
- Provide health, diagnostics and resource usage for daemon and child processes.
- Test large repositories, many tabs, concurrent agents, long terminal streams and reconnects.

## Delivery gates

### Gate A — Honest desktop foundation
- Real local workspace, file explorer, editor, file save, Git status/diff.
- Real terminal with PTY, multiple sessions, process cancellation and exit codes.
- Structured local event store, activity timeline and searchable logs.
- No simulated agent or fake process states.

### Gate B — Single-agent engineering loop
- At least one real provider adapter with streaming and cancellation.
- Task/session state machine, permissioned tool calls, file edits and test execution.
- Checkpoint, diff review and explicit commit flow.
- Logs correlate prompt/task → model → tool → process → file diff → verification.

### Gate C — Multi-agent and integrations
- Isolated worktrees, child agents, bounded parallelism and recovery.
- MCP, ACP and CLI integration registry with policy and audit.
- Provider routing, budgets, usage and error observability.

### Gate D — Cloud and collaboration
- Cloudflare Workers API, Durable Object live sessions, D1 metadata and R2 archives.
- Secure opt-in sync, reconnect/replay, deployment diagnostics and account controls.

### Gate E — Universal release
- Windows, macOS and Linux packaging, updates, crash reporting opt-in, migration and signing.
- MIT license and third-party license inventory.
- CI, unit/integration/e2e tests, security checks, performance benchmarks and reproducible releases.

## Definition of done

A feature is complete only when it has:
1. A real backend/runtime implementation.
2. Typed protocol and durable state where required.
3. Permission and error handling.
4. Structured logs and trace correlation.
5. Automated tests and a reproducible verification result.
6. UI that exposes real state, not placeholder success.
7. Documentation of limitations, data flow and security impact.

The visual shell is not the acceptance criterion. The complete engineering loop is.
