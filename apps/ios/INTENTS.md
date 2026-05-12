# iOS App Intents · Hey Siri integration

**Status:** Xcode project + Swift App Intents + URL scheme + web deep-link handler all in place. The last step (build + install on a device) needs Apple Developer enrollment OR a 7-day free signing certificate.

## What's built

```
apps/ios/
├── capacitor.config.json            # appId, URL scheme, plugins
├── ios/App/App/
│   ├── AppDelegate.swift             # Capacitor default (forwards URL opens)
│   ├── Info.plist                    # mic + speech-recognition usage + URL types
│   ├── OllieIntents.swift            # 3 App Intents + AppShortcutsProvider
│   ├── capacitor.config.json
│   └── public/                       # built web app
└── www/                              # copy of apps/web/dist
```

## The three intents

| Intent             | Phrase                          | Outcome                              |
|--------------------|---------------------------------|--------------------------------------|
| OllieCaptureIntent | "Hey Siri, Ollie capture"       | open app → mic auto-starts via deep link |
| OllieRemindIntent  | "Hey Siri, Ollie remind"        | open app → admin draft               |
| OllieDueIntent     | "Hey Siri, Ollie what's due"    | open app → dashboard upcoming        |

## Deep-link flow

1. Siri runs the intent → `UIApplication.shared.open("ollie://capture")`.
2. iOS launches the app (or foregrounds it).
3. AppDelegate forwards the URL to Capacitor.
4. Capacitor fires `appUrlOpen` → `apps/web/src/lib/capacitor-deeplink.ts` handles it.
5. `ollie://capture` dispatches the custom `ollie:siri-capture` window event.
6. `MicButton` is listening → calls `start()` → mic recording begins.

The web event chain is already wired in `apps/web/src/main.tsx` and `MicButton.tsx`.

## Final step (Serra) — open the project in Xcode

```sh
# 1. Make sure CocoaPods is installed (one-time):
brew install cocoapods   # ← already done

# 2. Point xcode-select at full Xcode (NOT command-line tools):
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

# 3. Install pods + open:
cd ~/ollie/apps/ios/ios/App
pod install
open App.xcworkspace
```

In Xcode:

1. **Add `OllieIntents.swift` to the App target** — drag from `App/App/OllieIntents.swift` into the App target if not already in Compile Sources.
2. **Set deployment target to iOS 16+** — required for App Intents.
3. **Capabilities → Push Notifications → on** (for APNs, Sprint 5).
4. **Sign with your Apple Developer team** (free 7-day for testing, paid $99/yr for App Store).
5. **Build + run on a connected device.** First launch prompts for mic + speech permission (Info.plist usage strings in place).

## Test

Once installed on device:

```
"Hey Siri, Ollie capture"
```

→ Ollie opens. Within ~250ms the mic starts recording. Speak. Tap mic or pause ~3s; transcript routes through the dissection pipeline.

`ollie://capture` can also be tested without Siri:

```sh
xcrun simctl openurl booted "ollie://capture"
```
