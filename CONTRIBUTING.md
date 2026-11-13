# Contributing to AliceLabs Core

Thank you for helping improve the IDE. Small tested changes, security reviews and reproducible bug reports are especially useful.

## Local setup

- Node.js 24 and pnpm 10
- Windows, macOS or Linux (the browser PWA can be developed without Tauri/Rust)
- For the desktop application only: a supported Rust/Tauri 2 environment

```bash
git clone https://github.com/eddyflores100-lang/alicelabs-core.git
cd alicelabs-core
pnpm install
pnpm web:dev
```

Before submitting a pull request:

```bash
pnpm web:build
pnpm test:web
pnpm test:worker
```

## Pull request expectations

1. Explain the user problem, the before/after behavior and which surfaces change (web, Worker, desktop or local companion).
2. Link screenshots for visual changes, including a 390 px mobile viewport if applicable.
3. Add tests for provider parsing, security boundaries and logic changes. Never commit actual keys, tokens, local files, or personally identifying screenshots.
4. Do not claim OAuth, mobile install, shell execution or an AI provider works end-to-end unless you actually performed the respective authorized test.
5. Respect provider terms and avoid account blocking bypass, credential extraction, false device identities or unapproved commands.
6. Update docs and `llms.txt` if public features change. Keep instructions understandable in English and Spanish.

## Reporting issues

Use the GitHub issue template or supply: operating system, browser/version, URL or commit, steps to reproduce, expected vs actual behavior and redacted logs. Do not post credentials, tokens, account identifiers or user content.

## Good first contributions

Mobile keyboard accessibility, readable error states, Service Worker update handling, test coverage, repository metadata, better source maps, localizations, documentation and permission-gated tool design.
