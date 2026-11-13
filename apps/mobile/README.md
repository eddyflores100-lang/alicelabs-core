# AliceLabs Core Mobile — native Android preview

**[Download the Android v0.7.0 preview APK](https://github.com/eddyflores100-lang/alicelabs-core/releases/download/v0.7.0-preview/AliceLabs-Core-Android-v0.7.0-preview.apk)** · [View the source release](https://github.com/eddyflores100-lang/alicelabs-core/releases/tag/v0.7.0-preview). The APK is debug-signed and not physically device-tested or a Play Store app.

This is a **Capacitor 8** Android application bundling the same React/TypeScript code as the Cloudflare Pages web app. It is **not** a wrapper that silently grants access to your entire phone.

## Native permissions

- Microphone / Android speech recognition: requested **only when tapping Dictar**; in the native app `@capacitor-community/speech-recognition` is used with the `es-EC` locale.
- Local notifications: requested **only when turning on task completion alerts**. Android 13+ asks permission. Notifications indicate when a task in the *running app* completes.
- File access: mediated by the Android document picker / imported files; no permission for unrestricted storage or other apps.
- Internet: required for public model catalog, GitHub and authenticated providers.

**Not implemented:** opening WhatsApp messages automatically from the phone, background remote jobs or push notifications when the app is terminated, unrestricted OS access, credential import from other apps. WhatsApp via Meta Cloud API is a separate opt-in backend scaffold under `apps/remote`, NOT activated in production.

## Build

Node 24, pnpm 10, Java JDK 21, Android SDK platform 36.

```bash
pnpm install
pnpm --filter @core/web build
pnpm --filter @core/mobile exec cap sync android
# Windows:
cd apps/mobile/android
gradlew.bat assembleDebug
# macOS/Linux:
./gradlew assembleDebug
```

Output: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. The resulting **debug-signed APK** is an installable preview for testing on authorized devices; it is not signed or vetted for a store release. To publish on Play Store, a private upload keystore, Play Console validation, compatibility testing, privacy disclosures and distribution controls are still needed.

For browser use without installation, go to https://alicelabs-core.pages.dev and use the PWA install control.

The app uses a local `https://localhost` origin for Capacitor. The cloud BYOK gateway explicitly allows this native app origin. The localhost terminal Bridge on a PC **is not directly reachable from Android**. Cloud runner code is in `apps/remote` and requires separately configured Cloudflare Access + Workers Paid.
