# Architecture and trust boundaries

**Status:** preview, updated for the mobile PWA and universal model explorer.

## Components

| Package | Purpose | Deployment |
|---|---|---|
| `apps/web` | React 19, TypeScript, Monaco, touch-friendly mobile editor, model explorer | Cloudflare Pages |
| `apps/api` | Cloudflare Worker routing public catalog searches and user-provided API requests | Cloudflare Workers |
| `apps/desktop` | Separate experimental Tauri 2 + Rust desktop application | Local development |
| `tools/local-bridge` | Local terminal command execution, approval per command | User's desktop, localhost only |
| `tools/chatgpt-companion` | Experimental separate OAuth account client for eligible open-source users | User's desktop, localhost only |
| `tools/local-runner.mjs` | Starts both local companion processes | User's desktop |

## Boundaries

1. **Public catalog is read-only discovery.** The Worker fetches Models.dev metadata, filters and paginates the results. A model entry is not a working connection or entitlement.
2. **API provider execution is BYOK.** The browser chooses among *authorized, manually added profiles* and sends one selected key over HTTPS for each request. Worker upstream hosts are fixed; no arbitrary proxy destinations, credential persistence or retries across other accounts after authorization/rate-limit errors.
3. **Device access stays on the device.** File System Access requires browser permission; imported mobile files are held in memory and exported to downloads. GitHub public browsing is read-only.
4. **Local terminal is consent gated.** The Bridge binds to 127.0.0.1, allows known front-end origins, requires a temporary pairing token and asks permission on its own local terminal before each command. The command is run on the computer hosting the Bridge, not in Cloudflare.
5. **Experimental ChatGPT login.** The separate local companion validates OAuth and handles credentials locally; it cannot be assumed to work for every account type. Browser and Worker must not receive reusable OAuth tokens.
6. **Installed PWA is not a native OS agent.** A phone's 127.0.0.1 refers to the phone, not another computer. Remote execution will require identity, scoped authorization, isolated runtimes, audit logs and a dedicated threat model.
7. **Approvals are separate from model suggestions.** A plan and a diff are proposals; clicks applying edits and local command authorization are explicit user actions.

## Public catalog implementation

`apps/api/src/catalog.js` fetches a public provider/model index with a bounded cache and paginated query parameters. Returned fields are normalized to avoid leaking raw provider payloads. Filters include provider, free text, reasoning, tool calls, vision, open weights and sorting by date/price/context/name.

`apps/web/src/ModelFinder.tsx` renders search, capability filters, pagination and provider metadata. Public catalog results are labelled discovery only. Provider account keys stay on the separate connections path.

## Why the mobile editor differs

Desktop uses Monaco, editor workers and File System Access where available. Mobile uses a simple tactile textarea for reliability with touch keyboards, file import and explicit export to a downloaded file. A future mobile syntax-aware editor must be measured for accessibility, memory, keyboard ergonomics, and battery impact before replacement.

## Release topology

```text
GitHub main
  └─ Cloudflare Pages build: apps/web, npm run build, dist
       ├─ PWA static assets & cache version
       └─ Calls Cloudflare Worker at /api/catalog and /api/agent (different host)

Wrangler deploy apps/api/src/index.js  ── Cloudflare Workers
Local Bridge / OAuth companion  ──────── User's authorized computer only
Tauri desktop  ───────────────────────── Experimental separate app
```

Cloudflare Pages and the Worker are **separate deployments**. Publishing one does not automatically publish the other. Validate both before claiming a release.

## Tests and gaps

```bash
pnpm web:build
pnpm test:web
pnpm test:worker
```

Current tests cover routing and backend model/catalog behavior. Missing: full provider-account end-to-end authorization, mobile hardware/PWA install tests, Cloudflare API and Pages cross-deployment integration checks, real multi-file tools, GitHub write permissions and desktop packaging. Do not interpret passing unit tests as proof of those features.
