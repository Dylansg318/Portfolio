import { defineEcConfig } from 'astro-expressive-code';

/**
 * Expressive Code options live here rather than in astro.config.mjs so the
 * <Code> component and the MDX integration read the same configuration.
 */
export default defineEcConfig({
  // One theme: the write-up body sits in the light prose column, so its code
  // blocks are light too. The dark response column beside it is the site's
  // own, not Expressive Code's.
  themes: ['github-light-default'],
  styleOverrides: {
    borderRadius: '6px',
    borderColor: 'var(--border)',
    codeFontFamily: 'var(--font-mono)',
    codeFontSize: '0.8125rem',
    codeBackground: 'var(--surface-raised)',
    frames: { shadowColor: 'transparent' },
  },
});
