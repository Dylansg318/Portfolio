# Portfolio

Project write-ups and interactive demos. Astro 7, TypeScript, Tailwind 4,
deployed to Cloudflare Workers.

**Live:** <https://portfolio.dylansg0318.workers.dev>

Two things live in here. `src/` is the site itself. [`code/`](code/) is a
separate tree of thirteen sanitized excerpts from the production ERP and the
agent-fleet tooling the write-ups describe — barcode grammar, thermal-print
layout, a self-updating device agent, carrier-invoice parsers, the session-lock
layer. Readable excerpts, not installable packages; each folder has its own
README. Identifiers, fixtures, endpoints and customer data were replaced, and
the tree was copied out clean rather than pruned from a private repo, because
git history keeps everything ever committed.

## Run it

```bash
npm install
npm run dev          # http://localhost:4321
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server, hot reload, drafts visible |
| `npm run build` | Production build + Pagefind search index |
| `npm run check` | TypeScript + Astro diagnostics (CI gate) |
| `npm run cf:dev` | Run the built site in the real Workers runtime |
| `npm run cf:dry` | Verify deploy wiring without deploying |
| `npm run cf:deploy` | Deploy to Cloudflare |

## Adding a project

Create `src/content/projects/<slug>/index.mdx`. The frontmatter is enforced by
a schema — **`problem`, `unique` and `learned` are required**, and the build
fails without them. That is deliberate: it keeps every write-up answering the
same three questions in the same places.

```yaml
---
title: Thing I Built
blurb: One sentence, max 160 characters. Used on cards and as the meta description.
date: 2026-08-30
status: live            # live | archived | wip
stack: [TypeScript, Postgres]

problem: What was actually wrong or needed. Not "I built an X".
unique: What was non-obvious — the judgement call, the constraint, the trick.
learned:
  - At least one concrete takeaway.

# optional
role: solo
featured: 10            # higher sorts first on the index
metrics:
  - { label: orders/day, value: "1,200" }
links:
  source: https://github.com/...    # omit entirely for private/NDA work
  live: https://...
