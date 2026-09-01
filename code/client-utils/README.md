# Client utilities (React / browser)

Extracted from a private production ERP; identifiers and incident details have been sanitized.

These are readable excerpts, not an installable package. External deps where
used: `react`, `react-router-dom` (the two routing hooks), `xlsx` (lazy-loaded
by `csv.ts` for Excel files only), and `@testing-library/react` + Jest/jsdom in
the tests. Everything else is browser built-ins. Tests live in `__tests__/`
folders next to their modules.

---

## The list-state system

Four modules that together answer "why is the order I'm looking for not in the
list?" — the most expensive invisible failure a filtered list can have.

### hooks/useListQueryState.ts — config-driven list controller

One hook that owns a list page's page number, page size, search box, and
filter object, with opt-in persistence (URL-independent; sessionStorage or
localStorage per concern), search in `immediate` or `debounced` mode, page-size
clamping, and TTL expiry of stale view state. Encodes three hard-won details:

- **Reset-to-page-1 must fire on filter *change*, never on mount** — a page
  restored from storage would be stomped back to 1. The guard compares the
  reset-signature *value* instead of a "have I run?" flag, because
  React.StrictMode double-invokes effects and a flag reads the second
  invocation as a filter change (this shipped as a real dev-mode bug).
- **Storage write-through keys on primitives, not the config object** —
  callers pass `filtersPersistence` inline, so depending on the object fired a
  synchronous storage write on every render instead of every change.
- Route mount is an **expiry checkpoint**: persisted filters past their idle
  window are dropped *before* being read back.

### viewStateTtl.ts — 15-minute idle expiry for persisted list state

sessionStorage lives as long as the tab, and an ops app is left open for days
(and session-restoring browsers carry it across restarts) — so a filter set on
Tuesday silently subtracts rows on Friday. This gives row-narrowing state a
15-minute *idle* life: interactions re-stamp a throttled clock; checkpoints
(boot, tab refocus, route mount — deliberately **not a timer**, so a filtered
list is never yanked from under someone reading it) sweep an explicit
allow-list of keys. The allow-list records *which store* each page writes to —
a wrong store is silent (the key looks covered and never expires), and the
test suite pins the local-store subset for exactly that reason. Sort order,
page size, printer picks, additive toggles, and anything holding unsaved work
are deliberately never expired. Sweeps dispatch an async epoch-stamped event
so already-mounted lists reset in place.

### hooks/useViewStateExpiry.ts — reset a *mounted* list on expiry

Clearing storage only helps the next mount; a background tab still holds its
filters in React state. The epoch guard is the whole point: a list whose own
mount ran the sweep already read clean storage and must ignore that sweep's
notification, or it resets itself twice.

### hooks/useDeepLinkParams.ts — a deep link declares, then is consumed

An inbound link into a list page must *replace* the page's scope, not
intersect with whatever filters that tab restored from storage (in production:
a link to the orders list met a leftover channel filter and 1,803 matching
orders rendered as "No orders found"). The hook applies the named URL params
once after mount — so it beats the storage restore — then strips them from the
URL with `replace: true`. Consuming is load-bearing twice: the trip back from
a detail page can't re-apply the link over the operator's edits, and the same
link works twice in a row. Effect keys on a value signature because
`useSearchParams` returns a fresh instance every render.

## hooks/useBulkSelection.ts — two-layer "select all"

Header checkbox selects the loaded rows; the "Select all N matching" banner
flips a mode where bulk operations resolve ids from *filters on the server*
instead of shipping loaded-row ids — the difference between acting on the page
you see and acting on the whole result set. `bulkIds()`/`bulkFilters()` make
the call-site contract explicit.

## hooks/useEscapeBack.ts — Escape returns from detail to list

Prefers `location.state.from`, falls back to the list route. Stays quiet when
a modal owns the screen or the user is typing (via `keyboard.ts`'s
`isTypingContext`), and honors `defaultPrevented` so a non-modal inline-edit
panel can consume Escape itself — the test suite pins both the guard and its
negative (without `preventDefault` the hook *does* navigate), proving the
mechanism is load-bearing.

