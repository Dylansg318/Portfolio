/** Single source of truth for identity, navigation and the facts the pages
 *  quote. Edit here, not in components — every number below appears in more
 *  than one place. */
export const site = {
  name: 'Dylan San Gabriel',
  /** Short form for the nav bar, where the full name is too wide on mobile. */
  shortName: 'Dylan',
  title: 'Dylan San Gabriel — Software Engineer',
  /** The job title, everywhere it appears. "Operations Technology Manager" was
   *  never an official title, and a title a reference check can't confirm is
   *  worth less than the plain one the work supports. */
  role: 'Software Engineer',
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
   *  neither belongs on a public page, and the PDF below is public too. */
  email: 'dylansg0318@gmail.com',
  locale: 'en',

  /** The web résumé, and the one-page PDF generated from it. The PDF is a
   *  build artefact of the page — `npm run resume:pdf` regenerates it — so the
   *  two can't say different things. */
  resumeUrl: '/resume',
  resumePdf: '/resume.pdf',

  /** Empty string hides the link EVERYWHERE. Every surface guards on these, so
   *  turning one back on is a one-line change here, not a hunt through pages.
   *
   *  github was off for as long as the profile was two repos, one of them empty:
   *  the real work is private or in the company's org, and a link from "I built
   *  the ERP a distributor runs on" to an empty account subtracts credibility
   *  rather than adding it.
   *
   *  On 2026-09-01 that stopped being true. This repository went public carrying
   *  `code/` — thirteen sanitized excerpts from the ERP and the agent fleet, with
   *  their tests and their reasoning. With the degree line corrected to
   *  coursework and the ERP itself still private, that tree is the third-party
   *  evidence this link now points at. */
  links: {
    github: 'https://github.com/Dylansg318',
    linkedin: 'https://www.linkedin.com/in/dylan-san-gabriel/',
    /** The public, readable proof behind the private ERP. */
    code: 'https://github.com/Dylansg318/Portfolio/tree/main/code',
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

  /** The résumé summary. Three sentences: what I do, what I'm strongest at,
   *  what I'm looking for. Names the target role because a screener decides
   *  in seconds whether this page is for the job they are filling. */
  resumeSummary:
    'Software engineer who designed, built and runs the ERP a six-channel dental distributor ' +
    'operates on, as its only engineer. Strongest on integrations and data correctness: ' +
    'order pipelines, marketplace and carrier APIs, accounting sync. ' +
    'SDET-trained, so the tests arrive with the feature. Looking for a backend or ' +
    'full-stack role, remote or in Northern Virginia.',

  /** The three things a one-page résumé links to. The ERP is private, so the
   *  second entry is the public evidence — the sanitized production modules
   *  a reviewer can actually read. */
  resumeProjects: [
    {
      title: 'MHLHUB — the ERP',
      href: '/projects/mhlhub',
      stack: 'TypeScript, Express, React, PostgreSQL',
      blurb:
        'How the system is shaped, the rules that stopped the expensive mistakes, screenshots of it running.',
    },
    {
      title: 'Production code excerpts',
      href: 'https://github.com/Dylansg318/Portfolio/tree/main/code',
      stack: 'GitHub · 13 modules with tests and READMEs',
      blurb:
        'Sanitized production modules: GS1 parsing, a ZPL renderer, carrier-invoice parsers, a device agent, session locks.',
    },
    {
      title: 'Guardrails for a fleet of AI coding sessions',
      href: '/projects/agent-fleet',
      stack: 'Claude Code, Git hooks, Node.js',
      blurb:
        'Locks, hooks and consequence-triggered review that let 5–10 coding agents share one repository safely.',
    },
  ],

  /** Skills grouped the way a hiring manager scans them. Order inside each row
   *  is "most used first", not alphabetical. Every item is something I have
   *  shipped with, not something I have read about. */
  skills: [
    {
      group: 'Languages',
      items: ['TypeScript', 'JavaScript', 'SQL', 'Python', 'Java'],
    },
    {
      group: 'Backend & data',
      items: ['Node.js', 'Express', 'PostgreSQL', 'REST APIs', 'SOAP', 'Flask', 'MySQL'],
    },
    {
      group: 'Frontend',
      items: ['React', 'Vite', 'Tailwind CSS', 'Astro'],
    },
    {
      group: 'Integrations',
      items: ['QuickBooks Desktop', 'Amazon SP-API', 'eBay', 'Shopify', 'Walmart', 'Net32', 'USPS / UPS / FedEx', 'Gmail API', 'ZPL'],
    },
    {
      group: 'Testing',
      items: ['Jest', 'Selenium', 'Cucumber / Gherkin', 'REST Assured', 'JUnit / TestNG', 'PyTest', 'Postman'],
    },
    {
      group: 'Ops & tooling',
      items: ['GitHub Actions', 'Docker', 'Railway', 'Cloudflare Workers', 'Harness', 'Jenkins', 'Jira', 'Claude Code'],
    },
  ],

  /** Reverse-chronological. `summary` is one sentence a recruiter can skim;
   *  `bullets` are for the résumé page — each one opens with what changed,
   *  carries a number where one exists, and fits in two printed lines. */
  experience: [
    {
      title: 'Software Engineer',
      org: 'RMH3 Dental Supply',
      place: 'Chantilly, VA',
      start: 'Jun 2025',
      end: 'Present',
      summary:
        'The only engineer at a family-run dental distributor. Built and run MHLHUB, the in-house ERP that replaced off-the-shelf software, spreadsheets and inbox triage across six sales channels.',
      bullets: [
        'Sole engineer for MHLHUB, the in-house ERP that replaced SellerCloud, spreadsheets and a hand-sorted inbox: order intake from six sales channels, inventory, shipping, customer service, returns, invoicing and a two-way QuickBooks Desktop sync. TypeScript, Express, React, PostgreSQL.',
        'Daily orders grew from about 270 to about 520 on a 32,000-product catalog with no added operations headcount; 13 people work in the system daily.',
        'Replaced a morning pricing spreadsheet with a repricing engine that re-evaluates every product every 60 seconds with cooldowns, floors and a no-price-war rule; 138,000+ price changes, each logged with its reason.',
        'Integrated eBay, Amazon SP-API, Shopify, Walmart, Net32 and three carriers: 300,000+ orders ingested, every raw payload stored before parsing, and a source-scan guard so channel code can never write the product catalog.',
        'Put barcodes and scanners on a pen-and-paper warehouse: GS1 parsing, a browser camera scanner, a JSON-to-ZPL label renderer and a self-updating Windows print agent with crash-loop rollback.',
        'Reconcile the ERP against QuickBooks at line level and settle each discrepancy once in a claims ledger; 2,721 automated tests and ~180 checkpointed scheduled jobs keep app and books in agreement through redeploys.',
        'Run 5–10 parallel Claude Code sessions on one repository behind file locks, hooks that block unrecoverable git operations, and second-model review of consequential changes.',
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
        'Ran front-of-house operations and trained new servers; promoted twice within the first months. Completed the CYDEO SDET program alongside full-time shifts.',
      ],
    },
    {
      /** Dates confirmed against the Wireless Vision welcome email of
       *  2021-01-24 (training began 2021-01-25). Earlier drafts said Jan 2020;
       *  that was wrong. */
      title: 'Store Manager',
      org: 'Wireless Vision (T-Mobile)',
      place: 'Vienna, VA',
      start: 'Jan 2021',
      end: 'Aug 2022',
      summary:
        'Promoted from sales associate to store manager in ten months. Beat performance targets by 30% with perfect customer-satisfaction scores.',
      bullets: [
        'Hired as a sales associate in January 2021 and promoted to store manager that November; ran staffing, cash and inventory, beat targets by 30% over multiple months and raised customer satisfaction from 8.0 to 10 out of 10.',
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
        'Java, Selenium, Cucumber/Gherkin, REST Assured, SQL, Jenkins; two ten-person sprint teams automating live web apps.',
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
        "Dean's List. Object-oriented programming, game design, essentials of CS. Left before the degree was conferred.",
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
