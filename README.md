# Go Farther

A ChatGPT-style chat app — one React + Vite + TypeScript codebase that ships as
a **web app** and a **native mobile app** (via Capacitor), built through GitHub
Actions.

## Web

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

## Mobile (Android, built on GitHub)

The native Android app is a [Capacitor](https://capacitorjs.com) wrapper around
the same web build — no separate UI. GitHub Actions compiles it, so you don't
need Android Studio locally.

- **Workflow:** `.github/workflows/android.yml`
- **Cut a build:** push a tag → APK/AAB attached to a GitHub Release:
  ```bash
  git tag v1.0.0 && git push origin v1.0.0
  ```
  (Or run the workflow manually from the Actions tab for a downloadable APK.)
- **Signing:** set `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` as repo secrets for a signed
  release. Without them the workflow builds an installable **debug APK**.

Build/preview locally (needs Android SDK):

```bash
npm run build && npx cap sync android
npx cap open android        # or: cd android && ./gradlew assembleDebug
```

> iOS is a quick follow-up (`npx cap add ios` + a macOS workflow) and needs an
> Apple Developer account for signing.

## Connect a real model

Out of the box it runs in **demo mode** (a local mock streams a placeholder
reply). To stream real answers, set a chat endpoint that accepts
`POST { messages: {role, content}[] }` and returns a streamed text response:

```bash
# .env
VITE_CHAT_API=https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/chat
```

A Supabase project (`gofarther-ai`) is already provisioned to host that endpoint
as an Edge Function.