draft: false            # true = visible in dev, excluded from the built site
---
```

### Components available inside MDX

| Component | Use |
|---|---|
| `<Demo demo={frontmatter.demo} />` | Mount the project's interactive demo |
| `<CodeFile src="slug/snippets/x.ts" lines="4-18" />` | Render a **real file** from disk, highlighted |
| `<Video provider="youtube" id="..." title="..." />` | Externally-hosted video, loads on click |
| `<Figure src={img} alt="..." caption="..." />` | Optimised image with caption |
| `<Takeaway>…</Takeaway>` | Pull-quote for a lesson worth interrupting for |

## Adding a demo or game

Two lanes, chosen by frontmatter. Adding one does not require touching any
component.

**In-repo (TypeScript / canvas / WebGL)** — create `src/demos/<name>/index.ts`
exporting `mount(el: HTMLElement): () => void`, then:

```yaml
demo: { kind: island, entry: <name> }
```

Copy the start-gate pattern from `src/demos/reflex/` — mount should be cheap
and only begin expensive work (animation loop, audio, WASM) after an explicit
click, and it must honour `prefers-reduced-motion`. Return a cleanup function
that stops every timer it started.

> Demo entries must be `.ts`, not `.tsx`. A JSX entry is transformed by
> `@vitejs/plugin-react`, which injects a Fast Refresh guard that throws unless
> Astro has put a React preamble in the page — and Astro only does that for
> `client:*` islands it can see statically. A dynamic import is invisible to it,
> so a `.tsx` demo dies in `astro dev` with "can't detect preamble". No
> framework is needed here anyway; a game loop is not React-shaped.

**Prebuilt engine export (Godot / Unity / Phaser)** — drop the export in
`public/demos/<slug>/`, then:

```yaml
demo: { kind: iframe, src: /demos/<slug>/index.html, aspect: "16 / 9" }
```

It runs in a sandboxed iframe injected on click, so the bundle never enters this
site's build graph and never loads for someone who only came to read.

> Cloudflare caps a single static asset at **25 MiB**. Large engine builds need
> chunking or an external origin.

## Media rules

- **Never commit video.** GitHub rejects files over 100 MB; Cloudflare caps
  assets at 25 MiB. Host externally and use `<Video>`. `.gitignore` blocks
  `*.mp4/mov/webm` to make this hard to get wrong by accident.
- **Code samples use `<CodeFile>`**, which reads the real file at build time, so
  a sample can't drift from the code it describes.

## Design

All colour, spacing and motion tokens live in `src/styles/global.css`. Every
component references semantic names (`bg-surface`, `text-ink`, `border-border`),
never a literal colour — so a redesign is one file, and dark mode already works.

## Deploying

**Pushing to `main` deploys.** GitHub Actions builds and ships every push — free
since the repo went public, because GitHub doesn't bill standard runners on public
repositories. Nothing prompts and nothing confirms: `git push` is the deploy button.

For what a push can't express — a non-`main` ref, a redeploy with no new commit,
gates run locally before pushing, or shipping while Actions is degraded:

```bash
./scripts/deploy-from-mac.sh
```

It resolves `origin/main`, asks for confirmation, builds that commit in a clean
worktree inside a `linux/arm64` container, deploys with Wrangler, and checks the
live URL answers 200. Useful flags: `--build-only` (gates only, never touches the
live site), `--amd64` (exact CI parity, ~2.3x slower), `--yes`, `--ref <ref>`.

Timed four ways, which is why the default is arm64 rather than the exact-parity
amd64 that was planned:

| | time | |
|---|---|---|
| macOS native, no container | 19s | wrong OS, case-insensitive |
| **linux/arm64 container** | **81s** | default |
| linux/amd64 via Rosetta | 189s | exact CI parity |
| GitHub-hosted ubuntu x64 | 84s | what this replaces |

arm64 matches GitHub's own wall-clock for free. Every arch-specific package here
is a build-time tool — what ships to Cloudflare is JS and WASM — so amd64 buys
parity in a dimension the artifact doesn't have.

Two things it does deliberately, both easy to "fix" and break:

- **It never sets `SITE_URL`.** `astro.config.mjs` falls back to the workers.dev
  host when that variable is empty, and the repo variable is unset — so that
  fallback is what every shipped build has used. Setting it would silently change
  every canonical URL and the sitemap.
- **It builds in Linux, not on macOS.** This Mac's filesystem is case-insensitive
  and Cloudflare's is not, so a miscased import or asset path builds fine here and
  404s in production. The container is what still catches that.

Credentials come from the login keychain at run time — never from a file. The
Passwords app can't be read by the `security` CLI (it lives in the iCloud
keychain), so these are separate items:

```bash
security add-generic-password -U -s portfolio-cf-token   -a CF_Token   -w
security add-generic-password -U -s portfolio-cf-account -a CF_Account -w
```

The first read pops a macOS dialog — choose "Always Allow".

### Why the script still exists

Deploys moved off Actions in Aug 2026 because they cost ~480 minutes a month
against a 2,000 allowance — billing rounds **up to a whole minute per job**, so a
50-second build cost a full one. Going public on 2026-09-01 removed the charge
entirely (GitHub doesn't bill standard runners on public repos; measured on this
repo's own runs, `billable.UBUNTU` is 0ms), so `push` went back on.

The script stays because a push can only ever ship `main` exactly as pushed. It
still owns `--build-only`, `--ref`, redeploying without a new commit, and the case
where Actions itself is the thing that's broken.

The Linux VM is its own colima profile, `portfolio`. MHLHUB's break-glass script
reuses whatever VM is already running, so sharing `default` would let one project
silently resize the other's.

Repository secrets, used by every CI deploy:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Worker secrets for the contact form (`wrangler secret put <NAME>`):

- `RESEND_API_KEY` — email delivery
- `TURNSTILE_SECRET` — spam check
- `CONTACT_TO` — destination address

Without them the contact endpoint accepts and logs rather than failing at a
visitor. Copy `.dev.vars.example` to `.dev.vars` for local testing.

## Architecture notes

- **`output: 'static'`** — every page prerenders. Only `/api/contact` sets
  `prerender = false`, so static delivery stays free and unlimited.
- **`prerenderEnvironment: 'node'`** — prerendering in workerd forbids runtime
  WASM, which breaks Shiki's highlighter and OG image generation. Prerendered
  pages never execute in the Worker, so there is nothing to gain from building
  them in the edge sandbox.
- **`ProjectData` is exported from `src/content.config.ts`** rather than relying
  on Astro's `InferEntrySchema`, whose `typeof import(...)` chain resolves to
  `any` here and silently removes type safety from every consumer.
- **Expressive Code options live in `ec.config.mjs`**, not `astro.config.mjs` —
  the `<Code>` component requires them JSON-serializable.
