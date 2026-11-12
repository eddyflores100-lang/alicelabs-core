# AliceLabs Core

**One IDE. Every Model. Every Agent. Every Tool.**

AliceLabs Core is a cross-platform, local-first, provider-agnostic AI development environment. The repository is a modular monorepo with a Tauri desktop shell, a Rust core daemon, a Monaco editor surface, provider adapters, versioned contracts, and architecture documentation.

## Product decisions
- Product: AliceLabs Core
- Platforms: Windows, macOS, Linux
- Desktop: Tauri 2
- UI: React + TypeScript + Vite
- Editor: Monaco (embedded editor surface; filesystem-backed workspace integration is next)
- Core: Rust modular daemon
- Persistence: SQLite (storage boundary scaffolded; migrations are next)
- Model routing: hybrid (manual, recommended, automatic — routing engine is next)
- Integrations: global bridge with project-scoped permissions
- Development: complete product delivered incrementally

## Repository map
- `apps/desktop`: desktop UI, Monaco editor surface and Tauri shell
- `crates/core-domain`: domain types and invariants
- `crates/core-daemon`: local daemon and health API
- `crates/core-protocol`: versioned IPC/event contracts
- `crates/core-storage`: persistence boundary
- `crates/core-provider`: provider-neutral chat contract, OpenAI-compatible and Anthropic adapters
- `schemas/*`: machine-readable contracts
- `docs/*`: architecture, ADRs, security and roadmap

## Current status
The desktop UI and Monaco editor surface build successfully. The Rust workspace passes formatting, tests and Clippy in GitHub Actions. Provider adapters implement HTTP requests for Anthropic Messages and OpenAI Chat Completions-compatible endpoints (including configurable gateways such as OpenRouter). Credentials are passed to adapter instances at runtime; this crate does not persist them.

This is an active foundation, not a finished IDE. The editor currently edits an in-memory sample buffer rather than files on disk. Workspace filesystem access, OS credential-vault integration, SQLite migrations, provider account management, model routing, real agent execution, MCP transport, tool permissions, and desktop packaging remain planned work.

## Development prerequisites
- Node.js LTS
- pnpm 10
- Rust stable toolchain
- Tauri 2 platform prerequisites

## Start the UI
```bash
pnpm install
pnpm --filter @core/desktop dev
```

## Rust checks
```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Security baseline
Never commit API keys, OAuth tokens, local `.env` files, provider session cookies, or user project data. Secrets must be stored through the operating-system credential vault adapter. Tool execution must be authorized by the daemon and scoped to a project.

## License
The license is intentionally not preselected. Choose the project's open-source/commercial licensing strategy before publishing source code.
