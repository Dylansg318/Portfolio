// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import tailwindcss from '@tailwindcss/vite';

// Change this when a real domain is attached. It feeds sitemap, RSS and OG image URLs.
const SITE = process.env.SITE_URL ?? 'https://portfolio.dylansg.workers.dev';

export default defineConfig({
  site: SITE,

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
    react(),
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
