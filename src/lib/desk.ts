/**
 * Content for /desk — the Help Desk mode.
 *
 * Every project on the site re-told as a support ticket: a customer walks up
 * with a problem in their own words, the agent (Dylan) replies, and the
 * resolution card links to the real write-up. The requesters are roles, not
 * people — the desk is a bit, the resolutions are not.
 *
 * Keep the voice: customer messages sound like actual requests (slightly
 * desperate), agent replies are confident and concrete, resolutions carry the
 * real numbers. Numbers here should match src/lib/site.ts and the write-ups.
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
  /** How the ticket allegedly arrived. */
  via: string;
  opened: string;
  status: TicketStatus;
  /** Request type shown in the queue table, with a small glyph. */
  type: { icon: string; label: string };
  priority: 'Highest' | 'High' | 'Medium' | 'Low';
  /** Tech labels shown in the issue Details panel. */
  labels: string[];
  /** "Time to resolution" SLA chip. negative = breached (red), else green. */
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
    via: 'WALK-UP',
    opened: 'JUN 2025',
    type: { icon: '⟲', label: 'Replace all software' },
    priority: 'Highest',
    labels: ['typescript', 'node', 'postgres', 'react'],
    timeToRes: { value: 'still running' },
    status: { label: 'RESOLVED · IN PRODUCTION', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'THE OWNER',
        text:
          'Orders come in on six different websites. Inventory lives in one tool, pricing in a spreadsheet, customer emails in a shared Gmail nobody wants to open. Every tool has a different number for how many units we have. Can you make it one thing?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Yes. Not a dashboard on top of the mess — a replacement for the mess. One database that owns the truth, and every website becomes a feed into it and out of it. Orders, stock, labels, returns, the books. You will open one tab in the morning.',
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
          'It never finishes — that is the point. But it starts carrying real orders in weeks, and everything after that is compounding. I will run it like a product, not a project.',
      },
    ],
    resolution: {
      headline: 'Built MHLHUB — the ERP the company now runs on.',
      points: [
        '≈520 orders a day through one system, up from ≈270',
        '32,000 products · 49,000 channel listings · one PostgreSQL database',
        '≈180 scheduled jobs doing the work people used to do by hand',
        'Same ops headcount as the day the ticket was opened',
      ],
      slug: 'mhlhub',
      linkLabel: 'READ THE CASE FILE',
    },
  },
  {
    num: '002',
    subject: 'Someone updates a pricing spreadsheet every morning at 6am',
    requester: 'Pricing (a spreadsheet)',
    via: 'EMAIL',
    opened: 'APR 2026',
    type: { icon: '⇅', label: 'Automate a ritual' },
    priority: 'High',
    labels: ['repricing', 'cron', 'game-theory'],
    timeToRes: { value: '61s per push' },
    status: { label: 'AUTOMATED', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'PRICING TEAM',
        text:
          'Every morning someone opens a spreadsheet, checks competitor prices by hand, and retypes ours. By 9am the prices are already stale. Also whenever we drop a price, a competitor drops theirs an hour later, and by Friday everyone is selling at cost.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Two problems in one ticket. The retyping is easy — a robot can reprice every product once a minute. The Friday-at-cost problem is the interesting one: the robot has to be smarter than "beat the lowest price," or it just automates the race to the bottom.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'So it never chases the floor. Tiered targets, cooldowns so it does not twitch, and it knows when standing still wins the week. A price war needs two participants.',
      },
    ],
    resolution: {
      headline: 'A repricing engine that runs every minute — and declines the price war.',
      points: [
        '138,000+ logged price pushes and counting',
        'Per-product, per-vendor decisions with cooldowns and floors',
        'The 6am spreadsheet ritual: retired',
      ],
      slug: 'repricer',
      linkLabel: 'READ THE CASE FILE',
    },
  },
  {
    num: '003',
    subject: 'Six storefronts each think they own the product catalog',
    requester: 'Catalog Team',
    via: 'EMAIL',
    opened: 'JUL 2026',
    type: { icon: '⛃', label: 'System misbehaving' },
    priority: 'High',
    labels: ['catalog', 'sync', 'six-apis'],
    timeToRes: { value: 'survives Wednesday' },
    status: { label: 'RESOLVED', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'CATALOG TEAM',
        text:
          'We fixed a product title on Monday. By Wednesday it was wrong again. Turns out one of the marketplace syncs "helpfully" writes its version back over ours. We have 32,000 products and six websites doing this to each other.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'The fix is a rule, then code to enforce it: the master catalog is written by people, never by a sync. Ever. Each storefront gets its own listing layer that can say whatever that marketplace needs — but upstream is read-only to robots. A sync that tries to write to master does not get a warning, it gets a wall.',
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
          'Then it files a suggestion and a human clicks accept. Convenient and wrong lost to boring and right.',
      },
    ],
    resolution: {
      headline: 'One product master, six obedient storefronts.',
      points: [
        '49,000 channel listings reconciled against one 32,000-product master',
        'Master is sacred: no sync may INSERT or UPDATE it — enforced in code, not policy',
        'Monday’s fix now survives Wednesday',
      ],
      slug: 'channel-sync',
      linkLabel: 'READ THE CASE FILE',
    },
  },
  {
    num: '004',
    subject: 'The books and the app disagree and I cannot sleep',
    requester: 'The Accountant',
    via: 'PHONE (LANDLINE)',
    opened: 'JUL 2026',
    type: { icon: '¢', label: 'Make systems agree' },
    priority: 'High',
    labels: ['quickbooks', 'soap-2004', 'ledger'],
    timeToRes: { value: 'to the penny' },
    status: { label: 'RECONCILED', tone: 'ok' },
    thread: [
      {
        from: 'customer',
        name: 'THE ACCOUNTANT',
        text:
          'The sales system says one number. QuickBooks says another. Every month I spend three days finding out which one is lying, and the answer is usually "both, a little."',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'The disagreement is not the disease, it is the symptom. The two systems need one connection that pushes every transaction across with evidence, plus a logbook of every discrepancy anyone ever investigated — so the same false alarm never eats an afternoon twice.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Rule of the house: a number that is plausibly wrong is more dangerous than a page that is obviously broken. The reconcile is built to fail loudly.',
      },
    ],
    resolution: {
      headline: 'App and books agree to the penny — with a ledger of settled claims.',
      points: [
        'Hourly linking between orders and accounting entries, self-rechecking',
        'Every investigated discrepancy recorded: confirmed, refuted, or open',
        'The three-day month-end hunt is now a report',
      ],
      slug: 'quickbooks',
      linkLabel: 'READ THE CASE FILE',
    },
  },
  {
    num: '005',
    subject: 'You cannot run a dozen AI coding agents on one codebase',
    requester: 'Conventional Wisdom',
    via: 'FORUM THREAD',
    opened: 'AUG 2026',
    type: { icon: '⚑', label: 'Dispute a claim' },
    priority: 'Medium',
    labels: ['git', 'hooks', 'agents'],
    timeToRes: { value: '14K commits' },
    status: { label: 'DISPUTED → RESOLVED', tone: 'info' },
    thread: [
      {
        from: 'customer',
        name: 'CONVENTIONAL WISDOM',
        text:
          'They will overwrite each other’s work, commit each other’s half-finished files, and run the whole test suite twelve times at once until the laptop achieves liftoff.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'All three happened. Once each. The trick is not better-behaved agents — it is making the unsafe thing impossible instead of discouraged. Hooks that block dangerous commands, a coordination layer so sessions see each other, worktrees by default, commits by explicit path only.',
      },
      {
        from: 'customer',
        name: 'CONVENTIONAL WISDOM',
        text: 'And when an agent finds a clever way around the rules?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text: 'The rule gets a hook, the hook gets a test, and the ledger gets an entry. Same as any other employee.',
      },
    ],
    resolution: {
      headline: 'A fleet of parallel AI sessions, one repo, no casualties.',
      points: [
        '14,000 commits in six months on a single codebase',
        'Guard hooks block the unsafe git and test commands outright',
        'Sessions register, see each other, and queue instead of colliding',
      ],
      slug: 'agent-fleet',
      linkLabel: 'READ THE CASE FILE',
    },
  },
  {
    num: '006',
    subject: 'Dinner was $317 and nobody remembers who ordered the octopus',
    requester: 'The Group Chat',
    via: 'TEXT (11:48 PM)',
    opened: 'FEB 2025',
    type: { icon: '☷', label: 'Weekend request' },
    priority: 'Low',
    labels: ['ocr', 'venmo-adjacent'],
    timeToRes: { value: 'one weekend' },
    status: { label: 'ARCHIVED · WEEKEND BUILD', tone: 'warn' },
    thread: [
      {
        from: 'customer',
        name: 'THE GROUP CHAT',
        text: 'photo of a crumpled receipt. "someone split this. venmo requests by tomorrow or it’s even shares and the salad people riot."',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Photograph the receipt, tell the app who ate what in plain words, and it does the arithmetic — tax and tip weighted by what each person actually ordered. Built it in a weekend, mostly to find out where the AI part actually breaks.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Where it breaks: reading crumpled thermal paper. The lesson shipped into my day job — never trust a model’s read without keeping the original photo to check against. Store the raw thing, parse it after.',
      },
    ],
    resolution: {
      headline: 'Split-from-a-photo app. The salad people were heard.',
      points: [
        'Receipt OCR + plain-English "who ate what" → per-person totals',
        'Tax and tip split by share of the bill, not headcount',
        'Its real output: lessons about AI failure modes I still use daily',
      ],
      slug: 'receipt-splitter',
      linkLabel: 'READ THE CASE FILE',
    },
  },
  {
    num: '007',
    subject: 'Re-test the whole ERP every night without hiring night testers',
    requester: 'QA Lead',
    via: 'JIRA (SORRY)',
    opened: 'JUL 2024',
    type: { icon: '☑', label: 'Automate testing' },
    priority: 'Medium',
    labels: ['selenium', 'cucumber', 'jenkins'],
    timeToRes: { value: 'nightly' },
    status: { label: 'ARCHIVED · 2024', tone: 'warn' },
    thread: [
      {
        from: 'customer',
        name: 'QA LEAD',
        text:
          'Every release we click through the same forty flows by hand. It takes two days and we still miss things. Can the machine do the clicking?',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Yes — after a human clicks it first. Ten of us automated an Odoo ERP with Selenium and Cucumber: readable Given/When/Then specs, nightly runs in Jenkins. The manual pass stays, because exploratory testing finds the bugs the robots were never told to look for.',
      },
    ],
    resolution: {
      headline: 'Nightly regression suite; humans promoted to finding new bugs.',
      points: [
        'Selenium + Cucumber BDD over an Odoo ERP, team of ten',
        'Jenkins ran it every night and posted the verdict by morning',
        'The two-day manual regression: retired',
      ],
      slug: 'erp-test-automation',
      linkLabel: 'READ THE CASE FILE',
    },
  },
  {
    num: '008',
    subject: 'Your portfolio is… a help desk?',
    requester: 'You, presumably',
    via: 'THIS PAGE',
    opened: 'JUST NOW',
    type: { icon: '?', label: 'General enquiry' },
    priority: 'Highest',
    labels: ['you-are-here'],
    timeToRes: { value: '0m 00s', breached: true },
    status: { label: 'OPEN', tone: 'hot' },
    thread: [
      {
        from: 'customer',
        name: 'VISITOR',
        text: 'I came here to look at a portfolio and I appear to be in a queue.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text:
          'Correct. Everything I build starts as a request like the ones in this queue — someone describes a problem in their own words, and it leaves as running software. The desk is the honest format. The polished version of this site is one EXIT away, and the full write-ups are behind every case file link.',
      },
      {
        from: 'agent',
        name: 'DYLAN (AGENT)',
        text: 'Your ticket stays open until you press NEW TICKET and tell me what you need built.',
      },
    ],
    resolution: {
      headline: 'This site, in both modes.',
      points: [
        'Astro + Cloudflare Workers · plain-English and engineer voices',
        'Meadow look for reading, Help Desk mode for personality',
        'Yes, it also runs games',
      ],
      slug: 'portfolio-site',
      linkLabel: 'READ THE CASE FILE',
    },
  },
];

