import { defineCollection, type SchemaContext } from 'astro/content/config';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * THE NARRATIVE CONTRACT
 *
 * `problem`, `unique` and `learned` are REQUIRED. A project write-up that does
 * not say what the problem was, what was non-obvious about the approach, and
 * what came out of it will fail the build rather than publish half-finished.
 *
 * That is deliberate. It is the difference between a portfolio that lists
 * technologies and one that shows judgement — and it makes the site's
 * consistency structural instead of something to remember every time.
 */
const projectSchema = ({ image }: SchemaContext) =>
  z.object({
    title: z.string(),
    /** One sentence. Used on cards AND as the page meta description. */
    blurb: z.string().max(160),
    date: z.coerce.date(),
    /** Optional — cards fall back to a deterministic generated cover. */
    cover: image().optional(),
    coverAlt: z.string().optional(),
    /** Manual ordering on the index; higher sorts first, then by date. */
    featured: z.number().default(0),

    /**
     * The id of the project this one is a part of, if any.
     *
     * A project with a parent is a SUBSYSTEM: it keeps its own full write-up
     * and its own URL, but it never appears in a top-level listing — it is
     * reached through its parent's page instead. Five sibling cards describing
     * one codebase read as "this person has had one job"; one system with
     * named parts reads as a system. The nesting is real, not cosmetic: the
     * file lives at <parent>/<slug>/index.mdx, so the id and the URL say the
     * same thing the listing does.
     */
    parent: z.string().optional(),

    // --- the contract ------------------------------------------------
    /** What was actually wrong or needed. Not "I built an X". */
    problem: z.string(),
    /** What was non-obvious here. The judgement call, the constraint, the trick. */
    unique: z.string(),
    /** Concrete takeaways. Rendered as a consistent section on every project. */
    learned: z.array(z.string()).min(1),
    // -----------------------------------------------------------------

    /**
     * Where AI tooling fit in — and, just as important, where it didn't.
     * Rendered in the same place on every project. Hiring managers in 2026
     * assume AI was used; what they screen for is whether the author can say
     * what they decided, verified and threw away. Optional, but every real
     * write-up here fills it in.
     */
    aiNote: z.string().optional(),

    /**
     * The blurb again, but for the Plain English mode — no jargon, business
     * terms only. Cards fall back to `blurb` when this is absent.
     */
    plainBlurb: z.string().max(200).optional(),

    stack: z.array(z.string()).min(1),
    /** e.g. "solo", "led 3 devs", "contributor" */
    role: z.string().optional(),
    status: z.enum(['live', 'archived', 'wip']),
    /** Hard numbers beat adjectives. [{label:'orders/day', value:'1,200'}] */
    metrics: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .default([]),

    links: z
      .object({
        /** Omit for private / NDA work — the UI simply won't render a link. */
        source: z.url().optional(),
        live: z.url().optional(),
        writeup: z.url().optional(),
      })
      .default({}),

    /**
     * How this project's interactive demo is delivered, if it has one.
     *
     *  none   — write-up only
     *  island — src/demos/<entry>/index.ts exporting `mount(el) => cleanup`.
     *           Framework-free by contract: canvas, WebGL, plain DOM, or bring
     *           your own library. Must be .ts, never .tsx — see Demo.astro.
     *  iframe — a prebuilt engine export (Godot/Unity/Phaser) under
     *           public/demos/<slug>/, run in a sandboxed iframe so a 40MB
     *           WASM bundle never enters this site's build graph.
     *
     * Adding a game later is a frontmatter change, not an architecture change.
     */
    demo: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        z.object({
          kind: z.literal('island'),
          entry: z.string(),
          label: z.string().default('Launch demo'),
          fullscreen: z.boolean().default(true),
        }),
        z.object({
          kind: z.literal('iframe'),
          src: z.string(),
          label: z.string().default('Launch demo'),
          aspect: z.string().default('16 / 9'),
          fullscreen: z.boolean().default(true),
          /**
           * Grant the frame the camera. Off by default — a game has no
           * business asking — and opt-in per demo rather than per lane, so
           * the sandbox stays least-privilege for everything else.
           */
          camera: z.boolean().default(false),
        }),
      ])
      .default({ kind: 'none' }),

    /** Write in the open repo without publishing. Excluded from all listings. */
    draft: z.boolean().default(false),
  });

/**
 * The project frontmatter type, exported explicitly.
 *
 * Astro generates `InferEntrySchema` from a `typeof import(...)` of this file,
 * but that chain resolves to `any` here — which silently removes type safety
 * from every consumer. Publishing the type directly is both a fix and better
 * documentation: `ProjectData` is greppable, this inference is not.
 */
export type ProjectData = z.infer<ReturnType<typeof projectSchema>>;

const projects = defineCollection({
  loader: glob({ pattern: '**/index.mdx', base: './src/content/projects' }),
  schema: projectSchema,
});

// Extension point: a short-form `notes` / devlog collection drops in here with
// the same shape minus the contract fields. Left out until there is content
// for it — an empty collection is just a build warning.

export const collections = { projects };
