import { OGImageRoute } from 'astro-og-canvas';
import { site } from '../../lib/site';
import { getAllProjects } from '../../lib/content';

/**
 * Generated social preview images. Without these, a link to this site pasted
 * into LinkedIn or Slack renders as a bare grey box.
 */
// Every published page gets a card, subsystems included — they have their own
// URLs, so a link to one would otherwise paste as a grey box.
const projects = await getAllProjects();

const pages: Record<string, { title: string; description: string }> = Object.fromEntries(
  projects.map((p) => [`projects/${p.id}`, { title: p.data.title, description: p.data.blurb }]),
);

// Fallback card for the home page and anything without its own.
pages['default'] = { title: site.name, description: site.tagline };

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page: { title: string; description: string }) => ({
    title: page.title,
    description: page.description,
    padding: 70,
    // Graphite ground with a lime edge — the dark theme's own palette, where
    // the only colour on the card is the accent stripe.
    bgGradient: [
      [22, 24, 28],
      [36, 40, 46],
    ],
    border: { color: [181, 228, 140], width: 12, side: 'inline-start' },
    font: {
      title: { size: 64, weight: 'Bold', color: [255, 255, 255] },
      description: { size: 30, color: [180, 188, 198], lineHeight: 1.4 },
    },
  }),
});
