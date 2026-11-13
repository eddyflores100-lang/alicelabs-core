# Changelog


## 0.7.0 — Multi-project windows, dictation and native Android preview

- Up to 16 isolated project tabs with individual editor, AI conversation and draft; IndexedDB local project recovery, no API tokens persisted.
- Pop out an individual project into a browser window. Cross-device synchronization remains unimplemented.
- Browser voice dictation and user-permitted task-completion alerts; native Android uses speech recognition and local notifications.
- Android Capacitor preview builds a debug-signed APK; not a production Play Store release.
- Cloudflare Access-gated remote sandbox and Meta WhatsApp template notification code added as non-deployed source prototypes; paid services and approved integrations are required.

All notable changes are recorded here. AliceLabs Core is a pre-1.0 project; changes may be incompatible.

## 0.6.0 — Web/PWA preview

- Installable Android/iOS-compatible Progressive Web App with service worker, manifest, icons and install help.
- Responsive touch navigation with Files, Editor, Agent, Models and Console.
- Mobile text-file import, editing and export.
- Public model search powered by a Cloudflare Worker and Models.dev metadata; provider, capability and sorting filters.
- One-command startup for the optional localhost companion processes, which still require individual authorization.
- Public indexing metadata and bilingual project documentation.
- **Not included:** remote shell execution from a phone, arbitrary provider subscription reuse, agent autonomy or GitHub write support.

## 0.5.0 — Provider connections

- Multi-provider connection center and DeepSeek BYOK adapter.
- Guidance for official native Gemini and Claude tools with separate login requirements.

## 0.4.0 — Experimental ChatGPT companion

- Local-only experimental Sign in with ChatGPT OAuth companion with multiple isolated account records.

## 0.3.0 — Resident agent selection

- Per-provider model discovery, multiple API profiles, heuristic routing, guided plans and reviewed single-file edits.

## 0.2.0 — Web IDE

- Cloudflare Pages React + Monaco editor, read-only public GitHub explorer, local file permissions, Cloudflare BYOK Worker.
