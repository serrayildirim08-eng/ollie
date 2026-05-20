// main.swift
//
// ollie-ai-helper — macOS CLI bridging Apple's on-device FoundationModels
// framework (macOS 26 Apple Intelligence) into Ollie's Electron desktop app.
//
// This is the macOS-side equivalent of the iOS `OllieAI` Capacitor plugin
// (apps/ios/ios/App/App/OllieAIPlugin.swift). The Electron build loads the
// web bundle and is NOT Capacitor, so that plugin cannot run there — instead
// Electron's main process spawns this executable.
//
// Protocol — STDIN → STDOUT, one invocation = one request (spawn-per-call):
//
//   Request (JSON on STDIN):
//     {"cmd":"available"}
//     {"cmd":"route","text":"...","modules":["finance","grocery",...]}
//     {"cmd":"extract","text":"...","kind":"grocery"|"finance"}
//
//   Response (JSON on STDOUT):
//     available → {"available":bool,"reason":string?}
//     route     → {"routes":[{"module":string,"text":string,"confidence":number}, ...]}
//     extract grocery → {"items":[string]}
//     extract finance → {"amount":number|null,"currency":string|null,"direction":string|null}
//     any failure     → {"error":"..."}  (also exits non-zero)
//
// The FoundationModels usage — the `@Generable` structs RouteList /
// GroceryItems / FinanceFacts and the prompt strings — is ported VERBATIM
// from OllieAIPlugin.swift, with `@available` adjusted from iOS 26 to
// macOS 26. Everything that touches the framework is guarded by
// `#if canImport(FoundationModels)` + `@available(macOS 26.0, *)` so the
// file still compiles on toolchains without the SDK (it then reports
// unavailable, exactly like the iOS plugin's simulator path).
//
// A persistent JSON-RPC loop (one process serving many requests) is a noted
// future optimisation — for now each call spawns a fresh process.
//
// The file is structured as a `@main` async entry point so the
// FoundationModels `async` calls are awaited directly — no semaphore /
// cross-actor bridging, which Swift 6 strict concurrency rejects.

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

// ─── I/O helpers ─────────────────────────────────────────────────────────────

/// Write a JSON object to STDOUT and exit with the given status.
/// Used for both success payloads (status 0) and `{"error":...}` (non-zero).
func emit(_ object: [String: Any], exit code: Int32) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: []) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a])) // trailing newline
    }
    exit(code)
}

/// Emit an `{"error":...}` payload and exit non-zero. Mirrors the iOS
/// plugin's `call.reject(...)` failure path.
func fail(_ message: String) -> Never {
    emit(["error": message], exit: 1)
}

/// Emit a success payload and exit 0.
func ok(_ object: [String: Any]) -> Never {
    emit(object, exit: 0)
}

/// Simple typed error so a bad `kind` carries a clean message to the caller.
struct HelperError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

// ─── entry point ─────────────────────────────────────────────────────────────

@main
struct OllieAIHelper {
    static func main() async {
        let stdinData = FileHandle.standardInput.readDataToEndOfFile()
        guard !stdinData.isEmpty else { fail("empty-request") }

        guard
            let parsed = try? JSONSerialization.jsonObject(with: stdinData, options: []),
            let request = parsed as? [String: Any]
        else {
            fail("invalid-json")
        }

        guard let cmd = request["cmd"] as? String else {
            fail("missing 'cmd'")
        }

        switch cmd {
        case "available":
            await runAvailable()

        case "route":
            guard let text = request["text"] as? String, !text.isEmpty else {
                fail("missing 'text'")
            }
            let modules = (request["modules"] as? [Any])?.compactMap { $0 as? String } ?? []
            guard !modules.isEmpty else {
                fail("missing 'modules'")
            }
            await runRouteCommand(text: text, modules: modules)

        case "extract":
            guard let text = request["text"] as? String, !text.isEmpty else {
                fail("missing 'text'")
            }
            guard let kind = request["kind"] as? String else {
                fail("missing 'kind'")
            }
            await runExtractCommand(text: text, kind: kind)

        default:
            fail("unknown cmd: \(cmd)")
        }
    }
}

