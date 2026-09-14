import { defineEcConfig } from 'astro-expressive-code';

/**
 * Expressive Code options live here rather than in astro.config.mjs so the
 * <Code> component and the MDX integration read the same configuration.
 */
export default defineEcConfig({
  // The write-up body sits in the prose column, so its code blocks follow the
  // page's theme: light first (the base, and what no-JS and print get), dark
  // under the same `data-theme` attribute Base.astro sets. The dark response
  // column beside it is the site's own, not Expressive Code's, in both.
  themes: ['github-light-default', 'github-dark-default'],
  themeCssSelector: (theme) => `[data-theme='${theme.type}']`,
  useDarkModeMediaQuery: false,
  styleOverrides: {
    borderRadius: '6px',
    borderColor: 'var(--border)',
    codeFontFamily: 'var(--font-mono)',
    codeFontSize: '0.8125rem',
    codeBackground: 'var(--surface-raised)',
    frames: { shadowColor: 'transparent' },
  },
});
