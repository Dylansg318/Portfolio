/**
 * The public, read-only API — one entry per endpoint.
 *
 * This list is the contract in three places at once: `GET /api` returns it,
 * every try-it console on the site is rendered from it, and the Worker
 * routes under `src/pages/api/` implement exactly these paths and parameters.
 * Add an endpoint here first; a console for it is then one component call.
 *
 * Nothing here imports `astro:content` — the consoles serialise an entry into
 * the page, and the client script must be able to read it without the
 * content layer.
 */

export type ParamSpec = {
  name: string;
  type: 'select' | 'text' | 'email' | 'textarea' | 'checkbox';
  /** For `select`: value → label. An empty value means "omit the parameter". */
  options?: { value: string; label: string }[];
  /** The default the console starts with. */
  value?: string;
  placeholder?: string;
  /** For `checkbox`: the word shown beside the box. */
  hint?: string;
  /** Shown in `GET /api` and as the parameter's title in the console. */
  description: string;
  /** Rendered in a console only when the page sets a value for it. `fields`
   *  is optional everywhere: a row that is about a subset shows it, the
   *  others stay quiet. */
  optional?: boolean;
};

const FIELDS: ParamSpec = {
  name: 'fields',
  type: 'text',
  value: '',
  placeholder: 'a,b,c',
  description: 'Comma-separated keys to return instead of the whole record. `page` always comes back.',
  optional: true,
};

export type Endpoint = {
  /** The key a console refers to. */
  key: string;
  method: 'GET' | 'POST';
  /** Route with `{param}` placeholders for path parameters. */
  path: string;
  description: string;
  params: ParamSpec[];
  /** Which file the answer is read from — shown under the Send button. */
  source: string;
};

const CATEGORY = [
  { value: '', label: 'all' },
  { value: 'work', label: 'work' },
  { value: 'tool', label: 'tool' },
  { value: 'game', label: 'game' },
];

export const ENDPOINTS: Endpoint[] = [
  {
    key: 'dylan',
    method: 'GET',
    path: '/api/dylan',
    description: 'Who this is: role, employer, the one-sentence summary in either register, location, links.',
    params: [
      {
        name: 'view',
        type: 'select',
        options: [
          { value: 'plain', label: 'plain' },
          { value: 'engineer', label: 'engineer' },
        ],
        value: 'plain',
        description: 'Which register the summary is written in. The site has two; the pages show both.',
      },
      FIELDS,
    ],
    source: 'src/lib/site.ts',
  },
  {
    key: 'work',
    method: 'GET',
    path: '/api/work',
    description: 'Every top-level project, newest and most important first. Subsystems are reached through their parent.',
    params: [
      {
        name: 'category',
        type: 'select',
        options: CATEGORY,
        value: '',
        description: 'Filter to one shelf: work, tool or game. What the thing is, not what it was built with.',
      },
      FIELDS,
    ],
    source: 'src/content/projects/*',
  },
  {
    key: 'project',
    method: 'GET',
    path: '/api/work/{id}',
    description: 'One project in full: the contract (problem, what was unique, what I learned), the numbers, the parts.',
    params: [
      {
        name: 'id',
        type: 'select',
        // Filled in per page: the options are the live project ids.
        options: [],
        value: 'internal-erp',
        description: 'A project id from GET /api/work, or a subsystem id such as internal-erp/repricing.',
      },
      { ...FIELDS, placeholder: 'problem,unique,learned' },
    ],
    source: 'src/content/projects/{id}',
  },
  {
    key: 'experience',
    method: 'GET',
    path: '/api/experience',
    description: 'The path here — the stops, the jobs, education and certifications.',
    params: [
      {
        name: 'since',
        type: 'select',
        options: [
          { value: '', label: 'any' },
          { value: '2021', label: '2021' },
          { value: '2022', label: '2022' },
          { value: '2025', label: '2025' },
        ],
        value: '',
        description: 'Only jobs that started in this year or later.',
      },
      FIELDS,
    ],
    source: 'src/lib/site.ts',
  },
  {
    key: 'resume',
    method: 'GET',
    path: '/api/resume',
    description: 'The one-page résumé: summary, experience with bullets, projects, skills, education. The same facts the printed PDF carries.',
    params: [
      {
        name: 'format',
        type: 'select',
        options: [
          { value: 'json', label: 'json' },
          { value: 'html', label: 'html' },
          { value: 'pdf', label: 'pdf' },
        ],
        value: 'json',
        description: 'json returns the record; html and pdf return the record with `page` pointing at that version.',
      },
      FIELDS,
    ],
    source: 'src/lib/site.ts',
  },
  {
    key: 'away',
    method: 'GET',
    path: '/api/away-from-work',
    description: 'What I do when I am not at a keyboard, and the first thing I ever shipped, which is still playable.',
    params: [
      {
        name: 'playable',
        type: 'checkbox',
        value: 'true',
        hint: 'open the game',
        description: 'When true, `page` is the playable game rather than its write-up.',
      },
      FIELDS,
    ],
    source: 'src/lib/site.ts · src/content/projects/galaxy-defense',
  },
  {
    key: 'contact',
    method: 'POST',
    path: '/api/contact',
    description: 'Send a message. Until mail delivery is configured the route answers 503 with a mailto link, and the console opens it.',
    params: [
      { name: 'from', type: 'email', value: '', placeholder: 'you@company.com', description: 'Your email, so I can reply.' },
      {
        name: 'message',
        type: 'textarea',
        value: '',
        placeholder: 'What you are hiring for, timeline, remote / hybrid / on-site, a link to the role.',
        description: 'The message. Ten characters or more.',
      },
    ],
    source: 'src/pages/api/contact.ts',
  },
];

export const endpoint = (key: string): Endpoint => {
  const ep = ENDPOINTS.find((e) => e.key === key);
  if (!ep) throw new Error(`unknown endpoint: ${key}`);
  return ep;
};