/** NEW TICKET tab — the request categories a visitor can pick, each with the
 *  instant auto-reply the desk prints before handing them the real mailto. */
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
    label: 'IMPORT ORDERS FROM N PLACES',
    subject: 'Ticket: import orders from several marketplaces',
    autoReply:
      'Ah, the classic. Six inboxes, one warehouse. I have done this at ≈520 orders/day — the answer is one database that owns the truth and per-marketplace feeds that are not allowed to argue with it. Describe your marketplaces below.',
  },
  {
    id: 'api',
    label: 'CONNECT AN API THAT HATES ME',
    subject: 'Ticket: connect a hostile API',
    autoReply:
      'They all hate you. QuickBooks Desktop speaks SOAP from 2004, carrier APIs return CSV with 250 unlabeled columns, and one marketplace truncates product names at 50 characters and calls it a feature. I store every raw payload before parsing, so when the API lies, there is evidence. Tell me which one is hurting you.',
  },
  {
    id: 'spreadsheet',
    label: 'REPLACE A SPREADSHEET WITH A ROBOT',
    subject: 'Ticket: automate away a spreadsheet',
    autoReply:
      'Respect the spreadsheet — it is the most honest spec you will ever get. Someone already encoded the whole business process in it; my job is to read it like a requirements doc and ship software that does the same thing without the 6am human. Attach nothing, just describe the ritual.',
  },
  {
    id: 'agree',
    label: 'MAKE TWO SYSTEMS AGREE',
    subject: 'Ticket: reconcile two systems',
    autoReply:
      'The systems are not the problem; the missing referee is. You need one connection that moves every record across with evidence, and a ledger of every disagreement ever investigated so no false alarm gets investigated twice. I keep books and an ERP agreeing to the penny. Describe your two combatants.',
  },
  {
    id: 'weirder',
    label: 'SOMETHING WEIRDER',
    subject: 'Ticket: something weirder',
    autoReply:
      'Excellent. The best tickets do not fit the buttons. I once got "split the dinner check from a photo" and it became an app. Type it exactly the way you would say it out loud — the desk translates.',
  },
];

