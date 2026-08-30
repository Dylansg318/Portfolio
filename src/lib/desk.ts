/**
 * Content for /desk — Help Desk mode.
 *
 * Every project on the site re-told as a service ticket: the request as the
 * person actually phrased it, the working conversation, and a resolution card
 * that links to the real write-up. Requesters are roles, not named people.
 *
 * Voice: sincere and consultative. The interactivity carries the creativity;
 * the copy stays professional — a recruiter skimming this should understand
 * the work, not decode a bit. Numbers must match src/lib/site.ts and the
 * write-ups; never invent a figure for flavor.
 */

export type DeskMessage = {
  from: 'customer' | 'agent' | 'system';
  /** Short sender label shown above the bubble. */
  name: string;
  text: string;
};

export type TicketStatus = {
  label: string;
  /** ok = green, hot = red, info = blue, warn = yellow-on-black */
  tone: 'ok' | 'hot' | 'info' | 'warn';
};

export type Ticket = {
  /** Zero-padded queue number — the key renders as DSG-<num>, anchor #DSG-<num>. */
  num: string;
  subject: string;
  requester: string;
  /** How the request arrived. */
  via: string;
  opened: string;
  status: TicketStatus;
  /** Request type shown in the queue table, with a small glyph. */
  type: { icon: string; label: string };
  priority: 'Highest' | 'High' | 'Medium' | 'Low';
  /** Tech labels shown in the issue Details panel. */
  labels: string[];
  /** "Time to resolution" chip — a real cadence or duration, never a joke value. */
  timeToRes: { value: string; breached?: boolean };
  thread: DeskMessage[];
  resolution: {
    headline: string;
    points: string[];
    /** Project id under src/content/projects — becomes /projects/<slug>. */
    slug?: string;
    linkLabel?: string;
  };
};

