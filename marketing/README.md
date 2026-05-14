# marketing/

legal + support pages for the ollie marketing site (`ollie.app`).

these documents are app-store-required. the in-app `SettingsScreen.tsx` links to:

- `https://ollie.app/privacy`
- `https://ollie.app/terms`
- `https://ollie.app/support` (planned)

apple's review will follow the privacy link before accepting the binary, so these urls must resolve to live html pages with the disclosures listed below.

---

## files

| file | purpose |
|---|---|
| `privacy.md` | privacy policy. covers module data, brain dumps, research opt-in, pii scrub, third parties (plaid, sentry, anthropic, supabase, bigdatacloud, open-meteo), encryption, consent model, gdpr + ccpa rights, breach notification. ~1,900 words. |
| `terms.md` | terms of service. covers account, content ownership, research participation license, permitted + prohibited uses, warranty disclaimer, liability limits, deletion, governing law (TBD). ~1,600 words. |
| `support.md` | support / help-center surface. email contact, response sla, crisis disclaimer, what support can't do. ~500 words. |

---

## TBD placeholders requiring serra's input

before publishing:

1. **legal entity name + jurisdiction + registered address** (privacy.md + terms.md)
2. **governing law** for terms of service — turkey or delaware usa, based on entity choice
3. **postal mailing address** tied to the entity
4. **research partner names** — currently "TBD until first agreement signed"; the wording commits to in-app + email notice before any partner receives data
5. **public issue tracker link** for support.md known issues
6. **community link** for support.md (discord? matrix? github discussions? none decided)

search the docs for `[TBD:` to find every placeholder.

---

## deployment

these docs are markdown. they need to be served as html under `ollie.app/{privacy,terms,support}`. three viable paths:

### option a — astro on vercel (recommended)

- create `marketing/site/` astro project
- import these three .md files as routes (`src/pages/privacy.md`, etc.)
- deploy to vercel; point `ollie.app` dns at vercel
- free tier covers this volume
- adds proper home page later without rework

est: 2-3 hours for initial deploy.

### option b — github pages

- enable github pages on the `serrayildirim08-eng/ollie` repo, source = `/marketing` on a deploy branch
- jekyll renders the .md automatically
- cname file points `ollie.app` at github pages

est: 1 hour. simpler but harder to extend to a real homepage.

### option c — no-code (framer / webflow)

- paste markdown into framer or webflow pages
- fastest path to live html
- harder to update from this repo, drifts over time

est: 1-2 days but no dev work.

### recommendation

**astro on vercel.** keeps the docs versioned in this repo, deploys on push, leaves room for the homepage + about + faq once tier 2 work starts.

---

## update flow

when these docs change:

1. update the `last updated:` date at the top of the affected file
2. if the change is material (new third-party processor, new data category, new license, new prohibited use, new dispute clause), trigger an in-app notice; the privacy policy and terms of service both commit to this
3. commit + push; deployment auto-rebuilds

---

## related references

- audits/AUDIT_marketing.md — full marketing audit, including app store blockers and B2B pivot impact
- apps/web/src/pages/SettingsScreen.tsx — hard-coded urls under `PRIVACY_URL` / `TERMS_URL`
- packages/consent — two-toggle consent implementation referenced in privacy.md
- packages/pii-scrub — scrubbing module referenced in privacy.md
- packages/research-stream + packages/orchestrator/src/research.ts — research corpus pipeline
