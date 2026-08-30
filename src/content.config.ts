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

    // --- the contract ------------------------------------------------
    /** What was actually wrong or needed. Not "I built an X". */
    problem: z.string(),
    /** What was non-obvious here. The judgement call, the constraint, the trick. */
    unique: z.string(),
    /** Concrete takeaways. Rendered as a consistent section on every project. */
    learned: z.array(z.string()).min(1),
    // -----------------------------------------------------------------

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
     *  island — source lives in src/demos/<entry>, mounted as an Astro island.
     *           Hot reload, TypeScript, shares the design tokens.
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
