# iOS App Intents · Hey Siri integration

**Status:** Swift skeleton. Wires up once the Xcode project is generated
via `pnpm cap add ios` (deferred — needs Apple Developer enrollment).

## Intent set (matches Sprint 4 E3 brief)

| Intent             | Invocation phrase            | Outcome |
|--------------------|------------------------------|---------|
| OllieCaptureIntent | "Hey Siri, Ollie capture"    | open app with mic ready |
| OllieRemindIntent  | "Hey Siri, Ollie remind"    | open admin reminder draft |
| OllieDueIntent     | "Hey Siri, Ollie what's due" | open dashboard upcoming |

## File to add inside the generated Xcode project

Path: `apps/ios/App/App/OllieIntents.swift`

```swift
import AppIntents

@available(iOS 16.0, *)
struct OllieCaptureIntent: AppIntent {
  static var title: LocalizedStringResource = "Ollie capture"
  static var description = IntentDescription("open ollie ready to record")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    // Capacitor sets a URL scheme (ollie://). The intent opens that
    // URL with `?action=capture` so the web layer can route.
    if let url = URL(string: "ollie://capture") {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct OllieRemindIntent: AppIntent {
  static var title: LocalizedStringResource = "Ollie remind"
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult {
    if let url = URL(string: "ollie://admin?action=remind") {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct OllieDueIntent: AppIntent {
  static var title: LocalizedStringResource = "Ollie what's due"
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult {
    if let url = URL(string: "ollie://dashboard?focus=upcoming") {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct OllieShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: OllieCaptureIntent(), phrases: [
      "\(.applicationName) capture",
      "capture in \(.applicationName)",
    ])
    AppShortcut(intent: OllieRemindIntent(), phrases: [
      "\(.applicationName) remind",
      "set a reminder in \(.applicationName)",
    ])
    AppShortcut(intent: OllieDueIntent(), phrases: [
      "\(.applicationName) what's due",
      "what's due in \(.applicationName)",
    ])
  }
}
```

## Renderer-side handler

The web app already supports a deep-link router. Wire `ollie://capture`
into the brain-dump path: on app open with that URL, call
`startVoiceCapture()` from `voice-capture.ts` with `source: 'siri'`.

Pseudocode for `apps/web/src/main.tsx` after Capacitor is wired:

```ts
Capacitor.addListener('appUrlOpen', ({ url }) => {
  if (url.startsWith('ollie://capture')) {
    // dispatch a custom event the MicButton listens for
    window.dispatchEvent(new CustomEvent('ollie:siri-capture'));
  }
});
```

## Deferred until Apple Developer enrollment

- iOS App ID `app.ollie.ollie` needs Push Notifications + Background
  Modes (Audio for SFSpeech) capabilities enabled.
- App Intents require iOS 16+ deployment target — already the default.
- Siri donation: `OllieShortcuts.updateAppShortcutParameters()` after
  signin so the suggestions surface.

## Why Mac shipped this sprint and iOS didn't

Mac via `globalShortcut.register('CommandOrControl+Control+Space')` in
Electron's main process requires no Apple Developer enrollment and no
Xcode project. iOS App Intents need the Xcode project + a paid
Developer account. Mac ships now; iOS waits for the same enrollment
that unblocks APNs (Sprint 5).
