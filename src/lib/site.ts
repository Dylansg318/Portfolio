/** Single source of truth for identity + navigation. Edit here, not in components. */
export const site = {
  name: 'Dylan',
  title: 'Dylan — Portfolio',
  tagline: 'I build systems that run real businesses.',
  description:
    'Projects, write-ups and interactive demos — what the problem was, what was non-obvious about the solution, and what came out of it.',
  email: 'you@example.com', // TODO: replace before launch
  locale: 'en',

  /** Drop a PDF at public/resume.pdf and set this to '/resume.pdf' to show
   *  the button. Empty means the link is not rendered at all, rather than
   *  rendered and 404ing. */
  resumeUrl: '',

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
