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
const byRank = (a: Project, b: Project) =>
  b.data.featured !== a.data.featured
    ? b.data.featured - a.data.featured
    : b.data.date.getTime() - a.data.date.getTime();

/**
 * EVERY published project, parents and subsystems alike.
 *
 * Route generation and OG cards use this: a subsystem is hidden from listings,
 * not from the site, and a page with no social card is a grey box in Slack.
 */
export async function getAllProjects(): Promise<Project[]> {
  const all = (await getCollection('projects', ({ data }: { data: ProjectData }) =>
    import.meta.env.PROD ? data.draft !== true : true,
  )) as Project[];

  return all.sort(byRank);
}

/**
 * THE ONE QUERY EVERY LISTING USES — top-level projects only.
 *
 * Subsystems (`parent` set) are deliberately absent. They are reached from
 * their parent's page, which is the whole point of nesting them: the listing
 * should say how many distinct pieces of work there are, not how many files.
 */
export async function getProjects(): Promise<Project[]> {
  return (await getAllProjects()).filter((p) => !p.data.parent);
}

/** The subsystems of one project, in the same order a listing would use. */
export async function getChildren(id: string): Promise<Project[]> {
  return (await getAllProjects()).filter((p) => p.data.parent === id);
}

/**
 * Previous/next for in-page navigation.
 *
 * Neighbours are drawn from the page's OWN set: a subsystem steps to its
 * sibling subsystems, a top-level project to other top-level projects. Mixing
 * them would walk a reader out of the ERP mid-tour with no way to tell they
 * had left it.
 */
export async function getProjectNeighbours(id: string) {
  const all = await getAllProjects();
  const self = all.find((p) => p.id === id);
  const siblings = all.filter((p) => (p.data.parent ?? null) === (self?.data.parent ?? null));

  const i = siblings.findIndex((p) => p.id === id);
  if (i === -1) return { prev: undefined, next: undefined };
  return {
    prev: siblings[i - 1],
    next: siblings[i + 1],
  };
}

/** Deterministic cover art for projects without a real image. CARDS ONLY —
 *  a thumbnail slot has to hold something. The project page deliberately shows
 *  nothing rather than a full-width slab.
 *  Hues are clamped into the Meadow palette's range (green → teal → blue,
 *  ~140-260 in oklch) so a hash can never land on a clashing red, and the
 *  chroma is kept low so a grid of these reads as muted art on the grey
 *  ground rather than a row of neon tiles. */
export function coverGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  const a = 140 + (h % 120);
  const b = a + 40;
  return `linear-gradient(135deg, oklch(0.55 0.055 ${a}), oklch(0.42 0.07 ${b}))`;
}

export const statusLabel: Record<Project['data']['status'], string> = {
  live: 'Live',
  archived: 'Archived',
  wip: 'In progress',
};