/** CANNED REPLIES tab — principles and personality, in stamp-able form. */
export type CannedReply = {
  code: string;
  title: string;
  body: string;
};

export const cannedReplies: CannedReply[] = [
  {
    code: 'CR-01',
    title: 'SUBTLY WRONG IS WORSE THAN OBVIOUSLY BROKEN',
    body:
      'A page that crashes gets fixed the same day. A number that is plausibly wrong gets trusted for a month. I design for the second case: hard filters, ledgers with evidence, jobs that fail loudly rather than report success while doing nothing.',
  },
  {
    code: 'CR-02',
    title: 'THE APP IS THE WORK, NOT A VIEW OF IT',
    body:
      'If someone has to export to a spreadsheet to finish the job, the feature is not done. Every screen I build is where the task actually happens — the order ships there, the return gets decided there.',
  },
  {
    code: 'CR-03',
    title: 'STORE THE RAW THING, PARSE IT AFTER',
    body:
      'Every external payload — a carrier invoice, a marketplace order, an accounting response — is stored as received before it is interpreted. When the question changes later, the answer is already on file instead of behind an API that expired the data.',
  },
  {
    code: 'CR-04',
    title: 'PER OUR PREVIOUS CONVERSATION',
    body:
      'The desk does not actually use this one. It is here because no help desk is complete without it.',
  },
];
