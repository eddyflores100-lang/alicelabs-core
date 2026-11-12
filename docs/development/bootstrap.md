# Bootstrap checklist

1. Install Node.js LTS, pnpm and Rust stable.
2. Install the Tauri prerequisites for the host operating system.
3. Run `pnpm install`.
4. Run `pnpm --filter @core/desktop tauri dev` to launch the desktop shell.
5. Run `cargo test --workspace` and `pnpm --filter @core/desktop typecheck`.

The current scaffold intentionally exposes only a daemon health endpoint. It does not yet implement provider calls, secret storage, model routing, agent execution, MCP, ACP, PTY, Git worktrees or remote access. Do not expose the daemon beyond loopback.
