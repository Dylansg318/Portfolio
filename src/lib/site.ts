/** Single source of truth for identity + navigation. Edit here, not in components. */
export const site = {
  name: 'Dylan San Gabriel',
  /** Short form for the nav bar, where the full name is too wide on mobile. */
  shortName: 'Dylan',
  title: 'Dylan San Gabriel — Portfolio',
  tagline: 'I build the software that runs a dental supply company.',
  description:
    'Order intake across five sales channels, inventory sync, automated repricing, ' +
    'and the integrations that keep it all in agreement. Write-ups of what the ' +
    'problem actually was and what came out of solving it.',
  location: 'Chantilly, VA',

  /** Professional contact. The contact form is the primary route; this is the
   *  fallback for people who prefer their own mail client.
   *  NOTE: deliberately NOT the phone number or home address from the résumé —
   *  neither belongs on a public page. */
  email: 'dylansg0318@gmail.com',
  locale: 'en',

  /** Drop a PDF at public/resume.pdf and set this to '/resume.pdf' to show
   *  the button. Empty means the link is not rendered at all, rather than
   *  rendered and 404ing. */
  resumeUrl: '',

  links: {
    github: 'https://github.com/Dylansg318',
    linkedin: '', // TODO: paste the profile URL
  },

  nav: [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/about', label: 'About' },
  ],
} as const;
