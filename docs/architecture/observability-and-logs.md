# Observability, event logs, and execution history

Status: Proposed product requirement — not implemented yet.

Observability is a first-class Core subsystem. It is not a decorative console and it is not an optional developer-only feature. Every user-visible agent, model, tool, terminal, workspace, and remote service action must produce correlated operational events.

## 1. Four distinct data planes

Do not collapse all records into one generic log table.

1. **Activity timeline** — human-readable, chronological explanation of what happened in a task: plan created, agent started, tool requested, approval requested, command executed, files changed, tests run, result verified.
2. **Diagnostic logs** — detailed application and process records for debugging: structured daemon logs, provider transport errors, terminal stdout/stderr, browser console/network errors, Worker exceptions, retries and timings.
3. **Security audit trail** — append-only records of authorization decisions and external side effects: permission grants, denied calls, credential access by reference, file writes/deletes, shell commands, Git mutations, network access, deployments and exports.
4. **Metrics and traces** — performance and reliability signals: model latency, token usage, estimated/actual cost, tool duration, queue wait, process exit codes, event-loop delay, stream lag, retries and error rates.

These planes may share correlation identifiers, but they have different access controls, retention, redaction and export policies.

## 2. Canonical event envelope

All local daemon and remote service events use a versioned, provider-neutral envelope:

| Field | Purpose |
|---|---|
| schema_version | Forward-compatible event schema |
| event_id | Unique immutable event ID |
| occurred_at | UTC wall-clock timestamp |
| monotonic_ns | Local monotonic time for reliable duration ordering |
| level | trace, debug, info, warn, error, fatal |
| category / name | e.g. agent.tool.started, terminal.stderr, provider.request.failed |
| trace_id / span_id / parent_span_id | End-to-end distributed correlation |
| installation_id | Pseudonymous local installation identifier |
| workspace_id / project_id | Scope the event to a workspace |
| task_id / session_id | Task and agent session correlation |
| agent_id / parent_agent_id | Multi-agent hierarchy |
| provider_id / model_id | Model provenance, when relevant |
| tool_id / invocation_id | Tool execution correlation |
| process_id / terminal_id | Child process and terminal correlation |
| status / duration_ms | Outcome and elapsed time |
| usage | Input/output/cache tokens and provider-reported usage |
| cost | Currency, estimate/actual, calculation source |
| payload | Typed event-specific metadata, never arbitrary secret-bearing objects |

IDs are stable within their intended scope. A child agent inherits trace context but receives its own session and span identifiers. Events must be idempotently ingestible.

## 3. Required event coverage

### Agent lifecycle
- task accepted, plan generated/revised, task queued, started, paused, resumed, cancelled, completed, failed;
- agent spawned, delegated, waiting, yielded, recovered, timed out;
- context assembled/compacted, memory retrieved/written, budget threshold reached;
- verification plan, verification result and evidence references.

### Tool and permission lifecycle
- tool discovered, validated, enabled/disabled;
- invocation requested, policy evaluated, approval requested/granted/denied/expired;
- execution started, streamed output, completed, failed, cancelled;
- normalized arguments and results with secrets and sensitive values redacted;
- timeout, retry, rate-limit and sandbox events.

### Workspace and Git
- workspace opened/closed, clone/fetch, branch/worktree created/removed;
- file read/write/delete/rename with path and content hash, not source contents by default;
- diff generated, hunk accepted/rejected, staging, commit, push, pull request;
- test/lint/build task and exact exit status.

### Terminal and browser
- PTY created/attached/detached/resized/exited;
- stdout/stderr chunks and process metadata, with bounded buffers and explicit persistence controls;
- browser navigation, action, screenshot reference, console error, failed request and performance timing;
- local preview server started/stopped and health transitions.

### Model gateway
- provider/model selection and routing explanation;
- request start/end, time to first token, total latency, retries/fallbacks;
- token usage, cache usage, cost estimate and provider-reported cost where available;
- cancellation, timeout, HTTP status and sanitized error details.

### Cloud services
- Worker request and deployment IDs, route, status, duration and region/colo metadata where available;
- Durable Object session lifecycle and WebSocket disconnect/reconnect;
- queue enqueue/dequeue/retry/dead-letter;
- D1 operation timing and error class;
- remote task handoff, sync acknowledgement and conflict resolution.

## 4. Logging safety rules

- Never log API keys, OAuth access/refresh tokens, cookies, authorization headers, private keys or raw credential-vault values.
- Never place secrets in trace attributes, exception messages, terminal environment dumps or model metadata.
- Source code, prompt bodies, full model responses, terminal output and browser page content are sensitive payloads. Their capture must be separately configurable and off by default for remote telemetry.
- Redact before persistence and before transmission, not only in the UI.
- Keep a local-only mode. Cloud synchronization is opt-in, clearly explained, revocable and scoped by workspace.
- Do not log hidden model reasoning or claim that internal chain-of-thought is available. Record observable actions, tool calls, decisions, summaries and verification evidence.
- Security audit records must be append-only from normal application flows; privileged retention/deletion operations must themselves be audited.
- Every remote log upload must use authenticated, installation-bound transport and least-privilege authorization.

