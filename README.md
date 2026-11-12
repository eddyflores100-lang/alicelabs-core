# AliceLabs Core

**One IDE. Every Model. Every Agent. Every Tool.**

AliceLabs Core is a cross-platform, local-first, provider-agnostic AI development environment. This repository starts as a modular monorepo with a desktop shell, a Rust core daemon, provider/agent/tool contracts, and architecture documentation.

## Product decisions
- Product: AliceLabs Core
- Platforms: Windows, macOS, Linux
- Desktop: Tauri 2
- UI: React + TypeScript + Vite
- Editor: Monaco
- Core: Rust modular daemon
- Persistence: SQLite
- Model routing: hybrid (manual, recommended, automatic)
- Integrations: global bridge with project-scoped permissions
- Development: complete product delivered incrementally

## Repository map
- `apps/desktop`: desktop UI and Tauri shell
- `apps/cli`: future command-line client
- `crates/core-domain`: domain types and invariants
- `crates/core-daemon`: local daemon and health API
- `crates/core-protocol`: versioned IPC/event contracts
- `crates/core-storage`: persistence boundary
- `packages/*`: frontend contracts and UI packages
- `schemas/*`: machine-readable contracts
- `docs/*`: architecture, ADRs, security and roadmap

## Current status
This is an initial foundation scaffold, not a finished IDE. Provider adapters, real agent execution, MCP transport, credential vault integration, Monaco integration, and packaging must be implemented and tested in subsequent milestones.

## Development prerequisites
- Node.js LTS
- pnpm
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
