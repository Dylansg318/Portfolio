/**
 * The shelves the work index sorts projects onto.
 *
 * The index used to filter by `stack`, which grew one chip per library until
 * the row was forty tags long and nobody could use it — a reader does not come
 * to a portfolio of eight projects looking for "Gherkin". A category is what
 * the thing IS, not what it was built with, so the row stays as short as the
 * number of kinds of work here and only grows when a new kind does.
 *
 * To add one: append to CATEGORIES, give it a label, and file a project under
 * it. The schema takes the id from this list, so a typo in frontmatter fails
 * the build, and a category with nothing filed under it never renders a tab.
 *
 * This module imports nothing so `content.config.ts` can import it — the
 * content layer cannot load `astro:content`, which is why the labels do not
 * live in `lib/content.ts` with the rest.
 */
export const CATEGORIES = ['work', 'tool', 'game'] as const;

export type Category = (typeof CATEGORIES)[number];

/** The tab text. Plural where the shelf holds things, singular for the mass noun. */
export const categoryLabel: Record<Category, string> = {
  work: 'Work',
  tool: 'Tools',
  game: 'Games',
};
