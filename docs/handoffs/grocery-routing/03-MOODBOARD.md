# SortedToast · moodboard

**Six anchors. Each has a `borrow this` and a `don't borrow that` note. Look at all six before opening the spec.**

## 1 · Aesop receipt cards
- **borrow**: warm cream stock, single hairline rule, serif product name above smcp meta, no logo on the receipt itself
- **don't borrow**: the brown ink — we use ink (#14140F), not sepia; sepia would slide into "vintage pastiche" which the DNA forbids

## 2 · *Cabana* magazine bylines
- **borrow**: italic serif lede ("from 'pasta with garlic, parsley, lemon'") as a quiet byline above the structured block; the *implication* that the next block was authored, not generated
- **don't borrow**: Cabana's flourished drop caps and ornament — too theatrical for a 3.5s receipt; save drop caps for the dump composer hero, not this surface

## 3 · Bluebook citation footers
- **borrow**: the discipline of "supra at" and "infra at" — meta-data sits as small mono at the foot of the citation, not as a header; this is exactly where `via gemini · 410ms` belongs
- **don't borrow**: the legal density; we strip Bluebook of its abbreviation system and keep only the *spatial* rule (meta at foot, never crown)

## 4 · Apartamento photo captions
- **borrow**: the small-caps + italic combo, set tight against the image edge, never centered; tiny, considered, low-volume
- **don't borrow**: Apartamento's full-bleed layouts and color photography pulling focus — the toast is content-as-content, no image, no bleed

## 5 · Kinfolk product receipts (e.g. the Norm Architects + Kinfolk shop)
- **borrow**: the discipline of one font family per role — display serif, system sans, ui mono — and the refusal to mix in a fourth
- **don't borrow**: Kinfolk's tendency toward extreme whitespace at the cost of legibility; our toast lives in 16/20px padding, not 80px

## 6 · the existing Ollie `receipt-fadein` keyframe (`apps/web/src/design/animations.css` line 149)
- **borrow**: this is the same motion language the dump composer already uses for its inline confirmation receipt — the SortedToast is its *louder cousin* (still quiet, just one tier up the rhetorical ladder)
- **don't borrow**: don't make it the same component; the inline receipt is for "got it" moments, the SortedToast is for "here is what was understood" moments. Different rhetorical job, same motion family.

---

## the anti-references (do not even glance at these for inspiration)

- Linear toast — the depleting timer ring, the tilted card, the green check, the close-X in the corner
- Vercel toast — confetti on success, the gradient sweep, the bold sans header
- iOS native banner — the rounded corners, the iconography slot, the "Slide down for more" affordance
- Material snackbar — the elevated card, the all-caps text button labeled "UNDO"
- Discord toast — the slide-in-from-bottom-right, the colored side-bar, the dismiss timer

If a fixture starts to look like any of the above, you are off the path. Re-read the rationale.
