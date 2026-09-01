'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateWriteSql } = require('../writeQueryGuard');

// ── Accepts the write verbs ─────────────────────────────────────────────────
test('accepts UPDATE with WHERE', () => {
  const r = validateWriteSql("UPDATE products SET name='x' WHERE id='a'");
  assert.equal(r.ok, true);
  assert.equal(r.verb, 'update');
  assert.equal(r.hasWhere, true);
});

test('accepts lowercase verbs', () => {
  const r = validateWriteSql("update products set name='x' where id='a'");
  assert.equal(r.ok, true);
  assert.equal(r.verb, 'update');
});

test('accepts DELETE with WHERE', () => {
  const r = validateWriteSql('DELETE FROM order_items WHERE id = $1');
  assert.equal(r.ok, true);
  assert.equal(r.verb, 'delete');
  assert.equal(r.hasWhere, true);
});

test('accepts INSERT (no WHERE expected)', () => {
  const r = validateWriteSql('INSERT INTO journal_entries (id, memo) VALUES ($1, $2)');
  assert.equal(r.ok, true);
  assert.equal(r.verb, 'insert');
  assert.equal(r.hasWhere, false);
});

test('accepts UPDATE driven by a subquery (the safe alternative to a CTE)', () => {
  const r = validateWriteSql(
    "UPDATE order_items SET cost = 0 " +
    "WHERE order_id IN (SELECT id FROM orders WHERE status = 'x')"
  );
  assert.equal(r.ok, true);
  assert.equal(r.verb, 'update');
  assert.equal(r.hasWhere, true);
});

test('strips a single trailing semicolon and surrounding whitespace', () => {
  const r = validateWriteSql("  UPDATE x SET a = 1 WHERE id = 'b' ;  \n");
  assert.equal(r.ok, true);
  assert.equal(r.verb, 'update');
});

// ── hasWhere flag ───────────────────────────────────────────────────────────
test('flags UPDATE without WHERE as hasWhere=false', () => {
  const r = validateWriteSql('UPDATE products SET active = false');
  assert.equal(r.ok, true);
  assert.equal(r.hasWhere, false);
});

test('flags DELETE without WHERE as hasWhere=false', () => {
  const r = validateWriteSql('DELETE FROM products');
  assert.equal(r.ok, true);
  assert.equal(r.hasWhere, false);
});

// ── Rejects reads (those belong on the read endpoint) ───────────────────────
test('rejects SELECT', () => {
  const r = validateWriteSql('SELECT * FROM products');
  assert.equal(r.ok, false);
  assert.equal(r.verb, 'select');
});

// ── Rejects WITH/CTE (row-count hiding + recursive DoS) ─────────────────────
test('rejects data-modifying WITH (hides blast radius from the row cap)', () => {
  const r = validateWriteSql(
    'WITH d AS (DELETE FROM orders) UPDATE products SET active=false WHERE id=$1'
  );
  assert.equal(r.ok, false);
  assert.equal(r.verb, 'with');
});

test('rejects WITH RECURSIVE', () => {
  const r = validateWriteSql(
    'WITH RECURSIVE t AS (SELECT 1 n UNION ALL SELECT n+1 FROM t WHERE n<10) ' +
    'DELETE FROM x WHERE id IN (SELECT n FROM t)'
  );
  assert.equal(r.ok, false);
});

// ── Rejects writes to protected (control-plane / identity) tables ───────────
for (const sql of [
  'DELETE FROM agent_write_log',
  "DELETE FROM agent_write_log WHERE created_at < NOW() - INTERVAL '1 day'",
  "UPDATE settings SET value='true' WHERE key='agent_write_enabled'",
  "INSERT INTO settings (key, value) VALUES ('backdoor', 'true')",
  "UPDATE users SET role='superadmin' WHERE id=$1",
  'DELETE FROM permissions WHERE id=$1',
  "UPDATE products SET note=(SELECT value FROM settings WHERE key='x') WHERE id=$1",
]) {
  test(`rejects write touching a protected table: ${sql.slice(0, 32)}`, () => {
    const r = validateWriteSql(sql);
    assert.equal(r.ok, false, `expected reject for: ${sql}`);
    assert.match(r.reason, /protected table/i);
  });
}

// ── Rejects Unicode-escaped names (they hide from the word match) ──────────
for (const sql of [
  `UPDATE U&"\\0075sers" SET role='x' WHERE id=$1`,
  `UPDATE u&"\\0073ettings" SET value='x' WHERE id=$1`,
  `UPDATE x SET a = U&"pg\\005fsleep"(5) WHERE id=$1`,
  `UPDATE x SET a = U&'\\0041' WHERE id=$1`,
]) {
  test(`rejects Unicode-escaped name: ${sql.slice(0, 32)}`, () => {
    const r = validateWriteSql(sql);
    assert.equal(r.ok, false, `expected reject for: ${sql}`);
    assert.match(r.reason, /Unicode/);
  });
}

