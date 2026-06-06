# Native features setup (iOS)

Some features can't ship via the web OTA channel — they need Capacitor plugins +
iOS capabilities compiled into a native build (Xcode → TestFlight). This is the
runbook for each. None of it changes the running app until you cut a native build.

General build step (activates anything plugin-based):

```bash
npm install
npm run build
npx cap sync ios     # wires installed plugins into ios/App/CapApp-SPM/Package.swift
npx cap open ios     # then Product → Archive in Xcode
```

---

## 1. Haptics — ✅ staged (just needs a native build)

- Plugin already added: `@capacitor/haptics` (in `package.json`).
- Code already wired: `src/haptics.ts` (`tap()`), called on send in `App.tsx`.
- It no-ops on web and on the *current* native binary, so it's safe in OTA now.

**To activate:** just do the general build step above. No Xcode config needed —
`cap sync` adds the SPM dependency, and the next build makes `tap()` fire.

---

## 2. Face ID / Touch ID lock

Plugin (well-maintained, Capacitor-8 compatible):

```bash
npm install @aparajita/capacitor-biometric-auth
npx cap sync ios
```

**Xcode / Info.plist** — add a usage string to `ios/App/App/Info.plist`:

```xml
<key>NSFaceIDUsageDescription</key>
<string>Unlock Go Farther with Face ID.</string>
```

**App code to add (frontend, ships via OTA once the plugin is in the binary):**
- A Settings toggle "Require Face ID" → store a boolean in `localStorage`.
- On app launch + on `appStateChange → active`, if the toggle is on, show a lock
  overlay and call `BiometricAuth.authenticate(...)`; reveal the app only on success.
- Add a "privacy blur" overlay while backgrounded (cheap, pairs well with this).

I can write that frontend in ~30 min once you confirm the plugin choice — say the
word and I'll stage it (it'll no-op until this native build, same as haptics).

---

## 3. Push notifications (+ reply-from-push)

```bash
npm install @capacitor/push-notifications
npx cap sync ios
```

**Apple Developer (one-time):**
1. Create an **APNs Auth Key** (.p8) at developer.apple.com → Keys. Note the
   **Key ID** and your **Team ID**.
2. In Xcode → Signing & Capabilities, add **Push Notifications** and
   **Background Modes → Remote notifications**.

**Info.plist** — add background mode (if not added by the capability):

```xml
<key>UIBackgroundModes</key>
<array><string>remote-notification</string></array>
```

**Backend — ✅ already built (just needs your APNs key):**
- `device_tokens` table + RLS — created.
- `supabase/functions/send-push` — deployed; signs an ES256 JWT with the .p8 and
  POSTs to APNs. **Set these Supabase secrets** to activate it:
  `APNS_KEY` (full .p8 PEM), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`,
  and optionally `APNS_HOST=api.push.apple.com` (defaults to the sandbox for
  TestFlight). Until then it returns `{ok:false,"error":"APNs not configured…"}`.
- `src/push.ts` `registerPush()` — uploads the token to `device_tokens`; wired to
  the Settings → **Notifications** toggle. No-ops until the native plugin is added.

**To finish:** `npm i @capacitor/push-notifications && npx cap sync ios`, enable
**Push Notifications** + **Background Modes → Remote notifications** in Xcode,
build, then toggle Notifications on in Settings. Test by POSTing to `send-push`
with your user JWT (`{ "title": "Hi", "body": "Test" }`).

### Reply-from-push (inline reply)

The enabler is done: `send-push` accepts a `category` (and `data`), so it can emit
an actionable notification. The rest is native + a JS handler:

1. **Register the category** (text-input action). In `AppDelegate.swift`
   `didFinishLaunching`:
   ```swift
   import UserNotifications
   let reply = UNTextInputNotificationAction(identifier: "REPLY",
       title: "Reply", options: [], textInputButtonTitle: "Send",
       textInputPlaceholder: "Type a reply…")
   let cat = UNNotificationCategory(identifier: "GF_REPLY", actions: [reply],
       intentIdentifiers: [], options: [])
   UNUserNotificationCenter.current().setNotificationCategories([cat])
   ```
2. **Send an actionable push:** `POST send-push` with
   `{ "title":"…", "body":"…", "category":"GF_REPLY", "data": { "threadId":"…" } }`.
3. **Handle the typed reply (JS)** via the push plugin:
   ```ts
   Push.addListener('pushNotificationActionPerformed', (e) => {
     if (e.actionId === 'REPLY' && e.inputValue) {
       // e.notification.data.threadId + e.inputValue -> POST to the reply endpoint
     }
   });
   ```

⚠️ For the reply to actually *go somewhere* it needs (a) a notification source
that embeds context (e.g. a "new email → push" flow) and (b) somewhere to send the
reply — both of which lean on **server-side tasks** (next section's caveat). So
this is staged/plumbed, not yet an end-to-end feature.

⚠️ **"Notify when a task finishes while you're away"** needs the task to run
**server-side** (today, chat work runs in the app while it's open; iOS suspends a
backgrounded web view). That's a deeper change (move long tasks to a server job +
fire the push on completion). Worth doing, but it's its own feature — flagged here
so the scope is clear.

---

## 4. Live Activity / Dynamic Island

This is **Xcode-only** — it requires a new **Widget Extension** target with
ActivityKit Swift code; it can't be scaffolded safely by editing the project file
outside Xcode.

Steps:
1. Xcode → File → New → Target → **Widget Extension** (check "Include Live Activity").
2. Define an `ActivityAttributes` struct (e.g. task title + state).
3. From the app, `Activity.request(...)` when a long task starts; `update(...)` as
   it progresses; `end(...)` when done. Bridge to JS with a tiny custom Capacitor
   plugin (or `@capacitor-community` ActivityKit wrapper if one fits).
4. Add `NSSupportsLiveActivities = YES` to `Info.plist`.

Like push, this is most useful once long tasks run server-side (see §3 caveat).

---

## Summary

| Feature | Code staged here | Needs from you |
|---|---|---|
| Haptics | ✅ staged | `cap sync` + build |
| Face ID lock | ✅ staged (FE + toggle) | `npm i @aparajita/capacitor-biometric-auth` + `cap sync` + build |
| Push backend + registration | ✅ built (table + send-push + registerPush) | APNs key as secrets; `npm i @capacitor/push-notifications` + capability + build |
| Reply-from-push | runbook | notification category (native) |
| Live Activity | runbook | Xcode widget extension |
