// OllieAIPlugin.swift
//
// App-local Capacitor 7 plugin bridging Apple's on-device FoundationModels
// framework (iOS 26 Apple Intelligence) into Ollie's JS layer.
//
// JS plugin name: "OllieAI" — see apps/web/src/lib/ollie-ai.ts.
//
// Methods:
//   available()                       → { available: Bool, reason: String? }
//   route({ text, modules })          → { routes: [{ module, text, confidence }] }
//   extract({ text, kind })           → grocery: { items: [String] }
//                                       finance: { amount, currency, direction }
//   embedAvailable()                  → { available: Bool }
//   embed({ text })                   → { vector: [Double] }
//
// Two on-device tiers live in this one plugin:
//
//   1. FoundationModels (iOS 26+, Apple-Intelligence hardware only —
//      A17 Pro / M-series). Powers route()/extract(). Everything that
//      touches the framework is guarded by `#if canImport(FoundationModels)`
//      + `@available(iOS 26.0, *)` so the file still compiles on older SDKs
//      / the simulator — it just reports unavailable.
//
//   2. NLEmbedding (NaturalLanguage framework, iOS 13+, EVERY iPhone incl.
//      the A16 iPhone 15 Plus, fully offline). Powers embed()/embedAvailable().
//      This is NOT Apple Intelligence — it is the classic sentence-embedding
//      model and needs no special hardware. It is the PRIMARY routing tier
//      for devices that cannot run FoundationModels.
//
// Registration: bridge?.registerPluginInstance(...) in AppDelegate's
// capacitorDidLoad() override (see AppDelegate.swift). No CocoaPod needed —
// this is an app-local plugin.

import Foundation
import Capacitor
import NaturalLanguage

#if canImport(FoundationModels)
import FoundationModels
#endif

