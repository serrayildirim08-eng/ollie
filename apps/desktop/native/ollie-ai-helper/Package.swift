// swift-tools-version:6.0
//
// ollie-ai-helper — standalone macOS CLI that bridges Apple's on-device
// FoundationModels framework (macOS 26 Apple Intelligence) into Ollie's
// Electron desktop app.
//
// The Electron build is NOT Capacitor, so the iOS `OllieAI` Capacitor plugin
// cannot run there. This executable is the macOS-side equivalent: Electron's
// main process spawns it, writes one JSON request to STDIN, reads one JSON
// response from STDOUT (spawn-per-call). The FoundationModels logic is ported
// faithfully from apps/ios/ios/App/App/OllieAIPlugin.swift.
//
// Build (release):
//   swift build -c release --package-path apps/desktop/native/ollie-ai-helper
// Binary lands at:
//   apps/desktop/native/ollie-ai-helper/.build/release/ollie-ai-helper

import PackageDescription

let package = Package(
    name: "ollie-ai-helper",
    platforms: [
        .macOS(.v14),
    ],
    targets: [
        .executableTarget(
            name: "ollie-ai-helper",
            path: "Sources/ollie-ai-helper"
        ),
    ]
)