## hooks/usePreviewRecord.ts — remember the last preview record per template

`useState`-shaped hook persisting a document editor's last preview record id
per template key in localStorage, re-reading when the template switches.

## tableColumnPrefs.ts — persisted hidden-column set

Opt-in per-table persistence of hidden columns. Stores the **hidden** keys,
not the visible ones, so a column added later shows up by default instead of
hiding behind a stale layout. Computes updater results from a ref rather than
inside the state updater (StrictMode double-invokes those). localStorage on
purpose: one small array per table is not worth a server round trip.

## chunkReload.ts — recover from lazy-chunk 404s after a deploy

After a redeploy, browsers holding the old `index.html` request chunk hashes
that no longer exist; `import()` gets HTML back and throws a MIME TypeError.
This listens for the known failure shapes plus Vite's own
`vite:preloadError` (message-independent, robust across Vite versions) and
reloads once, with a sessionStorage cooldown so a failing reload can't loop.
Fires only on dynamic-import failures — never while interacting with loaded
code.

## safeNextPath.ts — open-redirect guard for `?next=`

Only same-origin absolute paths pass: rejects protocol-relative `//host`,
full URLs, `/login` bounce loops, and backslash payloads (`/\evil.example`)
that browsers normalize to `//`.

## csv.ts — unified browser CSV / XLSX / XML → row objects

One `parseFile(file)` entry point for `<input type="file">`. Hand-rolled
RFC 4180 CSV parser (BOM stripping, quoted fields with embedded commas /
newlines / `""` escapes, CRLF+LF, trailing-newline artifacts); Excel via a
dynamic `import('xlsx')` so the ~330KB library loads only when actually
needed; XML as repeated text-only child elements. `parseFileColumns` reads
headers from just the first 64KB slice — no full-file parse to populate a
mapping UI.

## parseAddress.ts + usStates.ts — freeform → structured US address

Pure paste-to-fill parser, no network. The extension that earned it a test
suite: comma-less single-line pastes ("123 oak st springfield IL 62704"),
split at the **last street-suffix token** from a boundary set of ~40
abbreviated and full suffixes, with secondary units (Ste/Apt/#) absorbed into
addr2. When no boundary is found it keeps the raw text in addr1 and **never
guesses a city**. ZIP and state (trailing code, else longest-first full name
so "West Virginia" beats "Virginia") are peeled off first;
`looksLikeAddress()` gates which pastes trigger fill at all, and
`filledFields()` lets a paste augment a form without wiping typed fields.
`usStates.ts` is the display-side companion: codes are stored, names are
rendered, invalid codes are echoed and flagged rather than dropped.

## weightLbOz.ts — whole-ounce scale-style weight fields

A shipping scale reads whole ounces, so every lb/oz split rounds ounces to a
whole number (overflow carries into the pound: 15.9 oz → 1 lb 0 oz). Blank
fields round-trip to `''` so callers fall back to an auto weight.
`quantizeLbsToWholeOz` exists because the same box weight renders in two
places at once — an editable lb/oz field and a read-only auto caption — and
seeding storage at 0.1-lb precision made them disagree by up to an ounce; it
reuses the exact rounding of `combineToLbs` so auto-seeded and hand-typed
weights serialize byte-identically for stable `===` comparisons.

## keyboard.ts — `isTypingContext`

Shared guard for global shortcuts: true when the event was already consumed
(`defaultPrevented`), the target is an input/textarea/select/contenteditable,
or a modal/drawer owns the screen. Included here because `useEscapeBack`
depends on it.

---

### Seams cut during extraction

- Storage key names, the expiry event name, and page references were
  genericized throughout (`viewStateTtl.ts` and its tests carry a
  representative key list, not the production one).
- `hooks/useProductLookup.ts` (domain-coupled) was excluded per scope; none of
  the included hooks imported it.
- `useEscapeBack`'s upstream pointer to a specific page's inline-edit handler
  was dropped; the pattern itself is documented in the hook comment and
  pinned by its tests.
- Everything else was already self-contained; intra-folder relative imports
  (`../viewStateTtl`, `./useViewStateExpiry`, `../keyboard`, `./usStates`)
  work as laid out here.
