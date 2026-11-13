# AliceLabs Core Remote Sandbox â€” deployment gated

**Status: source prototype validated with unit tests and Wrangler dry-run. NOT deployed. NOT connected to the production web IDE.**

This package prepares an independent, scoped remote code sandbox for future use by the browser IDE and Android. It intentionally has **no publicly accessible terminal without identity verification**.

## Isolation design

- Cloudflare Worker requires **Cloudflare Access authentication**. Its identity is used to derive an opaque namespace for each user/project.
- Each project uses a separate Durable Object / container; the system retains only bounded UTF-8 text files in DO SQLite storage and restores them when a container restarts. Container base network is disabled.
- Only allowed binary commands with structured argv may be requested. The request must include a **true approval flag**, and the UI must show the exact command to the user before sending it. No arbitrary host URL, general purpose shell, or global file access.
- Command output is capped at 120 KB / 60s, file size at 250 KB, 80 files per project. Containers stop when idle. There is no billing/deployment in this repository itself.
- A token/phone number is **never placed in Pages or the Android package**. Secrets belong to the remote Worker environment.
- The optional WhatsApp Cloud API adapter sends only **approved template messages** to explicitly opted-in E.164 recipients, via a registered Meta business sender. There is no WhatsApp Web session scraping or automated unsolicited messaging.

## Configure before deployment

Cloudflare Containers require **Workers Paid** and usage charges, Cloudflare Access for the chosen hostname, and tested account-level container entitlements. Do not deploy unless the owner explicitly accepts these costs and configures authentication.

1. Configure a Cloudflare Access policy for the Worker hostname, limited to approved user identities. Access must pass a trusted identity to the Worker.
2. Verify `wrangler.json` and each Durable Object / container API against the current Cloudflare Containers release. Ensure no route can be used without Access; audit logs must not reveal private file contents.
3. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (optional `WHATSAPP_TEMPLATE_LANG`) as Worker secrets **only if WhatsApp Business and the Meta template were already approved**, and obtain a recipient's explicit opt-in. Never commit secrets.
4. Deploy using `pnpm --filter @core/remote deploy` only after an authenticated end-to-end security review, billing approval and manual testing.
5. Connect a client through Access authenticated requests; no production client is wired to this package yet.

### Remote API intended contract

Once provisioned:
- `GET /v1/projects/:uuid/status`: project container status
- `GET|PUT /v1/projects/:uuid/files/:path`: scoped UTF-8 text
- `POST /v1/projects/:uuid/run`: `{ "bin":"git", "args":["status"], "approved":true }` from a human-approved UI action
- `GET|PUT /v1/projects/:uuid/notify`: consent and notification configuration

A bounded durable task queue with per-project Cloudflare Durable Object alarms is now implemented and tested with mocks. It is not deployed or production-tested until Access and Containers are configured. No public WebSockets, mobile push service, or general autonomous coding agent is provided. Containers have resource/cost limits and should not be used as a disguised anonymous shell.

## Tests and dry run

```bash
pnpm --filter @core/remote test
pnpm --filter @core/remote check
pnpm --filter @core/remote exec wrangler deploy --dry-run --outdir .wrangler-dryrun
```

The dry run builds the Docker image locally but does not deploy it or create a billable container.

Further reading: [Cloudflare Containers](https://developers.cloudflare.com/containers/), [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/), [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/).