@objc(OllieAIPlugin)
public class OllieAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OllieAIPlugin"
    public let jsName = "OllieAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "route", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extract", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "embedAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "embed", returnType: CAPPluginReturnPromise),
    ]

    // ── available() ───────────────────────────────────────────────────────
    // Reports whether the on-device model can be used right now.
    @objc func available(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true])
            case .unavailable(let reason):
                call.resolve([
                    "available": false,
                    "reason": Self.reasonString(reason),
                ])
            @unknown default:
                call.resolve(["available": false, "reason": "unknown"])
            }
            return
        }
        #endif
        // Older OS, simulator, or SDK without FoundationModels.
        call.resolve(["available": false, "reason": "os-unsupported"])
    }

    // ── route() ───────────────────────────────────────────────────────────
    // Splits a brain-dump into its distinct thoughts and routes EACH one to a
    // caller-supplied module key (or "notebook" when nothing fits).
    @objc func route(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("missing 'text'")
            return
        }
        let modules = (call.getArray("modules", String.self)) ?? []
        guard !modules.isEmpty else {
            call.reject("missing 'modules'")
            return
        }

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else {
                call.reject("model-unavailable")
                return
            }
            Task {
                do {
                    let results = try await Self.runRoute(text: text, modules: modules)
                    let routes = results.map { item -> [String: Any] in
                        [
                            "module": item.module,
                            "text": item.text,
                            "confidence": item.confidence,
                        ]
                    }
                    call.resolve(["routes": routes])
                } catch {
                    call.reject("route-failed: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("model-unavailable")
    }

    // ── extract() ─────────────────────────────────────────────────────────
    // Pulls structured content out of a dump. kind = "grocery" | "finance".
    @objc func extract(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("missing 'text'")
            return
        }
        guard let kind = call.getString("kind") else {
            call.reject("missing 'kind'")
            return
        }

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else {
                call.reject("model-unavailable")
                return
            }
            Task {
                do {
                    switch kind {
                    case "grocery":
                        let items = try await Self.runGroceryExtract(text: text)
                        call.resolve(["items": items])
                    case "finance":
                        let fin = try await Self.runFinanceExtract(text: text)
                        var payload: [String: Any] = [:]
                        payload["amount"]    = fin.amount as Any? ?? NSNull()
                        payload["currency"]  = fin.currency as Any? ?? NSNull()
                        payload["direction"] = fin.direction as Any? ?? NSNull()
                        call.resolve(payload)
                    default:
                        call.reject("unknown kind: \(kind)")
                    }
                } catch {
                    call.reject("extract-failed: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("model-unavailable")
    }

    // ── embedAvailable() ──────────────────────────────────────────────────
    // Reports whether the on-device sentence-embedding model can be loaded.
    //
    // This is the NaturalLanguage framework's NLEmbedding — NOT Apple
    // Intelligence. It ships with iOS itself (iOS 13+) and works on EVERY
    // iPhone, including the A16 iPhone 15 Plus that cannot run
    // FoundationModels. The only realistic failure is the English sentence
    // model not being present on disk (extremely rare on a normal install).
    @objc func embedAvailable(_ call: CAPPluginCall) {
        let ok = NLEmbedding.sentenceEmbedding(for: .english) != nil
        call.resolve(["available": ok])
    }

    // ── embed() ───────────────────────────────────────────────────────────
    // Returns the on-device sentence-embedding vector for `text`.
    //
    // `vector(for:)` returns nil when the string is empty / out-of-vocabulary
    // for the model — callers treat a missing vector as "fall back".
    @objc func embed(_ call: CAPPluginCall) {
        guard let text = call.getString("text"),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("missing 'text'")
            return
        }
        guard let embedding = NLEmbedding.sentenceEmbedding(for: .english) else {
            call.reject("embedding-unavailable")
            return
        }
        // NLEmbedding is case/whitespace sensitive; lowercase + trim so the
        // exemplars and the dump are embedded under the same normalisation.
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let vector = embedding.vector(for: normalized) else {
            call.reject("no-vector")
            return
        }
        // [Double] crosses the Capacitor bridge as a JS number[].
        call.resolve(["vector": vector])
    }
}

// ─── FoundationModels implementation ─────────────────────────────────────────
//
// Isolated behind the canImport guard so the file compiles without the SDK.

#if canImport(FoundationModels)

@available(iOS 26.0, *)
extension OllieAIPlugin {

    static func reasonString(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .appleIntelligenceNotEnabled: return "apple-intelligence-not-enabled"
        case .deviceNotEligible:           return "device-not-eligible"
        case .modelNotReady:               return "model-not-ready"
        @unknown default:                  return "unknown"
        }
    }

    // ── routing ───────────────────────────────────────────────────────────

    /// One routed thought: the module it belongs to, the distinct extracted
    /// text, and a confidence score.
    @Generable
    struct RouteItem {
        @Guide(description: "The single module key this thought belongs to")
        let module: String

        @Guide(description: "A clean restatement of just this one distinct thought")
        let text: String

        @Guide(description: "Confidence from 0.0 to 1.0 that the module is correct")
        let confidence: Double
    }

    /// Guided-generation output shape for routing. The model is constrained
    /// to emit a LIST — one RouteItem per distinct thought in the brain-dump.
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

    static func runRoute(text: String, modules: [String]) async throws -> [RouteResult] {
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
            if Self.isGuardrailRejection(error) {
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
    static func isGuardrailRejection(_ error: Error) -> Bool {
        let desc = (error.localizedDescription + " " + String(describing: error)).lowercased()
        return desc.contains("unsafe")
            || desc.contains("guardrail")
            || desc.contains("safety")
    }

    // ── grocery extraction ────────────────────────────────────────────────

    @Generable
    struct GroceryItems {
        @Guide(description: "Each distinct food or grocery item named, lowercase, singular where natural")
        let items: [String]
    }

    static func runGroceryExtract(text: String) async throws -> [String] {
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

    // ── finance extraction ────────────────────────────────────────────────

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

    static func runFinanceExtract(text: String) async throws -> FinanceResult {
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
}

#endif
