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

  // The three ERP subsystems used to be top-level projects. They are now
  // children of MHLHUB and live under its path. Anything already linking to
  // the old URLs — a sent résumé, a search result, a message — must still land
  // on the write-up rather than a 404.
  redirects: {
    '/projects/repricer': '/projects/mhlhub/repricing',
    '/projects/channel-sync': '/projects/mhlhub/channel-sync',
    '/projects/quickbooks': '/projects/mhlhub/quickbooks',
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
    sitemap({ filter: (page) => !page.includes('/play/') }),
  ],

  fonts: [
    {
      // Body copy. This was Inter until 2026-09-01. Inter is the default face of
      // the AI/SaaS era — competent, and so ubiquitous that the page reads as a
      // template before a word of it is read. Plex was drawn for IBM, a company
      // that builds industrial systems, and it shows: squared terminals, a
      // mechanical rhythm, a distinctive `a` and `g`. This site is barcodes,
      // thermal printers, carrier invoices and a warehouse floor plan, so the
      // body face should read as the manual for a machine, not as a pitch deck.
      provider: fontProviders.fontsource(),
      name: 'IBM Plex Sans',
      cssVariable: '--font-sans',
      weights: [400, 500, 600, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      // Display face for headlines only — body copy is Plex Sans. Deliberately
      // kept when the body face changed: Bricolage is uncommon and is the one
      // place this site shows personality, so it was never the thing that made
      // the page look generic.
      provider: fontProviders.fontsource(),
      name: 'Bricolage Grotesque',
      cssVariable: '--font-display',
      weights: [600, 700, 800],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
    },
    {
      // Moved off JetBrains Mono with the body face, so code and prose come from
      // one superfamily and the page reads as a single system rather than an
      // assembly of tastes.
      provider: fontProviders.fontsource(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-mono',
      weights: [400, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'monospace'],
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
