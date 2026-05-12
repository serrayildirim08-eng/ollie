// OllieIntents.swift
// Sprint 4 · E3 — Hey Siri / SiriKit App Intents.
//
// Three intents:
//   "Hey Siri, Ollie capture"     → open the app with mic ready
//   "Hey Siri, Ollie remind"      → open the admin reminder draft
//   "Hey Siri, Ollie what's due"  → open the dashboard upcoming
//
// Each intent triggers a `ollie://…` URL scheme open. The web layer
// (apps/web/src/lib/capacitor-deeplink.ts) listens for `appUrlOpen`
// via Capacitor and routes accordingly.
//
// Deployment target must be iOS 16+ (default in Capacitor 7).

import AppIntents
import UIKit

@available(iOS 16.0, *)
struct OllieCaptureIntent: AppIntent {
  static var title: LocalizedStringResource = "Ollie capture"
  static var description = IntentDescription("open ollie ready to record")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    if let url = URL(string: "ollie://capture") {
      await MainActor.run { UIApplication.shared.open(url) }
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct OllieRemindIntent: AppIntent {
  static var title: LocalizedStringResource = "Ollie remind"
  static var description = IntentDescription("open ollie ready to set a reminder")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    if let url = URL(string: "ollie://admin?action=remind") {
      await MainActor.run { UIApplication.shared.open(url) }
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct OllieDueIntent: AppIntent {
  static var title: LocalizedStringResource = "Ollie what's due"
  static var description = IntentDescription("open the dashboard's upcoming view")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    if let url = URL(string: "ollie://dashboard?focus=upcoming") {
      await MainActor.run { UIApplication.shared.open(url) }
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct OllieShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: OllieCaptureIntent(),
      phrases: [
        "\(.applicationName) capture",
        "capture in \(.applicationName)",
        "start \(.applicationName)",
      ],
      shortTitle: "Capture",
      systemImageName: "mic.fill"
    )
    AppShortcut(
      intent: OllieRemindIntent(),
      phrases: [
        "\(.applicationName) remind",
        "set a reminder in \(.applicationName)",
      ],
      shortTitle: "Remind",
      systemImageName: "bell.fill"
    )
    AppShortcut(
      intent: OllieDueIntent(),
      phrases: [
        "\(.applicationName) what's due",
        "what's due in \(.applicationName)",
      ],
      shortTitle: "What's due",
      systemImageName: "calendar"
    )
  }
}
