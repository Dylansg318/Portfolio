/** Single source of truth for identity + navigation. Edit here, not in components. */
export const site = {
  name: 'Dylan',
  title: 'Dylan — Portfolio',
  tagline: 'I build systems that run real businesses.',
  description:
    'Projects, write-ups and interactive demos — what the problem was, what was non-obvious about the solution, and what came out of it.',
  email: 'you@example.com', // TODO: replace before launch
  locale: 'en',

  links: {
    github: 'https://github.com/Dylansg318',
    linkedin: '',
  },

  nav: [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/about', label: 'About' },
  ],
} as const;
