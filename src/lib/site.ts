/** Single source of truth for identity, navigation and the facts the pages
 *  quote. Edit here, not in components — every number below appears in more
 *  than one place. */
export const site = {
  name: 'Dylan San Gabriel',
  /** Short form for the nav bar, where the full name is too wide on mobile. */
  shortName: 'Dylan',
  title: 'Dylan San Gabriel — Software Engineer',
  role: 'Software engineer · Operations Technology Manager',
  /** Descriptive, not a claim. Feeds /about's meta description and the default
   *  OG card, both of which are read by people who have not met me. */
  tagline:
    'Software engineer in Northern Virginia. Builds and runs the ERP a dental distributor operates on.',
  description:
    'Order intake across six sales channels, inventory sync, automated repricing, ' +
    'shipping, and the integrations that keep it all in agreement. About 500 orders ' +
    'a day, 32,000 products, one codebase. Write-ups of what the problem actually was ' +
    'and what came out of solving it.',
  location: 'Chantilly, VA',
  timezone: 'US Eastern',

  /** The nameplate sentence is assembled from these, not hard-coded in the
   *  page, so the one place that states where I work is also the only place
   *  that has to change when that stops being true. */
  employer: {
    name: 'RMH3 Dental Supply',
    kind: 'a family-run dental distributor',
    site: 'https://rmh3dental.com',
  },

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

  /** Empty string hides the link EVERYWHERE. Every surface guards on these, so
   *  turning one back on is a one-line change here, not a hunt through pages.
   *
   *  github stays off until there is a repo worth opening: the public profile is
   *  two repos, one of them empty, because the real work is private or in the
   *  company's org, and a link from "I built the ERP a distributor runs on" to an
   *  empty account subtracts credibility rather than adding it.
   *
   *  The calculus is tighter now than it was. With the degree line corrected to
   *  coursework, and the ERP behind a private repo, public code is the only
   *  remaining third-party evidence that this person can build. One real,
   *  reusable repo turns this on; an empty profile still does not. */
  links: {
    github: '', // ON once there is one real public repo — https://github.com/Dylansg318
    linkedin: 'https://www.linkedin.com/in/dylan-san-gabriel/',
  },

  nav: [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Work' },
    { href: '/about', label: 'About' },
    { href: '/resume', label: 'Resume' },
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
      items: ['GitHub Actions', 'Docker', 'Railway', 'Harness', 'Cloudflare Workers', 'Jenkins', 'Jira', 'Claude Code'],
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
        'The only engineer at a family-run dental distributor. Built and run MHLHUB, the in-house ERP that replaced off-the-shelf software, spreadsheets and inbox triage across six sales channels.',
      bullets: [
        'Only engineer on the team, and the one who makes it safe for people who are not engineers to ship: the owner directs AI agents at product and catalog work, and I own the backend, the environments (Shopify, Railway, GitHub, Harness) and the guardrails that decide what is allowed to land.',
        'Designed and shipped the ERP the business runs on: order intake from six channels, inventory and lots, shipping labels, customer service, returns, and QuickBooks integration — ~1.4M lines across 6,000 files, 2,449 HTTP endpoints, 636 tables, 1,226 migrations, 2,721 automated tests and ~180 scheduled jobs on one PostgreSQL database.',
        'Daily orders roughly doubled (≈270 → ≈520/day) on a 32,000-product catalog without adding ops headcount.',
        'Replaced a morning repricing spreadsheet with a repricing engine that runs every minute per product/vendor with cooldowns and a tiered strategy, with 138,000+ logged price pushes so far.',
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
        'Ran front-of-house and trained staff. Promoted twice within months. Studied for the SDET bootcamp on the side.',
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
        'Promoted from associate to store manager inside a year. Beat performance targets by 30% with perfect customer-satisfaction scores.',
      bullets: [
        'Owned the whole store: opening, closing, staffing, cash and inventory.',
        'Exceeded organisational and individual targets by 30% for multiple months. Raised customer satisfaction from 8.0/10 to 10/10.',
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
        'Java, UI test automation (Selenium, Cucumber/Gherkin), API testing (REST Assured), \
SQL and database testing, Git and Jenkins. Two ten-person sprint teams automating live web \
applications end to end: BriteERP by hand, then TryCloud with Selenium and Cucumber. Retains \
alumni access to CYDEO\'s current AI QA Engineer curriculum.',
    },
    {
      /** Coursework, not a conferred degree, and said plainly. Degree claims
       *  are verified by routine background checks; a credential a check can
       *  disprove costs far more than the credential was ever worth. */
      title: 'Computer Science coursework',
      org: 'George Mason University',
      place: 'Fairfax, VA',
      when: '2020 – 2024',
      detail:
        "Dean's List. Object-oriented programming, game design, essentials of CS. \
Coursework only — I left before the degree was conferred.",
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
        "A page that crashes gets fixed the same day. A number that's plausibly wrong gets trusted for a month. I build for the second case.",
    },
    {
      title: 'The app is the work, not a view of it.',
      body:
        "If someone has to export to a spreadsheet to finish their job, the feature isn't done. The screen is where the work happens.",
    },
    {
      title: 'Store the raw thing, parse it after.',
      body:
        'Every external payload gets stored exactly as received, before anything interprets it. When the question changes later, the answer is already in the database.',
    },
  ],
} as const;
