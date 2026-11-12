# GitHub OAuth setup for AliceLabs Core

The app uses the GitHub OAuth Device Flow so every installer user connects their own GitHub account.

1. Sign in to the AliceLabs GitHub organization/account that owns the product.
2. Open GitHub Settings → Developer settings → OAuth Apps → New OAuth App.
3. Register the app name as AliceLabs Core. Set the homepage URL to the public product/repository page.
4. Enable **Device Flow** in the OAuth App settings.
5. Copy the OAuth App **Client ID**. It is public configuration, not a client secret.
6. Create `apps/desktop/.env` using `.env.example` and set `VITE_GITHUB_CLIENT_ID=YOUR_CLIENT_ID`.
7. Rebuild the desktop app. Do not add a client secret to the application, source code, or installer.

The device flow requests `read:user repo` so users can list repositories they own or can access, including private repositories. Review the requested scope before publishing. The current implementation keeps the access token in memory only; OS keychain storage, token revocation, and a least-privilege GitHub App integration should be completed before stable production release.
