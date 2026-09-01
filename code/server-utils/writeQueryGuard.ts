'use strict';
//
// writeQueryGuard — pure SQL-shape validation for an LLM agent's write endpoint.
//
// This is the security boundary for an ad-hoc "agent write query" API (an
// endpoint that lets an LLM-driven operator agent submit a single DML statement
// against the production database). It is a PURE function (no DB, no IO) so it
// can be unit-tested exhaustively. The route layer adds the runtime safeguards
// that need a connection: dry-run rollback, an affected-row cap, a statement
// timeout, and the audit-log write.
//
// Design — ALLOWLIST the leading verb, then DENYLIST a few specific hazards:
//
//   1. Leading verb must be INSERT / UPDATE / DELETE. A denylist of dangerous
//      keywords (DROP/ALTER/SET/…) is brittle — "SET" is part of UPDATE syntax,
//      identifiers can contain these words. Requiring the statement to BEGIN with
//      a plain DML verb (plus single-statement enforcement) keeps DDL out: each
//      of DROP/TRUNCATE/ALTER/GRANT/CREATE/COPY/DO/CALL/SET would have to be the
//      leading token, which the allowlist rejects.
//
//   2. WITH (CTE) is NOT allowed. A data-modifying CTE — e.g.
//      `WITH d AS (DELETE FROM huge) UPDATE x SET a=1 WHERE id=1` — reports the
//      row count of only the FINAL clause, so it would slip past the affected-row
//      cap and lie to the dry-run preview while mutating thousands of rows. WITH
//      RECURSIVE is also a DoS vector. Targeted updates can be written with a
//      subquery instead (`UPDATE x SET a=1 WHERE id IN (SELECT …)`), which is
//      safe because the cap reflects the real affected count.
//
//   3. Protected tables (the control plane + identity) may not be written: the
//      audit log itself, the kill switch / settings, the migration ledger, and
//      auth tables. This preserves the audit + off-switch even if the data plane
//      is writable, and stops privilege escalation via injected settings keys.
//
//   4. Functions whose effects escape transaction rollback or reach outside the
//      DB (file/network IO, non-transactional sequence resets, cross-session
//      locks) are rejected — a dry-run executes the statement BEFORE rolling
//      back, so these would fire even in "preview" mode.

const ALLOWED_VERBS = ['insert', 'update', 'delete'];

// Control-plane + identity tables the ad-hoc write path must never touch.
const PROTECTED_TABLES = [
  'agent_write_log',    // the audit trail itself — must stay append-only
  'app_settings',       // holds the kill switch + the agent's API key
  '_migration_log',
  '_migrations',
  'employees',          // identity (the only real user table)
  'roles',
  'permissions',
  'role_permissions',
  'sessions',
];

// Functions with effects that survive ROLLBACK or reach outside the database.
const DANGEROUS_FUNCTIONS = [
  'dblink', 'dblink_exec',
  'lo_export', 'lo_import', 'lo_read', 'lo_write', 'lo_create', 'lo_unlink',
  'pg_read_file', 'pg_read_binary_file', 'pg_write_file', 'pg_ls_dir',
  'pg_read_server_files', 'pg_sleep',
  'pg_advisory_lock', 'pg_advisory_unlock', 'pg_advisory_xact_lock',
  'setval',                       // non-transactional sequence reset
  'pg_logical_emit_message',
  'pg_terminate_backend', 'pg_cancel_backend',
];

/**
 * Validate a single write statement.
 * @param {string} rawSql
 * @returns {{ok:false, reason:string, verb?:string}
 *          | {ok:true, verb:string, trimmed:string, hasWhere:boolean}}
 */
export function validateWriteSql(rawSql: string) {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    return { ok: false, reason: 'sql (non-empty string) is required' };
  }

  // Strip a single trailing semicolon + surrounding whitespace, then reject if
  // any further statement remains (semicolon followed by non-whitespace). The
  // route also forces the extended wire protocol, so Postgres rejects
  // multi-statement bodies too (defense in depth).
  const trimmed = rawSql.replace(/;\s*$/g, '').trim();
  if (/;\s*\S/.test(trimmed)) {
    return { ok: false, reason: 'Only a single statement is allowed' };
  }

  // Leading-verb allowlist. The statement must START with a write verb — this
  // also rejects leading comments (`-- …`, `/* … */`), since after trim the
  // first character would not be a letter.
  const m = trimmed.match(/^([a-zA-Z]+)/);
  const verb = m ? m[1].toLowerCase() : '';
  if (!ALLOWED_VERBS.includes(verb)) {
    return {
      ok: false,
      verb,
      reason:
        `Statement must begin with INSERT, UPDATE, or DELETE ` +
        `(got "${verb || '?'}"). WITH/CTE statements and read-only queries are ` +
        `not allowed here — reads belong on /read_query.`,
    };
  }

  // Protected-table denylist — match table names as whole words anywhere in the
  // statement (covers subquery references too; erring toward rejection is safe).
  for (const t of PROTECTED_TABLES) {
    if (new RegExp(`\\b${t}\\b`, 'i').test(trimmed)) {
      return { ok: false, verb, reason: `write_query may not reference the protected table "${t}".` };
    }
  }

  // Dangerous-function denylist.
  for (const fn of DANGEROUS_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\b`, 'i').test(trimmed)) {
      return { ok: false, verb, reason: `write_query may not call the function "${fn}".` };
    }
  }

  const hasWhere = /\bwhere\b/i.test(trimmed);
  return { ok: true, verb, trimmed, hasWhere };
}

export { ALLOWED_VERBS, PROTECTED_TABLES, DANGEROUS_FUNCTIONS };
