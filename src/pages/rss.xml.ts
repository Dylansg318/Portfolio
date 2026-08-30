import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { site } from '../lib/site';
import { getProjects } from '../lib/content';

export async function GET(context: APIContext) {
  const projects = await getProjects();
  return rss({
    title: site.title,
    description: site.description,
    site: context.site!,
    items: projects.map((p) => ({
      title: p.data.title,
      description: p.data.blurb,
      pubDate: p.data.date,
      link: `/projects/${p.id}/`,
    })),
  });
}
