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
      provider: fontProviders.fontsource(),
      name: 'Inter',
      cssVariable: '--font-sans',
      weights: [400, 500, 600, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      // Display face for headlines only — body copy stays in Inter.
      provider: fontProviders.fontsource(),
      name: 'Bricolage Grotesque',
      cssVariable: '--font-display',
      weights: [600, 700, 800],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Inter', 'system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'JetBrains Mono',
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