// ─── available ───────────────────────────────────────────────────────────────
// Reports whether the on-device model can be used right now. Mirrors the
// iOS plugin's `available(_:)`.

func runAvailable() async -> Never {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
            ok(["available": true])
        case .unavailable(let reason):
            ok(["available": false, "reason": reasonString(reason)])
        @unknown default:
            ok(["available": false, "reason": "unknown"])
        }
    }
    #endif
    // Older OS or a toolchain without FoundationModels.
    ok(["available": false, "reason": "os-unsupported"])
}

// ─── route ───────────────────────────────────────────────────────────────────
// Splits a brain-dump into its distinct thoughts and routes EACH one to a
// caller-supplied module key (or "notebook" when nothing fits). Mirrors the
// iOS plugin's `route(_:)`.

func runRouteCommand(text: String, modules: [String]) async -> Never {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        guard case .available = SystemLanguageModel.default.availability else {
            fail("model-unavailable")
        }
        do {
            let results = try await runRoute(text: text, modules: modules)
            let routes = results.map { item -> [String: Any] in
                ["module": item.module, "text": item.text, "confidence": item.confidence]
            }
            ok(["routes": routes])
        } catch {
            fail("route-failed: \(error.localizedDescription)")
        }
    }
    #endif
    fail("model-unavailable")
}

// ─── extract ─────────────────────────────────────────────────────────────────
// Pulls structured content out of a dump. kind = "grocery" | "finance".
// Mirrors the iOS plugin's `extract(_:)`.

func runExtractCommand(text: String, kind: String) async -> Never {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        guard case .available = SystemLanguageModel.default.availability else {
            fail("model-unavailable")
        }
        do {
            switch kind {
            case "grocery":
                let items = try await runGroceryExtract(text: text)
                ok(["items": items])
            case "finance":
                let fin = try await runFinanceExtract(text: text)
                ok([
                    "amount": fin.amount as Any? ?? NSNull(),
                    "currency": fin.currency as Any? ?? NSNull(),
                    "direction": fin.direction as Any? ?? NSNull(),
                ])
            default:
                fail("unknown kind: \(kind)")
            }
        } catch {
            fail("extract-failed: \(error.localizedDescription)")
        }
    }
    #endif
    fail("model-unavailable")
}

// ─── FoundationModels implementation ─────────────────────────────────────────
//
// Isolated behind the canImport guard so the file compiles without the SDK.
// Ported VERBATIM from OllieAIPlugin.swift's FoundationModels extension —
// only the `@available` is adjusted from iOS 26.0 to macOS 26.0.

#if canImport(FoundationModels)

@available(macOS 26.0, *)
func reasonString(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .appleIntelligenceNotEnabled: return "apple-intelligence-not-enabled"
    case .deviceNotEligible:           return "device-not-eligible"
    case .modelNotReady:               return "model-not-ready"
    @unknown default:                  return "unknown"
    }
}

// ── routing ───────────────────────────────────────────────────────────────

/// One routed thought: the module it belongs to, the distinct extracted
/// text, and a confidence score.
@available(macOS 26.0, *)
@Generable
struct RouteItem {
    @Guide(description: "The single module key this thought belongs to")
    let module: String

    @Guide(description: "A clean restatement of just this one distinct thought")
    let text: String

    @Guide(description: "Confidence from 0.0 to 1.0 that the module is correct")
    let confidence: Double
}

/// Guided-generation output shape for routing. The model is constrained to
/// emit a LIST — one RouteItem per distinct thought in the brain-dump.
@available(macOS 26.0, *)
@Generable
struct RouteList {
    @Guide(description: "One entry per distinct thought found in the brain-dump")
    let items: [RouteItem]
}

struct RouteResult {
    let module: String
    let text: String
    let confidence: Double
}

