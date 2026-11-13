# AliceLabs Core

**A universal, local-first AI IDE. Every model. Every agent. Every tool.**

AliceLabs Core is a cross-platform desktop development environment built with Tauri 2, Rust, React, TypeScript and Monaco.

## Product principles
- No bundled demo projects or hard-coded personal repositories.
- Every user connects their own GitHub account and selects which repositories the AliceLabs GitHub App may access.
- Windows, macOS and Linux.
- Blue, editor-first IDE with repository explorer, tabs, assistant panel, terminal panel and multi-window shell.
- Provider-neutral AI gateway and hybrid model routing.
- Local-first architecture; credentials belong in the operating-system credential vault.
- MIT licensed.

## GitHub integration
Core uses a GitHub App with OAuth Device Flow, not a shared personal access token. The app should request only **Metadata: Read-only** and **Contents: Read-only** repository permissions (plus read-only profile permission if needed). Users install it on their account or organization and choose which repositories to expose to Core.

Register the AliceLabs Core GitHub App, enable Device Flow, then configure:
- `apps/desktop/.env`: `VITE_GITHUB_CLIENT_ID` and `VITE_GITHUB_APP_INSTALL_URL`.
- GitHub Actions repository variables for release builds: `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_INSTALL_URL`.

See [GitHub App setup](apps/desktop/GITHUB_APP_SETUP.md) and [the environment template](apps/desktop/.env.example). OAuth Device Flow requests run in the Rust/Tauri process to avoid browser CORS restrictions. The current access token is held in memory only; it is not persisted. GitHub App user tokens expire, so secure refresh-token handling through the OS credential vault remains necessary before a production release.

## Current implementation
- Blue editor-first desktop shell; no seeded projects or fake agent records.
- GitHub App Device Flow UI and per-user repository discovery.
- Repository tree browsing and remote file preview in Monaco; editor runtime and workers are copied into the app locally instead of relying on a CDN.
- Multiple editor tabs, activity rail, assistant panel and bottom panel.
- New-window action for Tauri desktop builds.
- Provider-neutral Anthropic and OpenAI-compatible API adapters.
- Capability/context-aware model selection engine.
- SQLite v1 metadata schema.
- MIT license and a multi-platform release workflow for Windows, macOS and Linux.

## Not yet production-complete
Remote files are currently read-only previews; local clone/worktree management, writing/committing/pushing files, a real local terminal, agent execution, MCP/CLI bridge, provider account UI, OS keychain integration, token refresh, GitLab/Bitbucket adapters, and signed installers still need implementation. The terminal and assistant panels are intentionally labelled as not connected instead of showing fake functionality. New windows currently open an independent empty IDE window; shared session state is not yet synchronized between windows.

## Development
Requirements: Node.js LTS, pnpm 10, Rust stable and Tauri platform prerequisites.

```powershell
pnpm install
pnpm --filter @core/desktop dev
```

For a production build:

```powershell
pnpm --filter @core/desktop build
pnpm --filter @core/desktop tauri build
```

## License
MIT. See [LICENSE](LICENSE).


## AliceLabs Core Web — Cloudflare Pages

**Web IDE:** https://alicelabs-core.pages.dev  
**Agent Worker (health):** https://alicelabs-core-agent.eddyflores100.workers.dev/api/health

El IDE web usa `apps/web` (React, Monaco, File System Access) y el agente de IA usa `apps/api` (Cloudflare Worker con credenciales BYOK). Cloudflare Pages se integra con la rama `main` del repositorio, con directorio raíz `apps/web`, build `npm run build` y salida `dist`.

```bash
pnpm install
pnpm web:dev
pnpm web:build
pnpm --filter @core/agent-worker test
# En el equipo autorizado, para terminal local opcional:
node tools/local-bridge/server.mjs
```

**Importante:** las carpetas locales se abren y guardan con permiso del navegador; GitHub público actualmente es de solo lectura. La IA puede proponer cambios en el archivo activo, pero no aplicarlos ni guardarlos sin aprobación. La terminal solo funciona con el Bridge local, token temporal y aprobación manual de cada comando. No se ejecuta shell desde Workers. Ver [guía web](apps/web/README.md).
