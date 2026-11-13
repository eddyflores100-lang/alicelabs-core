# Security policy

AliceLabs Core includes access to source files, AI providers and an optional terminal bridge. Treat any request for credentials or command execution as security-sensitive.

## Reporting a vulnerability

Please **do not publish exploitation steps, access tokens, or private user files** in a public issue. Send a concise private report to **contact@alicelabs.site** with the affected component, version/commit, reproduction conditions and expected behavior. We will review the report; response times are not guaranteed for this early-stage project.

## Threat model and current limitations

- **Local services:** the Bridge and optional OAuth companion bind only to `127.0.0.1` and use an ephemeral pairing token. Do not forward these ports or run them as an administrator/root.
- **Terminal commands:** the Bridge demands explicit authorization on the host computer for *every* command. Inspect commands before approving; do not authorize scripts you do not understand.
- **AI model catalog:** listing a provider is informational. Never treat the catalog as a credential source.
- **API credentials:** sent to a fixed Cloudflare Worker via HTTPS and then to the selected model provider. They are not saved server-side. Browser profiles reset on reload.
- **OAuth:** the ChatGPT account client is experimental and subject to provider eligibility. Tokens must stay local; do not paste login codes, refresh tokens or cookies into web forms.
- **Mobile:** the installed PWA is a browser application, not a secure remote terminal. File imports/exports are subject to the device's browser handling.
- **AI output:** generated code and commands may be wrong or unsafe. Review changes, run tests and back up important projects before approval.

Not yet provided: third-party security audit, encrypted multi-device account storage, remote execution sandbox, SSO and mature enterprise access controls.

## Supported versions

This project is in pre-1.0 preview. Security fixes target the latest `main` branch; there is no long-term maintenance guarantee for earlier commits.