@available(macOS 26.0, *)
func runRoute(text: String, modules: [String]) async throws -> [RouteResult] {
    // Build an allow-list including the "notebook" fallback so the model
    // always has a valid escape hatch.
    var allowed = modules
    if !allowed.contains("notebook") { allowed.append("notebook") }
    let list = allowed.joined(separator: ", ")

    // Primary instructions. A concise, DISTINCT cue for every routable
    // module — derived from MODULE_EXEMPLARS in apps/web/src/lib/ollie-ai.ts
    // so the FoundationModels router agrees with the NLEmbedding tier — plus
    // a few worked examples so the model is decisive instead of guessing.
    let instructions = """
    You route a personal-organizer "brain dump". The dump MAY contain \
    several distinct thoughts, usually separated by commas or "and". \
    Split it into every separate thought, then route EACH to ONE module \
    from this exact list: \(list). Return exactly one item per thought, \
    in input order — never drop, merge, or skip a thought; a four-thought \
    dump returns four items.

    Module guide (left = the module key, right = what belongs there):
    grocery — food/household items still TO BUY: milk, bread, eggs, pasta.
    finance — money: spent, paid, cost, a price, bills, rent, salary, income.
    work — a job task, project, work deadline, work meeting, feature to ship.
    goals — a long-term goal, ambition, or milestone over months/years.
    habits — a recurring daily habit/routine to keep up: exercise, reading.
    sleep — sleep itself: slept well/badly, bedtime, waking, tired, rested.
    cycle — the monthly cycle tracker.
    health — only how the body actually feels: a symptom, or taking \
    medicine. Booking or calling a clinic is NOT health — it is admin.
    body — movement and the physical body: weight, measurements, a workout.
    pets — anything about a pet: feeding, the vet, walks, grooming, supplies.
    admin — boring life chores: paperwork, forms, renewals, errands, and \
    every phone call or appointment to make or book — this includes \
    calling or booking the dentist, the doctor, or the plumber.
    astrology — horoscope, moon phase, zodiac signs.

    Decision rules — apply in order, first match wins:
    1. Anything about a pet → pets (a vet appointment for the dog is pets).
    2. Anything about a night's sleep — slept well, slept badly, bedtime, \
    waking up, tired, rested → sleep.
    3. A phone call or appointment to make — "call the dentist", "book \
    the doctor", "schedule the plumber" → admin. The chore is the call, \
    so it is admin even though a clinic is named; it is NOT health.
    4. "spent/paid/cost <money>" → finance, even when spent on food.
    5. An item still to buy → grocery.
    Examples:
    "paid 60 for gas, book the dentist, get bread" → finance, admin, grocery.
    "renew passport, walk the dog, slept poorly" → admin, pets, sleep.

    Be decisive — a clear thought gets confidence 0.8+. Use "notebook" \
    only for a thought that fits no module, never as a lazy default.
    For each thought return: the exact module key, a clean restatement of \
    just that thought, and a confidence between 0 and 1.
    FINAL CHECK before answering: count the comma- or "and"-separated \
    thoughts in the dump, and make sure your answer has exactly that many \
    items — including the very last thought. Do not stop early.
    """

    // Compact fallback instructions. The on-device safety guardrail can
    // reject the rich prompt above for some borderline dumps (it scores the
    // instructions + dump together, and a long prompt tips marginal inputs
    // over the threshold). This bare prompt has no cues at all — routing is
    // less accurate — but it reliably clears the guardrail, so it is used
    // ONLY as a last resort on a guardrail rejection (see the retry below):
    // a degraded route still beats a hard failure into the keyword router.
    let fallbackInstructions = """
    You route a brain dump. Split into thoughts. Route each to one module \
    from: \(list).
    """

    /// Run one guided routing pass with the given instructions.
    func attempt(_ ins: String) async throws -> RouteList {
        let session = LanguageModelSession(instructions: ins)
        return try await session.respond(
            to: Prompt(text),
            generating: RouteList.self,
            includeSchemaInPrompt: true
        ).content
    }

    // Try the rich prompt; on a guardrail rejection retry once with the
    // compact prompt, which is far less likely to trip the safety filter.
    let content: RouteList
    do {
        content = try await attempt(instructions)
    } catch {
        if isGuardrailRejection(error) {
            content = try await attempt(fallbackInstructions)
        } else {
            throw error
        }
    }

    // Defend, PER ITEM, against the model returning an off-list key: snap to
    // the closest allowed key, else fall back to "notebook". Clamp confidence.
    // Drop items with no usable text.
    return content.items.compactMap { item -> RouteResult? in
        let cleaned = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        let picked = allowed.first { $0.caseInsensitiveCompare(item.module) == .orderedSame }
            ?? "notebook"
        let confidence = min(max(item.confidence, 0.0), 1.0)
        return RouteResult(module: picked, text: cleaned, confidence: confidence)
    }
}

