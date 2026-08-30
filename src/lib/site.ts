/** Single source of truth for identity, navigation and the facts the pages
 *  quote. Edit here, not in components — every number below appears in more
 *  than one place. */
export const site = {
  name: 'Dylan San Gabriel',
  /** Short form for the nav bar, where the full name is too wide on mobile. */
  shortName: 'Dylan',
  title: 'Dylan San Gabriel — Software Engineer',
  role: 'Software engineer · Operations Technology Manager',
  tagline: 'I build the software that runs a dental supply company.',
  description:
    'Order intake across six sales channels, inventory sync, automated repricing, ' +
    'shipping, and the integrations that keep it all in agreement — about 500 orders ' +
    'a day, 32,000 products, one codebase. Write-ups of what the problem actually was ' +
    'and what came out of solving it.',
  location: 'Chantilly, VA',
  timezone: 'US Eastern',

  /** Shown as a pill in the hero. Empty string hides it. */
  availability: 'Open to backend / full-stack roles',

  /** Professional contact. The contact form is the primary route; this is the
   *  fallback for people who prefer their own mail client.
   *  NOTE: deliberately NOT the phone number or home address from the résumé —
   *  neither belongs on a public page. */
  email: 'dylansg0318@gmail.com',
  locale: 'en',

  /** The web résumé. A PDF can sit next to it at public/resume.pdf — see
   *  src/pages/resume.astro for the print button. */
  resumeUrl: '/resume',

  links: {
    github: 'https://github.com/Dylansg318',
    linkedin: '', // TODO: paste the profile URL and it appears in the footer + hero
  },

  nav: [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Work' },
    { href: '/about', label: 'About' },
    { href: '/resume', label: 'Résumé' },
  ],

  /** The numbers a recruiter should see in the first ten seconds. Measured on
   *  the production database on 2026-08-30; update the date when you update
   *  the numbers. */
  stats: [
    { value: '~520', label: 'orders a day', note: 'up from ~270 when I started' },
    { value: '32K', label: 'products', note: '49K channel listings' },
    { value: '6', label: 'sales channels', note: 'Net32 · eBay · Amazon · Shopify · Walmart · direct' },
    { value: '180', label: 'scheduled jobs', note: 'repricing, syncs, carrier polls, books' },
  ],
  statsAsOf: 'August 2026',

  /** Skills grouped the way a hiring manager scans them. Order inside each row
   *  is "most used first", not alphabetical. */
  skills: [
    {
      group: 'Languages',
      items: ['TypeScript', 'JavaScript', 'SQL', 'Python', 'Java'],
    },
    {
      group: 'Backend & data',
      items: ['Node.js', 'Express', 'PostgreSQL', 'REST APIs', 'Flask', 'JDBC / Oracle / MySQL'],
    },
    {
      group: 'Frontend',
      items: ['React', 'Tailwind CSS', 'Astro', 'Vite'],
    },
    {
      group: 'Integrations',
      items: ['QuickBooks Desktop', 'eBay', 'Amazon SP-API', 'Shopify', 'Walmart', 'USPS / UPS / FedEx', 'Gmail API'],
    },
    {
      group: 'Testing',
      items: ['Jest', 'Selenium', 'Cucumber / Gherkin', 'REST Assured', 'JUnit / TestNG', 'PyTest', 'Postman'],
    },
    {
      group: 'Ops & tooling',
      items: ['GitHub Actions', 'Docker', 'Railway', 'Cloudflare Workers', 'Jenkins', 'Jira', 'Claude Code'],
    },
  ],

  /** Reverse-chronological. `summary` is one sentence a recruiter can skim;
   *  `bullets` are for the résumé page. */
  experience: [
    {
      title: 'Operations Technology Manager',
      org: 'RMH3 Dental Supply',
      place: 'Chantilly, VA',
      start: 'Jun 2025',
      end: 'Present',
      summary:
        'Built and run MHLHUB, the internal ERP that replaced SellerCloud, spreadsheets and Gmail triage for a six-channel dental distributor.',
      bullets: [
        'Designed and shipped the ERP the business runs on: order intake from six channels, inventory and lots, shipping labels, customer service, returns, and QuickBooks integration — one PostgreSQL database, ~180 scheduled jobs.',
        'Daily orders roughly doubled (≈270 → ≈520/day) on a 32,000-product catalog without adding ops headcount.',
        'Replaced a morning repricing spreadsheet with a repricing engine that runs every minute per product/vendor with cooldowns and a tiered strategy — 138,000+ logged price pushes.',
        'Integrated QuickBooks Desktop, eBay, Amazon, Shopify, Walmart, Net32 and three carriers, storing every raw payload so new fields never require a re-fetch.',
        'Ran a fleet of parallel AI coding sessions against one repo with hooks and a coordination layer that made the unsafe operations impossible instead of discouraged.',
      ],
    },
    {
      title: 'Head Server',
      org: 'The Qui, Korean BBQ & Grill',
      place: 'Fairfax, VA',
      start: 'Aug 2022',
      end: 'Jun 2025',
      summary:
        'Ran front-of-house and trained staff; promoted twice within months. Studied for the SDET bootcamp on the side.',
      bullets: [
        'Managed front-of-house operations and server training while completing the CYDEO SDET program.',
      ],
    },
    {
      title: 'Store Manager',
      org: 'Wireless Vision (T-Mobile)',
      place: 'Vienna, VA',
      start: 'Jan 2020',
      end: 'Aug 2022',
      summary:
        'Promoted from associate to store manager inside a year; beat performance targets by 30% with perfect customer-satisfaction scores.',
      bullets: [
        'Owned the whole store: opening, closing, staffing, cash and inventory.',
        'Exceeded organisational and individual targets by 30% for multiple months; raised customer satisfaction from 8.0/10 to 10/10.',
      ],
    },
  ],

  education: [
    {
      title: 'SDET Bootcamp',
      org: 'CYDEO',
      place: 'Tysons, VA',
      when: 'Feb – Oct 2024',
      detail:
        'Selenium WebDriver, Cucumber/Gherkin BDD, REST Assured, JDBC, Jenkins CI, Agile-Scrum. Team project automating an Odoo ERP.',
    },
    {
      title: 'B.S. Computer Science',
      org: 'George Mason University',
      place: 'Fairfax, VA',
      when: '2020 – 2024',
      detail: "Dean's List. Object-oriented programming, game design, essentials of CS.",
    },
  ],

  certifications: [
    { name: 'Programming using JavaScript', issuer: 'Certiport', id: '57SR-4Tp8' },
    { name: 'Programming using Python', issuer: 'Certiport', id: 'uadx-XMRJ' },
  ],

  /** How I work — three things, in my own words. */
  principles: [
    {
      title: 'Subtly wrong is worse than obviously broken.',
      body:
        'A page that crashes gets fixed the same day. A number that is plausibly wrong gets trusted for a month. I design for the second case: hard filters, ledgers with evidence, and jobs that fail loudly rather than report success while doing nothing.',
    },
    {
      title: 'The app is the work, not a view of it.',
      body:
        'If someone has to export to a spreadsheet to finish their job, the feature is not done. Every screen I build is where the task actually happens — the order gets shipped there, the return gets decided there.',
    },
    {
      title: 'Store the raw thing, parse it after.',
      body:
        'Every external payload — a carrier invoice, an eBay order, a QuickBooks response — gets stored as received before it gets interpreted. When the question changes later, the answer is already in the database instead of behind a vendor API that has since expired the data.',
    },
  ],
} as const;
