# Voice ("Hey Ollie") — Re-Audit (2026-05-14)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_voice.md`. No deltas from baseline — reconfirmed.

**Status:** SCAFFOLDED — push-to-talk works on web/electron; iOS broken (plugin missing).

---

## TL;DR (100 words)

Voice is **push-to-talk only** — no wake-word listening. Privacy is honest (on-device Web Speech API); battery impact is zero. Transcript display is clean and editorial. iOS support is **partially wired**. Siri intents complete (3 App Intents: capture, remind, what's due); speech-recognition plugin is NOT installed in `apps/ios/capacitor.config.json` — iOS voice capture broken until plugin added. Turkish/Spanish advertised but not implemented; only English active (`rec.lang = 'en-US'` hardcoded). Latency, accuracy, error rates never benchmarked. Design is high-quality, no shame mechanics. Ready for internal testing; needs iOS plugin install + multilingual wiring + benchmarks before shipping.

---

## Features

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Wake word ("Hey Ollie") | NOT IMPLEMENTED | Zero matches for Porcupine/picovoice in repo. Push-to-talk only. |
| 2 | Continuous listening | NOT IMPLEMENTED | 30s session cap; no background process |
| 3 | Transcript display (live) | WORKING | 80-char interim preview, editorial cream card |
| 4 | Routes to brain dump | WIRED (untested) | `MicButton onTranscript → apply(text) → useApplyBrainDump → extract → modules` |
| 5 | On-device privacy | WORKING | Web Speech API (browser); iOS would be SFSpeechRecognizer (plugin not installed) |
| 6 | Battery impact | ZERO | No idle drain; user-initiated only |
| 7 | Multilingual (EN+TR+ES) | EN ONLY | Hardcoded `rec.lang = 'en-US'`; settings hook documented but not wired |
| 8 | iOS Capacitor plugin | NOT INSTALLED | `@capacitor-community/speech-recognition` missing from capacitor.config.json |
| 9 | Siri Intents | WIRED | OllieCaptureIntent, OllieRemindIntent, OllieDueIntent → ollie:// URL scheme |
| 10 | Hotkeys (Mac + web) | WORKING | Cmd+Opt+Space (Mac); Ctrl+Alt+Space (Win/Linux); CommandOrControl+Shift+Period backup |

---

## Telemetry events

```ts
voice:capture_started      { source: 'mic-button' | 'hotkey' | 'siri', ts }
voice:capture_transcribed  { text, source, ts }
voice:capture_cancelled    { reason, ts }
```

Session tracker marks `voice_used: boolean` in session_end row. No backend consumer; events local-only.

---

## P1 gaps

1. **iOS speech-recognition plugin missing**: `cd apps/ios && npm install @capacitor-community/speech-recognition && cap sync ios` + add to capacitor.config.json
2. **Zero unit tests**: voice-capture.ts, MicButton.tsx, router wiring untested. Mock Web Speech API + Capacitor + Electron IPC bridges
3. **Latency/accuracy never benchmarked**: shipped blind. Baseline needed (start-to-first-interim, WER, cross-platform)

## P2 gaps

4. Turkish + Spanish not wired (advertised, hook documented at voice-capture.ts:100-101)
5. Siri deep-link targets stubbed (remind + what's-due open app, don't navigate)
6. No analytics backend for voice metrics

---

## Hypotheses (reconfirmed)

| Hypothesis | Outcome |
|---|---|
| Wake word doesn't exist | ✓ CONFIRMED |
| Continuous listening doesn't exist | ✓ CONFIRMED |
| iOS plugin not installed | ✓ CONFIRMED |
| Multilingual EN-only | ✓ CONFIRMED |
| Siri intents wired | ✓ CONFIRMED |
| Privacy on-device | ✓ CONFIRMED |
| Battery impact zero | ✓ CONFIRMED |
| Design quality high | ✓ CONFIRMED (no shame mechanics, editorial) |

---

## Top 3 next steps

1. Install `@capacitor-community/speech-recognition` plugin + cap sync ios + test on simulator (P1 ship blocker for iOS)
2. Add unit tests covering voice-capture.ts + MicButton.tsx (target 85% coverage)
3. Wire Turkish language toggle reading `shared.settings.recognizer_locale` (hook already documented in code)

## BLOCKED-EXTERNAL
- iOS device testing requires Apple Developer account (awaiting approval per memory)

*Re-audit by Claude (Opus 4.7), 2026-05-14.*
