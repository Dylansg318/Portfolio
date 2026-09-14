// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import tailwindcss from '@tailwindcss/vite';

// Change this when a real domain is attached. It feeds sitemap, RSS and OG image URLs.
// `||` not `??` on purpose: CI sets SITE_URL to an EMPTY STRING when the repo
// variable is unset, and '' is not nullish — so `??` kept it and the build died
// with "Invalid URL".
const SITE = process.env.SITE_URL || 'https://portfolio.dylansg0318.workers.dev';

export default defineConfig({
  site: SITE,

  // Clean URLs with no trailing slash. Astro's default emits
  // /projects/index.html, which Cloudflare serves at /projects/ and 307s
  // /projects onto — so every internal link cost a redirect round-trip.
  // `format: 'file'` emits /projects.html instead, and the assets handler is
  // told to drop the slash, so the links the site emits resolve directly.
  trailingSlash: 'never',
  build: { format: 'file' },

  // Moved URLs never die. The three ERP subsystems used to be top-level
  // projects and now live under the ERP's path; the ERP itself was renamed on
  // 2026-09-14 (its product name meant nothing to a reader and was one more
  // identifying detail in a public repo). Anything already linking to an old
  // URL — a sent résumé, a search result, a message — must still land on the
  // write-up rather than a 404. Each subsystem is listed by hand: Astro only
  // accepts a dynamic redirect whose destination is itself a route pattern,
  // and the write-ups render from one `/projects/[...slug]` route.
  redirects: {
    '/projects/mhlhub': '/projects/internal-erp',
    '/projects/mhlhub/repricing': '/projects/internal-erp/repricing',
    '/projects/mhlhub/channel-sync': '/projects/internal-erp/channel-sync',
    '/projects/mhlhub/inventory': '/projects/internal-erp/inventory',
    '/projects/mhlhub/printing': '/projects/internal-erp/printing',
    '/projects/mhlhub/quickbooks': '/projects/internal-erp/quickbooks',
    '/projects/mhlhub/toolbox': '/projects/internal-erp/toolbox',
    '/projects/repricer': '/projects/internal-erp/repricing',
    '/projects/channel-sync': '/projects/internal-erp/channel-sync',
    '/projects/quickbooks': '/projects/internal-erp/quickbooks',
  },

  // Everything prerenders by default. Only routes that explicitly opt out
  // (`export const prerender = false`) invoke the Worker at request time.
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
    // Prerender in Node, not workerd. Prerendered pages become static files
    // that never execute in the Worker, so there is nothing to gain from
    // building them in the edge sandbox — and workerd forbids runtime WASM,
    // which breaks Shiki's highlighter and the OG image canvas.
    prerenderEnvironment: 'node',
  }),

  integrations: [
    // expressiveCode MUST come before mdx — it registers the code-block renderer
    // that mdx then uses. Its options live in ec.config.mjs (see that file).
    expressiveCode(),
    mdx(),
    // No filter. `/play/<slug>` used to be excluded — it was a fullscreen
    // projection of the write-up and had no business competing with it in
    // search. It is now a shareable destination in its own right, so it is
    // indexed and listed like any other page.
    sitemap(),
  ],

  fonts: [
    {
      // The one text face, for prose and headings alike. Source Sans was drawn
      // for user interfaces and documentation and it reads that way: open
      // counters, a plain italic, no display personality to spend. Headings
      // are the same face, heavier. The site is an API reference now; a
      // reference does not pair a display face with its body.
      provider: fontProviders.fontsource(),
      name: 'Source Sans 3',
      cssVariable: '--font-sans',
      weights: [400, 600, 700],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    {
      // Paths, keys, numbers, the console and every code block. JetBrains
      // Mono is what most engineers already read code in, which is the point.
      provider: fontProviders.fontsource(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      weights: [400, 500, 600],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    },
  ],

  image: {
    responsiveStyles: true,
    layout: 'constrained',
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
