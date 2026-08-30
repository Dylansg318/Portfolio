import { getCollection, type CollectionEntry } from 'astro:content';
import type { ProjectData } from '../content.config';

/**
 * Astro's generated `CollectionEntry` types `data` as `any` in this project
 * (its ContentConfig inference does not resolve), so the frontmatter type is
 * grafted back on from the schema's own exported type. Everything else about
 * the entry — id, body, and compatibility with `render()` — is unchanged.
 */
export type Project = Omit<CollectionEntry<'projects'>, 'data'> & {
  data: ProjectData;
};

/**
 * The ONE query every surface uses.
 *
 * Draft filtering has to gate route generation too, not just the listing —
 * otherwise a draft is hidden from the index but still live at its own URL for
 * anyone with the link (and for search engines). Both `getStaticPaths` and the
 * index call this same function, so the exclusion cannot drift apart.
 *
 * Drafts stay visible in `astro dev` so you can write and preview them.
 */
export async function getProjects(): Promise<Project[]> {
  const all = (await getCollection('projects', ({ data }: { data: ProjectData }) =>
    import.meta.env.PROD ? data.draft !== true : true,
  )) as Project[];

  return all.sort((a, b) => {
    if (b.data.featured !== a.data.featured) {
      return b.data.featured - a.data.featured;
    }
    return b.data.date.getTime() - a.data.date.getTime();
  });
}

/** Previous/next for in-page navigation, honouring the same ordering + filter. */
export async function getProjectNeighbours(id: string) {
  const projects = await getProjects();
  const i = projects.findIndex((p) => p.id === id);
  if (i === -1) return { prev: undefined, next: undefined };
  return {
    prev: projects[i - 1],
    next: projects[i + 1],
  };
}

/** Deterministic cover gradient for projects without cover art. */
export function coverGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  const a = h;
  const b = (h + 48) % 360;
  return `linear-gradient(135deg, oklch(0.62 0.14 ${a}), oklch(0.52 0.16 ${b}))`;
}

export const statusLabel: Record<Project['data']['status'], string> = {
  live: 'Live',
  archived: 'Archived',
  wip: 'In progress',
};
