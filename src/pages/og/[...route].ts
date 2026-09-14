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
    // The prose column's own palette: white ground, navy title, and the one
    // accent as a stripe on the inline-start edge — the card is the page.
    bgGradient: [
      [255, 255, 255],
      [246, 248, 250],
    ],
    border: { color: [94, 86, 251], width: 12, side: 'inline-start' },
    // Vendored rather than fetched. Left to itself this library pulls Noto Sans
    // from api.fontsource.org at BUILD time — a face used nowhere else on the
    // site, over a network call that has already failed a deploy with ECONNRESET.
    // These two files are in the repo, so the build touches no third party and
    // the cards are set in the same face as the pages they advertise.
    fonts: ['./src/fonts/source-sans-3-700.ttf', './src/fonts/source-sans-3-400.ttf'],
    font: {
      title: {
        size: 64,
        weight: 'Bold',
        families: ['Source Sans 3'],
        color: [10, 37, 64],
      },
      description: {
        size: 30,
        families: ['Source Sans 3'],
        color: [66, 84, 102],
        lineHeight: 1.4,
      },
    },
  }),
});