export const tickets: Ticket[] = [
  {
    num: '001',
    subject: 'We sell on six websites and none of them agree',
    requester: 'The Owner',
    via: 'In person',
    opened: 'JUN 2025',
    type: { icon: '⟲', label: 'Systems consolidation' },
    priority: 'Highest',
    labels: ['typescript', 'node', 'postgres', 'react'],
    timeToRes: { value: 'live since 2025' },
    status: { label: 'RESOLVED · IN PRODUCTION', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'THE OWNER',
        text:
          'Orders come in on six different websites. Inventory lives in one tool, pricing in a spreadsheet, and customer emails in a shared inbox. Every tool has a different number for how many units we have. Can you make it one system?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Yes — not a dashboard on top of the existing tools, but a replacement for them. One database owns the truth, and each website becomes a feed into and out of it: orders, inventory, shipping labels, returns, customer service, and the accounting connection in one place.',
      },
      {
        from: 'customer',
        name: 'THE OWNER',
        text: 'How long does something like that take?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'It can start carrying real orders within weeks, then grow feature by feature while the business runs on it. I treat it as a product that keeps evolving, not a project with an end date.',
      },
    ],
    resolution: {
      headline: 'Built MHLHUB — the ERP the company now runs on.',
      points: [
        '≈520 orders a day through one system, up from ≈270',
        '32,000 products · 49,000 channel listings · one PostgreSQL database',
        '≈180 scheduled jobs handling work that used to be manual',
        'Order volume roughly doubled with no added operations headcount',
      ],
      slug: 'mhlhub',
      linkLabel: 'Read the full write-up',
    },
  },
  {
    num: '002',
    subject: 'Pricing is a spreadsheet someone updates every morning',
    requester: 'Pricing team',
    via: 'Email',
    opened: 'APR 2026',
    type: { icon: '⇅', label: 'Process automation' },
    priority: 'High',
    labels: ['repricing', 'scheduling', 'strategy'],
    timeToRes: { value: '1-minute cycle' },
    status: { label: 'AUTOMATED', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'PRICING TEAM',
        text:
          'Every morning someone opens a spreadsheet, checks competitor prices by hand, and retypes ours. By 9am the prices are already stale. And when we drop a price, a competitor follows within the hour — by the end of the week the margin is gone.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'There are two problems here. The retyping is straightforward to automate — an engine can reprice every product on a schedule. The harder problem is strategy: if the engine simply chases the lowest price, it automates the race to the bottom instead of ending it.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'So the engine never chases the floor. It works from tiered targets with per-product floors and cooldowns, and it recognizes the situations where holding a price is the better move.',
      },
    ],
    resolution: {
      headline: 'A repricing engine that runs every minute — with guardrails against price wars.',
      points: [
        '138,000+ logged price pushes',
        'Per-product, per-vendor decisions with cooldowns and hard floors',
        'Replaced the daily manual spreadsheet process entirely',
      ],
      slug: 'repricer',
      linkLabel: 'Read the full write-up',
    },
  },
  {
    num: '003',
    subject: 'Six storefronts each think they own the product catalog',
    requester: 'Catalog team',
    via: 'Email',
    opened: 'JUL 2026',
    type: { icon: '⛃', label: 'Data integrity' },
    priority: 'High',
    labels: ['catalog', 'sync', 'integrations'],
    timeToRes: { value: 'enforced in code' },
    status: { label: 'RESOLVED', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'CATALOG TEAM',
        text:
          'We fixed a product title on Monday. By Wednesday it was wrong again — one of the marketplace syncs writes its own version back over ours. We have 32,000 products and six websites doing this to each other.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'The fix is a rule enforced in code: the master catalog is written by people, never by a sync. Each storefront gets its own listing layer that can hold whatever that marketplace needs, but the sync jobs have no write path to the master at all.',
      },
      {
        from: 'customer',
        name: 'CATALOG TEAM',
        text: 'And when a marketplace has better data than we do?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Then the sync files it as a suggestion and a person approves it. Corrections flow through review instead of overwriting silently.',
      },
    ],
    resolution: {
      headline: 'One product master, with every storefront downstream of it.',
      points: [
        '49,000 channel listings reconciled against one 32,000-product master',
        'No sync job can insert or update the master — enforced in code, not policy',
        'Manual corrections now persist instead of being overwritten',
      ],
      slug: 'channel-sync',
      linkLabel: 'Read the full write-up',
    },
  },
  {
    num: '004',
    subject: 'The sales system and the accounting books disagree',
    requester: 'Accounting',
    via: 'Phone',
    opened: 'JUL 2026',
    type: { icon: '¢', label: 'Reconciliation' },
    priority: 'High',
    labels: ['quickbooks', 'ledger', 'reconciliation'],
    timeToRes: { value: 'hourly checks' },
    status: { label: 'RECONCILED', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'ACCOUNTING',
        text:
          'The sales system says one number and QuickBooks says another. Every month I spend days finding out which one is wrong — and the answer is usually both, a little.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'The disagreement is a symptom. The fix is one connection that pushes every transaction across with supporting evidence, plus a permanent record of every discrepancy anyone has investigated — so the same false alarm never costs an afternoon twice.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'A rule I build these systems around: a number that is plausibly wrong is more dangerous than a page that is obviously broken. The reconciliation is designed to fail loudly rather than drift quietly.',
      },
    ],
    resolution: {
      headline: 'The app and the books agree — with a ledger of every settled claim.',
      points: [
        'Hourly, self-rechecking links between orders and accounting entries',
        'Every investigated discrepancy recorded as confirmed, refuted, or open',
        'Month-end reconciliation went from days of work to a report',
      ],
      slug: 'quickbooks',
      linkLabel: 'Read the full write-up',
    },
  },
  {
    num: '005',
    subject: 'Run a dozen AI coding sessions on one repository, safely',
    requester: 'Engineering',
    via: 'Internal',
    opened: 'AUG 2026',
    type: { icon: '⚑', label: 'Developer tooling' },
    priority: 'Medium',
    labels: ['git', 'ci', 'ai-agents'],
    timeToRes: { value: '6 months in' },
    status: { label: 'RESOLVED', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'ENGINEERING',
        text:
          'Parallel AI coding sessions on one codebase risk overwriting each other’s work, sweeping unrelated files into commits, and running the full test suite many times at once.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'All three happened — once each. The answer is not hoping for better-behaved agents; it is making the unsafe operations impossible. Guard hooks block dangerous git and test commands, a coordination layer lets sessions see each other and queue instead of colliding, and each session works in its own isolated checkout by default.',
      },
      {
        from: 'customer',
        name: 'ENGINEERING',
        text: 'What happens when an agent finds a way around a rule?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'The rule gets a hook, the hook gets a test, and the incident gets written down so no future session repeats it.',
      },
    ],
    resolution: {
      headline: 'A fleet of parallel AI sessions on one repo, without incidents.',
      points: [
        '14,000 commits in six months on a single codebase',
        'Guard hooks block unsafe git and test commands outright',
        'Sessions register, see each other, and queue instead of colliding',
      ],
      slug: 'agent-fleet',
      linkLabel: 'Read the full write-up',
    },
  },
  {
    num: '006',
    subject: 'Split a group dinner receipt from a photo',
    requester: 'Personal project',
    via: 'Side project',
    opened: 'FEB 2025',
    type: { icon: '☷', label: 'Weekend build' },
    priority: 'Low',
    labels: ['ocr', 'ai', 'mobile-web'],
    timeToRes: { value: 'one weekend' },
    status: { label: 'ARCHIVED · SIDE PROJECT', tone: 'warn' },
    thread: [
      {
        from: 'customer',
        name: 'PERSONAL PROJECT',
        text:
          'Photograph a restaurant receipt, say who ordered what, and get per-person totals — with tax and tip split by each person’s share rather than evenly.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Built in a weekend, partly to learn where AI-assisted OCR actually breaks. The answer: reading crumpled thermal paper. The durable lesson was to never trust a model’s reading without keeping the original image to verify against.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'That lesson carried directly into my production work: store the raw input at every ingestion point, and parse it afterward.',
      },
    ],
    resolution: {
      headline: 'A working split-from-a-photo app — and a lesson that shipped into production systems.',
      points: [
        'Receipt OCR plus plain-language "who ordered what" → per-person totals',
        'Tax and tip weighted by each person’s share of the bill',
        'Its failure modes shaped how I handle external data at work',
      ],
      slug: 'receipt-splitter',
      linkLabel: 'Read the full write-up',
    },
  },
  {
    num: '007',
    subject: 'Re-test the whole ERP every night',
    requester: 'QA lead',
    via: 'Project tracker',
    opened: 'JUL 2024',
    type: { icon: '☑', label: 'Test automation' },
    priority: 'Medium',
    labels: ['selenium', 'cucumber', 'jenkins'],
    timeToRes: { value: 'nightly runs' },
    status: { label: 'ARCHIVED · 2024', tone: 'warn' },
    thread: [
      {
        from: 'customer',
        name: 'QA LEAD',
        text:
          'Every release we click through the same forty flows by hand. It takes two days and we still miss things. Can the regression pass be automated?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Yes — after a human has tested it first. A team of ten of us automated a modern ERP with Selenium and Cucumber: readable Given/When/Then specifications, run nightly in Jenkins. The manual exploratory pass stays, because it finds the bugs no script was told to look for.',
      },
    ],
    resolution: {
      headline: 'A nightly regression suite; manual testing refocused on finding new bugs.',
      points: [
        'Selenium + Cucumber BDD over a modern ERP, built by a team of ten',
        'Jenkins ran the suite nightly and reported by morning',
        'Replaced a two-day manual regression pass',
      ],
      slug: 'erp-test-automation',
      linkLabel: 'Read the full write-up',
    },
  },
  {
    num: '008',
    subject: 'Start here — a 60-second orientation',
    requester: 'Visitors',
    via: 'This page',
    opened: 'AUG 2026',
    type: { icon: 'ℹ', label: 'Orientation' },
    priority: 'High',
    labels: ['start-here'],
    timeToRes: { value: '60 seconds' },
    status: { label: 'START HERE', tone: 'info' },
    thread: [
      {
        from: 'customer',
        name: 'VISITORS',
        text: 'What am I looking at?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'My portfolio, presented as a service desk — because that is how the work actually arrives. Every project here began as a request from someone, described in their own words, and ended as running software. Each ticket shows the original problem, the working conversation, and the measured result.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'If you are short on time: DSG-001 is the main body of work (an ERP handling ≈520 orders a day), DSG-002 is the most interesting engineering problem (repricing strategy), and DSG-005 shows how I work with AI tooling. The Résumé link in the top bar is the fast path, and "Exit help desk mode" returns to the standard site.',
      },
    ],
    resolution: {
      headline: 'Where to go next.',
      points: [
        'DSG-001 — the ERP that runs a dental supply company',
        'DSG-002 — repricing every minute without a race to the bottom',
        'DSG-005 — running a dozen AI coding sessions on one repo',
      ],
      slug: 'portfolio-site',
      linkLabel: 'How this site was built',
    },
  },
];

