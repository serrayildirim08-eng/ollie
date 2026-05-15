# marketing/site

astro static site for `ollie.app`. consumes the markdown files one level up (`marketing/privacy.md`, `marketing/terms.md`, `marketing/support.md`) and renders them as html pages.

---

## stack

- astro 5 (static)
- vanilla css (no tailwind, no css-in-js — per-page `<style>` scoping)
- one webfont family via google fonts (`display: swap`)
- no analytics, no cookies, no tracking
- prefers-color-scheme based dark mode

---

## local dev

```sh
cd marketing/site
pnpm install --ignore-workspace
pnpm dev
```

local server runs at `http://localhost:4321`.

> `--ignore-workspace` is used because the parent repo is a pnpm workspace; the marketing site is intentionally isolated so it can be deployed as its own vercel project.

## build

```sh
pnpm build      # outputs to dist/
pnpm preview    # serves dist/ at localhost:4321
```

> pnpm 11 verifies deps before every `run` and requires explicit approval for build scripts like `esbuild` and `sharp`. the project-level `pnpm-workspace.yaml` (sitting *inside* `marketing/site/`, not the parent repo's `pnpm-workspace.yaml`) sets `verifyDepsBeforeRun: false` and `ignoredBuiltDependencies: [esbuild, sharp]` to keep `pnpm build` non-interactive. astro itself does not need either script to run — esbuild ships prebuilt platform binaries and `sharp` is only used by `@astrojs/image`, which is not installed here.

## routes

| route | source |
|---|---|
| `/` | `src/pages/index.astro` — hero |
| `/about` | `src/pages/about.astro` — narrative |
| `/privacy` | `src/pages/privacy.astro` — imports `marketing/privacy.md` |
| `/terms` | `src/pages/terms.astro` — imports `marketing/terms.md` |
| `/support` | `src/pages/support.astro` — imports `marketing/support.md` |
| `/404` | `src/pages/404.astro` |

---

## how markdown rendering works

each legal page is a thin `.astro` wrapper around a direct markdown import. astro 5 exposes a `Content` component when you import a `.md` file, which renders the parsed markdown into the slot.

```astro
---
import { Content as PrivacyContent } from '../../../privacy.md';
---
<article class="prose">
  <PrivacyContent />
</article>
```

the `.prose` class on the parent applies all the editorial typography (defined in `src/layouts/BaseLayout.astro`). this keeps the markdown files themselves zero-config: edit `marketing/privacy.md` and the site rebuilds.

> we chose direct `.md` imports over astro's content collections because there are only three docs and they share no front-matter schema. if the marketing site grows to a blog / changelog with structured metadata, migrate to `src/content/` collections then.

---

## deploy to vercel

1. **push the branch** containing `marketing/site/` to github.
2. in vercel: **new project** → import the `serrayildirim08-eng/ollie` repo.
3. configure:
   - **root directory:** `marketing/site`
   - **framework preset:** astro (auto-detected)
   - **build command:** `pnpm build` (from `vercel.json`)
   - **output directory:** `dist` (from `vercel.json`)
   - **install command:** `pnpm install --ignore-workspace` (from `vercel.json`)
4. deploy. vercel returns a `*.vercel.app` preview url.

### custom domain (`ollie.app`)

in the vercel project → **settings → domains**:

1. add `ollie.app` (apex) and `www.ollie.app`.
2. vercel will print two records to add at your dns registrar:
   - **apex `ollie.app`** → `A` record → `76.76.21.21` (vercel's anycast ip)
   - **`www.ollie.app`** → `CNAME` → `cname.vercel-dns.com`
3. ssl is issued automatically once dns propagates (1 – 30 min).
4. set `www.ollie.app` to redirect to apex (or vice versa) in vercel's domain settings — pick one canonical.

> if the dns registrar does not support apex `A` records (some do not), use a registrar that supports `ALIAS` / `ANAME` flattening to point apex at `cname.vercel-dns.com`, or move dns to vercel/cloudflare.

---

## updating the legal docs

edit the markdown files **one level up** — `marketing/privacy.md`, `marketing/terms.md`, `marketing/support.md`. push. vercel rebuilds on commit.

remember to bump the `last updated:` date inside the markdown file when material changes ship; the app's privacy / terms commitments depend on that date being honest.

---

## what is intentionally missing

- no analytics (no ga, no plausible, no posthog) — privacy stance
- no marketing cookies, no banners
- no waitlist backend yet — the cta is a `mailto:support@ollie.app?subject=waitlist` link. real form is a follow-up.
- no cms layer
- no tailwind

---

## fonts

google fonts is loaded once per page (preconnect + stylesheet, `display: swap`):

- **dm serif display** — headlines, brand mark
- **dm mono** — small caps / meta / cta / nav
- **inter tight** — body

system fallbacks are listed in the css custom properties so the site is readable before web fonts load.

---

## lighthouse

astro static + minimal css + one webfont stylesheet should land 95+ across performance, a11y, best-practices, and seo. run `npx lighthouse https://ollie.app --view` after deploy to confirm.

---

## related

- `../README.md` — overview of the marketing dir + deployment options
- `../privacy.md` / `../terms.md` / `../support.md` — source of truth for the legal pages