test('still allows an ampersand in an ordinary value', () => {
  const r = validateWriteSql("UPDATE products SET note='R&D' WHERE id=$1");
  assert.equal(r.ok, true);
});

// ── Rejects dangerous functions (effects survive rollback / reach outside) ──
for (const sql of [
  "DELETE FROM orders WHERE dblink('host=evil','SELECT 1') IS NOT NULL",
  "UPDATE products SET x = pg_read_file('/etc/passwd') WHERE id=$1",
  "INSERT INTO logs (v) VALUES (setval('some_seq', 1))",
  'UPDATE x SET a=1 WHERE pg_advisory_lock(42) IS NULL',
  "UPDATE x SET a = lo_export(1, '/tmp/x') WHERE id=$1",
]) {
  test(`rejects dangerous function: ${sql.slice(0, 32)}`, () => {
    const r = validateWriteSql(sql);
    assert.equal(r.ok, false, `expected reject for: ${sql}`);
    assert.match(r.reason, /function/i);
  });
}

// ── A longer name that starts with a blocked one is the same hazard ─────────
for (const fn of [
  "pg_sleep_for('1 second')",
  "pg_sleep_until(now())",
  'pg_advisory_lock_shared(42)',
  'pg_try_advisory_lock(42)',
  'pg_try_advisory_xact_lock_shared(42)',
  'pg_advisory_unlock_all()',
  "dblink_connect('c')",
  "dblink_send_query('c', 'x')",
]) {
  test(`a dry-run cannot fire a rollback-proof call by its longer name: ${fn}`, () => {
    const r = validateWriteSql(`UPDATE products SET note='x' WHERE id=1 AND ${fn} IS NOT NULL`);
    assert.equal(r.ok, false, `expected reject for: ${fn}`);
    assert.match(r.reason, /function/i);
  });
}

// ── Functions that run SQL handed to them as a string ───────────────────────
for (const fn of [
  "query_to_xml('select 1', true, false, '')",
  "query_to_xmlschema('select 1', true, false, '')",
  "query_to_xml_and_xmlschema('select 1', true, false, '')",
  "cursor_to_xml('c', 1, true, false, '')",
  "cursor_to_xmlschema('c', true, false, '')",
]) {
  test(`SQL hidden inside a string cannot slip past the block list: ${fn.slice(0, 24)}`, () => {
    const r = validateWriteSql(`UPDATE products SET note=${fn}::text WHERE id=1`);
    assert.equal(r.ok, false, `expected reject for: ${fn}`);
    assert.match(r.reason, /function/i);
  });
}

// ── Still allows ordinary writes to normal data tables ──────────────────────
test('allows a normal UPDATE to a data table', () => {
  const r = validateWriteSql("UPDATE orders SET status='completed' WHERE id=$1");
  assert.equal(r.ok, true);
});

// ── Rejects DDL / dangerous verbs via the leading-verb allowlist ────────────
for (const ddl of [
  'DROP TABLE products',
  'TRUNCATE orders',
  'ALTER TABLE products ADD COLUMN x int',
  'GRANT ALL ON products TO public',
  'REVOKE ALL ON products FROM public',
  'CREATE TABLE evil (id int)',
  'REINDEX TABLE products',
  'CLUSTER products',
  'VACUUM FULL products',
  'COPY products FROM \'/etc/passwd\'',
  'DO $$ BEGIN PERFORM 1; END $$',
  'CALL some_proc()',
  'SET search_path = evil',
  'GRANT',
]) {
  test(`rejects DDL/dangerous: ${ddl.slice(0, 24)}`, () => {
    const r = validateWriteSql(ddl);
    assert.equal(r.ok, false, `expected reject for: ${ddl}`);
  });
}

// ── Rejects multi-statement smuggling ───────────────────────────────────────
test('rejects two statements separated by semicolon', () => {
  const r = validateWriteSql("UPDATE x SET a=1 WHERE id='b'; DROP TABLE y");
  assert.equal(r.ok, false);
  assert.match(r.reason, /single statement/i);
});

test('rejects a trailing SELECT after a write', () => {
  const r = validateWriteSql("DELETE FROM x WHERE id='b'; SELECT 1");
  assert.equal(r.ok, false);
  assert.match(r.reason, /single statement/i);
});

// ── Rejects comment-hidden DDL (statement must START with a write verb) ─────
test('rejects line-comment then DROP', () => {
  const r = validateWriteSql('-- harmless\nDROP TABLE products');
  assert.equal(r.ok, false);
});

test('rejects block-comment then DROP', () => {
  const r = validateWriteSql('/* note */ DROP TABLE products');
  assert.equal(r.ok, false);
});

// ── Rejects empty / non-string input ────────────────────────────────────────
for (const bad of ['', '   ', '\n', null, undefined, 42, {}]) {
  test(`rejects empty/non-string input: ${JSON.stringify(bad)}`, () => {
    const r = validateWriteSql(bad);
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  });
}
