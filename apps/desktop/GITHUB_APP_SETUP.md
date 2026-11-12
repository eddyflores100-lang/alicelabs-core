# GitHub App setup for AliceLabs Core

Core uses the GitHub App OAuth Device Flow. Each person authorizes the official AliceLabs Core app, then installs it on their personal account or an organization and selects the repositories it may access.

## Register the app
1. In the AliceLabs GitHub account, open Settings → Developer settings → GitHub Apps → New GitHub App.
2. Name it AliceLabs Core and set the homepage URL to the public product/repository page.
3. Enable **Device Flow**.
4. Configure repository permissions with least privilege:
   - Metadata: Read-only
   - Contents: Read-only
5. Configure the account Profile permission as read-only if required by the GitHub API.
6. Save the app and copy its **Client ID**. Do not embed the App ID, private key, or client secret in the desktop client.
7. Copy the public installation URL from the app's public page.

## Configure local development
Create `apps/desktop/.env` from `.env.example` and set:
- `VITE_GITHUB_CLIENT_ID`
- `VITE_GITHUB_APP_INSTALL_URL`

For automated release builds, add GitHub Actions repository variables:
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_INSTALL_URL`

The release workflow injects these public values into the Vite build. They are not secrets.

## Authorization behavior
The desktop app requests a user access token through Device Flow. OAuth calls run inside the Rust/Tauri process rather than browser JavaScript, avoiding browser CORS restrictions. Repository API calls use the user's token and GitHub App permissions. Users must install the app and grant access to the repositories they choose.

The current build keeps the access token in memory only. It does not persist credentials. GitHub App user tokens expire; secure refresh-token handling through the OS credential vault must be completed before a production release.
