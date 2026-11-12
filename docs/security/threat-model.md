# Security baseline and initial threat model

## Assets
Provider credentials, OAuth tokens, source code, project metadata, local files, tool permissions, agent transcripts and audit records.

## Threats
- Prompt injection through repository files, web pages, issues and tool output.
- Malicious MCP servers, skills and CLI packages.
- Tool confused-deputy attacks.
- Cross-project context leakage.
- Secret exfiltration through prompts, logs or tool output.
- Destructive filesystem and Git operations.
- Untrusted local network endpoints.

## Required controls
1. OS-backed credential vault; never persist secrets in plaintext SQLite.
2. Project-scoped filesystem roots and explicit path grants.
3. Per-agent tool allowlists and execution-time authorization.
4. Human approval for destructive operations, publishing, deployment and external side effects.
5. Redaction of secrets from logs and model context.
6. MCP server trust states: unreviewed, approved, blocked.
7. Skills are data until reviewed; do not auto-run install scripts.
8. Child process timeouts, output limits and cancellation.
9. Loopback-only daemon binding with per-install random auth token before exposing non-health endpoints.
10. Audit events for all external tool calls.

## Open security work
The current daemon scaffold exposes only a local health endpoint and is not yet a production security boundary. Do not expose it to LAN or internet.