/** Raise-a-request categories, each with the auto-response shown before the
 *  visitor sends the real email. Factual and consultative. */
export type IntakeCategory = {
  id: string;
  label: string;
  /** Prefilled subject for the mail link. */
  subject: string;
  autoReply: string;
};

export const intakeCategories: IntakeCategory[] = [
  {
    id: 'import',
    label: 'Import orders from multiple marketplaces',
    subject: 'Request: multi-marketplace order import',
    autoReply:
      'I have built this at production scale — about 520 orders a day across six channels. The approach that holds up: one database owns the truth, and each marketplace gets its own feed in and out. Describe your marketplaces and rough volumes below.',
  },
  {
    id: 'api',
    label: 'Integrate a third-party API',
    subject: 'Request: third-party API integration',
    autoReply:
      'I have integrated QuickBooks Desktop, Amazon, eBay, Shopify, Walmart, Net32, and three shipping carriers. The habit that keeps these reliable: store every raw response before parsing it, so changes and disputes always have evidence behind them. Tell me which system you are connecting.',
  },
  {
    id: 'spreadsheet',
    label: 'Automate a manual spreadsheet process',
    subject: 'Request: automate a spreadsheet process',
    autoReply:
      'A long-lived spreadsheet is usually the most accurate description of a business process, so I treat it as the specification. Describe the routine around it — who updates it, when, and what happens next — and I can outline what the automated version looks like.',
  },
  {
    id: 'agree',
    label: 'Make two systems agree',
    subject: 'Request: reconcile two systems',
    autoReply:
      'Reconciliation needs two things: one connection that moves every record across with evidence, and a permanent log of investigated discrepancies so nothing gets chased twice. I keep an ERP and QuickBooks agreeing this way. Describe the two systems and where they drift.',
  },
  {
    id: 'other',
    label: 'Something else',
    subject: 'Request: project inquiry',
    autoReply:
      'Describe the problem in your own words — every ticket in this queue started that way. I will reply with an honest read on scope and whether I am the right person for it.',
  },
];

/** Knowledge base — the working principles applied to every ticket. */
export type CannedReply = {
  code: string;
  title: string;
  body: string;
};

export const cannedReplies: CannedReply[] = [
  {
    code: 'KB-01',
    title: 'Subtly wrong is worse than obviously broken',
    body:
      'A page that crashes gets fixed the same day. A number that is plausibly wrong gets trusted for a month. I design for the second case: hard filters, ledgers with evidence, and jobs that fail loudly rather than report success while doing nothing.',
  },
  {
    code: 'KB-02',
    title: 'The app is the work, not a view of it',
    body:
      'If someone has to export to a spreadsheet to finish the job, the feature is not done. Every screen I build is where the task actually happens — the order ships there, the return gets decided there.',
  },
  {
    code: 'KB-03',
    title: 'Store the raw thing, parse it after',
    body:
      'Every external payload — a carrier invoice, a marketplace order, an accounting response — is stored as received before it is interpreted. When the question changes later, the answer is already on file instead of behind an API that has expired the data.',
  },
];
