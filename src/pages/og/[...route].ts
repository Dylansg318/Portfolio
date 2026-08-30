import { OGImageRoute } from 'astro-og-canvas';
import { site } from '../../lib/site';
import { getProjects } from '../../lib/content';

/**
 * Generated social preview images. Without these, a link to this site pasted
 * into LinkedIn or Slack renders as a bare grey box.
 */
// Same helper as every other surface, so drafts never get an OG card either.
const projects = await getProjects();

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
    // Meadow Green — the same ocean ground and lime accent as the dark theme.
    bgGradient: [
      [7, 28, 39],
      [20, 72, 106],
    ],
    border: { color: [181, 228, 140], width: 12, side: 'inline-start' },
    font: {
      title: { size: 64, weight: 'Bold', color: [255, 255, 255] },
      description: { size: 30, color: [169, 204, 217], lineHeight: 1.4 },
    },
  }),
});
