import { defineEcConfig } from 'astro-expressive-code';

/**
 * Expressive Code options live here rather than in astro.config.mjs because the
 * <Code> component needs them JSON-serializable, and `themeCssSelector` is a
 * function. Astro's build fails with a clear error if you get this wrong.
 */
export default defineEcConfig({
  themes: ['github-dark-default', 'github-light-default'],
  // Match the site's own data-theme attribute so code blocks follow the toggle.
  themeCssSelector: (theme) => `[data-theme="${theme.type}"]`,
  styleOverrides: {
    borderRadius: '0.5rem',
    codeFontFamily: 'var(--font-mono)',
  },
});