/// True when a FoundationModels error is the on-device safety guardrail
/// firing ("Detected content likely to be unsafe" / guardrailViolation),
/// as opposed to a real failure. Matched on the description so it works
/// regardless of the concrete error type the SDK surfaces.
func isGuardrailRejection(_ error: Error) -> Bool {
    let desc = (error.localizedDescription + " " + String(describing: error)).lowercased()
    return desc.contains("unsafe")
        || desc.contains("guardrail")
        || desc.contains("safety")
}

// ── grocery extraction ────────────────────────────────────────────────────

@available(macOS 26.0, *)
@Generable
struct GroceryItems {
    @Guide(description: "Each distinct food or grocery item named, lowercase, singular where natural")
    let items: [String]
}

@available(macOS 26.0, *)
func runGroceryExtract(text: String) async throws -> [String] {
    let instructions = """
    You extract grocery items from a short note. Return every distinct \
    food or household-shopping item the user mentions. Do not include \
    verbs, quantities, or filler words — just the item names.
    Example: "i bought groceries: pasta, tomato" → ["pasta", "tomato"].
    """
    let session = LanguageModelSession(instructions: instructions)
    let response = try await session.respond(
        to: Prompt(text),
        generating: GroceryItems.self,
        includeSchemaInPrompt: true
    )
    return response.content.items
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
}

// ── finance extraction ────────────────────────────────────────────────────

@available(macOS 26.0, *)
@Generable
struct FinanceFacts {
    @Guide(description: "The monetary amount as a number, or null if none is stated")
    let amount: Double?

    @Guide(description: "ISO-4217 currency code such as USD or EUR, or null if not stated")
    let currency: String?

    @Guide(.anyOf(["income", "expense"]))
    let direction: String
}

struct FinanceResult {
    let amount: Double?
    let currency: String?
    let direction: String?
}

@available(macOS 26.0, *)
func runFinanceExtract(text: String) async throws -> FinanceResult {
    let instructions = """
    You extract one money fact from a short note.
    - amount: the numeric value mentioned (e.g. 1900), or null.
    - currency: the ISO-4217 code (USD, EUR, GBP, TRY, ...). "usd"/"dollars" → USD. Null if unstated.
    - direction: "income" if the user RECEIVES money (gets paid, salary, \
    refund, deposit); "expense" if the user SPENDS money (bought, paid, \
    bill, rent).
    Example: "i'll get paid 1900 usd by end of month" → \
    amount 1900, currency USD, direction income.
    """
    let session = LanguageModelSession(instructions: instructions)
    let response = try await session.respond(
        to: Prompt(text),
        generating: FinanceFacts.self,
        includeSchemaInPrompt: true
    )
    let f = response.content
    let dir: String? = (f.direction == "income" || f.direction == "expense") ? f.direction : nil
    let currency = f.currency?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    return FinanceResult(
        amount: f.amount,
        currency: (currency?.isEmpty == false) ? currency : nil,
        direction: dir
    )
}

#endif
