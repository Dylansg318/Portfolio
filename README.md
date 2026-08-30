# Portfolio

Project write-ups and interactive demos. Astro 7, TypeScript, Tailwind 4,
deployed to Cloudflare Workers.

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

**In-repo (TypeScript/React/canvas)** — create `src/demos/<name>/index.tsx`
exporting a default component, then:

```yaml
demo: { kind: island, entry: <name> }
```

Copy the start-gate pattern from `src/demos/reflex/` — the island should render
a poster immediately and only begin expensive work (animation loop, audio,
WASM) after an explicit click, and it must honour `prefers-reduced-motion`.

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

Push to `main` → GitHub Actions typechecks, builds, and deploys via Wrangler.

Repository secrets required:

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
