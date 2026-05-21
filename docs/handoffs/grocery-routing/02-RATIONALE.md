# SortedToast · rationale

**Why this design is what it is. One page. Read once, then trust the spec.**

## the core decision

Color does not carry the success signal. **Typography position** does. A serif item name above a hairline rule means "going to the shop." Below the rule means "already in the pantry." The two ticks — sage and umber — are corroborators, not the message. If the user is colorblind, the toast still reads correctly. If a screenshot is grayscale, the toast still reads correctly. This is the Ollie editorial rule and it survives every state.

## why a "receipt" instead of a "snackbar"

A snackbar tells you a thing happened. A receipt tells you **what was understood**. Grocery routing is a moment of small trust — the AI made a call about your sentence, and the user wants to see the call written out, not get a thumbs-up. The serif + small-caps + qty layout reads like a transaction record because that *is* the metaphor. Aesop's paper bag tickets, Apartamento's caption blocks, Bluebook citation footers — all carry the same DNA: "the system has noted this."

## why no progress ring, no countdown bar

A 3.5s auto-dismiss communicated by a depleting ring would scream SaaS. The toast simply sits, then leaves with a 200ms `translateY(4px) + fade`. The user does not need to watch a timer. If they want to undo, they tap. If they don't, the receipt is gone. (See: Linear toast, the anti-reference — its countdown ring is the precise loudness we are avoiding.)

## why the recipe expansion is the hero state

State 4 — recipe split across shop and pantry — is the case that justifies the whole AI. A keyword router cannot do this. When the user types "pasta with garlic, parsley, lemon," the AI's job is to know that olive oil and salt are already in the pantry, and that spaghetti + garlic + parsley + lemon need to be bought. The toast must show this *as a menu*, not as a list, because it is the only moment the user sees the AI doing real work. The italic serif lede ("from 'pasta with garlic, parsley, lemon'") is the byline of that work.

## why the cache-miss pending state is a 2px sweep, not a spinner

A spinner says "the app is busy." The PendingHair sweep says "we are reading your sentence." It is the difference between a loading wheel and a librarian's finger moving along a shelf. 2px (not 6px) keeps it editorial; the sage gradient (not blue, not gray) keeps it Ollie; the 1400ms calm-out ease keeps it patient. When the LLM resolves, the rail fades and the rows arrive — there is no "done!" moment, the receipt simply completes itself.

## why fallback (keyword) has a muted tick instead of a banner

When the AI didn't run — embeddings cache disabled, user opted out of necessary cache, network down — the worst design would be to tell the user "AI is off, we used keywords." That breaks trust by drawing attention to the failure. The right design is the *quiet* state: same layout, same flow, only the tick is `--ink-faint` instead of `--accent`. A reader who knows what the green tick means will see its absence. Everyone else gets a functional receipt. This is exactly what the Atelier DNA's "color never carries information" principle exists for.

## why state 9 (error) does not use red

Ollie's `--pink` (#B86A8A) is reserved for crisis path labels. `--warn` (#C9974C) is for tier-3 push insistence. Neither belongs on a grocery toast. A timeout is not an emergency; it is a polite "we could not sort this." The error state uses ink-faint dash glyph, sentence-case copy, and a quiet underline link to the inbox. The user is not punished for the AI's slowness.

## why we don't use a global toast provider

Ollie has no global toast queue. Building one for this single surface would invite every other module to import it and lose discipline. The SortedToast lives inside the dump composer's success branch — it knows about its one cause and dismisses cleanly. If a second dump comes through while one is up, the old toast dismisses in 150ms; the new one enters. No stacking. No queue. One receipt at a time, the way one transaction at a time happens.

## what we deliberately did not do

- no "Submit" / "Sorted!" / "Success" copy — all banned by DNA
- no green checkmark in a circle — every other app does that; we are not every other app
- no emoji (groceries do not need a 🛒)
- no undo button styled as a CTA — undo is a text-link footer, the same weight as the meta
- no drop shadow heavier than `--sh-md` — already the project ceiling
- no Tailwind utility classes in the spec — the prod component uses the `tokens.css` variables directly, the preview uses inline CSS for portability; frontend-senior gets to choose between CSS modules and inline styles when wiring it in
- no expanding accordion of "see all items" — overflow is a single mono whisper, not an interaction

## the one rule for future drift

If a junior touches this toast and adds a "Success!" badge, a green pill, a confetti burst, a colored progress ring, or an undo button styled as a CTA — revert it. The toast is finished. Future iterations are about *removing* things from it, not adding them.