## 5. Storage and transport

### Local-first
- SQLite in WAL mode is the durable index for task events, audit metadata, provider usage and event references.
- Large terminal captures, browser recordings, screenshots and optional payload attachments are stored as separate files under a managed application data directory, addressed by content hash.
- Use bounded in-memory ring buffers for live terminal output. Persist terminal output only according to workspace policy and user settings.
- Define schema migrations, retention quotas, compaction, export and recovery before enabling background capture.
- Index by occurred_at, workspace_id, task_id, session_id, category, level and trace_id.

### Cloudflare control plane
- **Workers**: authenticated API, tenancy boundaries, event ingestion, query APIs and static web control surface.
- **Durable Objects**: one coordination actor per active remote task/session for ordered live event fan-out, WebSocket presence and session state. Do not use them as the only long-term event archive.
- **D1**: account, installation, workspace metadata, event indexes, retention policies and billing/usage aggregates.
- **R2**: optional encrypted event archives and large attachments, with lifecycle/retention rules.
- **Queues**: asynchronous ingestion, normalization, redaction verification, aggregation and archive jobs; retry and dead-letter handling.
- **Workers Analytics Engine / Workers Logs**: service-level operational metrics and infrastructure diagnostics, not a substitute for the product's per-task event store.
- **AI Gateway**: provider request observability, latency and usage controls where compatible; prompt/response capture remains disabled unless explicitly enabled.

Desktop execution stays local. Cloudflare coordinates optional remote services and sync; it does not pretend to host arbitrary local terminals or grant a Worker direct access to a user's filesystem.

## 6. User experience

The IDE must expose observability in several linked views:

- **Global Activity**: all running, waiting, completed and failed tasks across projects.
- **Task Timeline**: chronological event stream with expandable steps, agent handoffs, artifacts, approvals and verification evidence.
- **Live Logs**: follow/pause, severity/category filters, search, copy and export; stdout/stderr visually distinct.
- **Tool Inspector**: tool name, server/provider, permission decision, sanitized arguments, duration, output summary and error details.
- **Agent Inspector**: model/provider, context and usage, parent/child agents, lifecycle, current action and cancellation.
- **Terminal Manager**: multiple PTYs, named sessions, process status, exit codes and per-terminal output.
- **Git/Changes**: changed files, staged/unstaged diffs, hunk review, checkpoints, worktree and commit history.
- **Provider & Cost**: latency, tokens, model routing, estimated spend, limits and failures.
- **Security Audit**: grants, denials, sensitive operations, integration trust state and revocation.
- **Cloud Operations**: deployment history, Worker errors, queue failures and remote sync health.

Every row must navigate to its related task, agent, tool invocation, terminal or trace. Provide saved filters, time range, project/workspace scope, export to JSONL/CSV, and a diagnostic support bundle with secrets redacted.

## 7. Reliability and performance requirements

- Live events are streamed without blocking editor rendering or PTY output.
- Backpressure is explicit; UI may batch rendering, but durable events must not be silently dropped.
- Terminal output uses bounded frames and coalescing; the UI must not re-render once per byte.
- A disconnected client resumes from a durable cursor and detects gaps.
- Ordering is guaranteed within a task/session stream; cross-machine ordering uses timestamps plus causal trace relationships, not wall-clock assumptions alone.
- Logs must remain usable for large repositories and long-running agent sessions through virtualized lists and indexed queries.
- Instrument the daemon's own event-loop delay, queue depth, memory, CPU, active PTYs, WebSocket lag and event persistence latency.
- Add load tests for concurrent agents, large terminal streams, reconnect/replay and log retention.

## 8. Acceptance tests

1. Start two agents in separate worktrees; distinguish their sessions and correlate parent/child delegation.
2. Follow a command from tool request through permission, PTY output, exit code, file changes and verification.
3. Disconnect the UI during execution; reconnect and replay all durable events from the last cursor without duplicates.
4. Search by task, provider, tool, severity and trace ID; export a redacted diagnostic bundle.
5. Verify that secrets in tool arguments, environment variables and provider errors never appear in local or remote logs.
6. Disable cloud sync and confirm no event payload leaves the device.
7. Trigger Worker/queue failures and inspect correlated deployment, ingestion and retry events.
8. Stream large terminal output without freezing the editor or losing process exit status.

## 9. Implementation order

1. Event schema, local append-only event repository, migration and tests.
2. Instrument Core Daemon, task state machine, provider gateway and tool authorization.
3. PTY event stream, bounded buffers, terminal lifecycle and process exit status.
4. Activity timeline, live log viewer, filters and task/trace navigation.
5. Audit export, redaction tests, retention and local-only settings.
6. Cloudflare ingestion API, Durable Object live fan-out, D1 indexes, R2 archive and Queue processing.
7. Cross-device replay, remote operations console, metrics and load testing.

A UI panel without an event-producing runtime is not an implementation. The event producers, persistence, correlation, security and replay contract must land before the logs interface is marked complete.
