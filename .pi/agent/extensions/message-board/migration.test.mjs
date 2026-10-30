import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardStore } from './store.mjs';
import { digest, LIMITS } from './protocol.mjs';
import { legacyBoard, LEGACY_JOBS_SCHEMA, LEGACY_TOKENS } from './migration-fixture.mjs';

const definition = { cwd: tmpdir(), task: 'Historical assignment', scope: ['fixture.txt'], acceptance: ['Preserve history'] };
function snapshot(database) {
  return {
    jobs: database.prepare('SELECT rowid,id,token_hash,definition,revision,state,stage FROM jobs ORDER BY rowid').all(),
    events: database.prepare('SELECT * FROM events ORDER BY sequence').all(),
    commands: database.prepare('SELECT * FROM commands ORDER BY id').all(),
  };
}

for (const scenario of ['fresh', 'legacy']) test(`${scenario} board supports an unassigned logical-task lookup`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-schema-lookup-'));
  let store;
  try {
    if (scenario === 'legacy') {
      const database = new DatabaseSync(join(directory, 'board.sqlite'));
      try { database.exec(LEGACY_JOBS_SCHEMA); } finally { database.close(); }
    }
    store = new BoardStore(directory);
    assert.equal(store.findTask('unassigned-diagnostic-task'), undefined);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('populated legacy upgrade preserves every history field and row order, chooses the newest duplicate, and reopens idempotently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-schema-history-'));
  let store;
  try {
    legacyBoard(directory, definition);
    const original = new DatabaseSync(join(directory, 'board.sqlite'));
    let before;
    try {
      original.prepare("UPDATE events SET consumer='retained-lease' WHERE id='legacy-pending'").run();
      before = snapshot(original);
    } finally { original.close(); }
    store = new BoardStore(directory);
    assert.deepEqual(snapshot(store.database), before, 'Migration must not change jobs, hashes, assignment revisions, states, leases, answers, handled state, or commands');
    assert.equal(store.findTask(digest(JSON.stringify(definition))).id, 'legacy-newest');
    assert.equal(store.authenticate(LEGACY_TOKENS[0]), 'legacy-oldest');
    assert.equal(store.authenticate(LEGACY_TOKENS[1]), 'legacy-newest');
    assert.deepEqual(store.remembered('legacy-command', 'legacy-fingerprint'), { accepted: true, jobId: 'legacy-newest' });
    const upgraded = store.database.prepare('SELECT rowid,* FROM jobs ORDER BY rowid').all();
    assert.equal(new Set(upgraded.map(job => job.task_key)).size, 2);
    assert.equal(store.findTask(upgraded[0].task_key).id, 'legacy-oldest', 'Older duplicate remains individually addressable');
    assert.match(upgraded[0].task_key, /^legacy_[0-9a-f]{64}$/);
    store.close(); store = new BoardStore(directory);
    assert.deepEqual(store.database.prepare('SELECT rowid,* FROM jobs ORDER BY rowid').all(), upgraded);
    assert.deepEqual(snapshot(store.database), before);
    const next = store.createJob({ ...definition, task: 'New assignment' }, 'new-fixture-capability');
    assert.equal(next.state, 'starting');
    assert.equal(next.definition.task, 'New assignment');
    assert.equal(store.authenticate('new-fixture-capability'), next.id);
    assert.equal(store.database.prepare('SELECT token_hash FROM jobs WHERE id=?').get(next.id).token_hash, digest('new-fixture-capability'));
    assert.equal(store.database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failed legacy backfill rolls back all DDL/copies and returns a safe actionable error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-schema-rollback-'));
  try {
    legacyBoard(directory, definition);
    const original = new DatabaseSync(join(directory, 'board.sqlite'));
    let before;
    try {
      original.prepare("UPDATE jobs SET definition=? WHERE id='legacy-oldest'").run('{PRIVATE_ASSIGNMENT_CANARY');
      before = snapshot(original);
    } finally { original.close(); }
    assert.throws(() => new BoardStore(directory), error => {
      assert.equal(error.name, 'BoardSchemaError');
      assert.match(error.message, /schema|migration/i);
      assert.ok(!error.message.includes('PRIVATE_ASSIGNMENT_CANARY'));
      return true;
    });
    const retained = new DatabaseSync(join(directory, 'board.sqlite'));
    try {
      assert.deepEqual(snapshot(retained), before);
      assert.deepEqual(retained.prepare('PRAGMA table_info(jobs)').all().map(column => column.name), ['id', 'token_hash', 'definition', 'revision', 'state', 'stage']);
      assert.equal(retained.prepare('PRAGMA user_version').get().user_version, 0);
      assert.equal(retained.prepare("SELECT name FROM sqlite_schema WHERE name='jobs_task_key_migration'").get(), undefined);
      retained.prepare("UPDATE jobs SET definition=? WHERE id='legacy-oldest'").run(JSON.stringify(definition));
    } finally { retained.close(); }
    const repaired = new BoardStore(directory);
    try { assert.equal(repaired.findTask(digest(JSON.stringify(definition))).id, 'legacy-newest'); }
    finally { repaired.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('unsupported future versions and oversized legacy boards are rejected without dropping history', () => {
  for (const scenario of ['future', 'capacity']) {
    const directory = mkdtempSync(join(tmpdir(), 'pi-schema-reject-'));
    try {
      legacyBoard(directory, definition);
      const original = new DatabaseSync(join(directory, 'board.sqlite'));
      let before;
      try {
        if (scenario === 'future') original.exec('PRAGMA user_version=999');
        before = snapshot(original);
      } finally { original.close(); }
      assert.throws(() => new BoardStore(directory, scenario === 'capacity' ? { ...LIMITS, jobs: 1 } : LIMITS), /schema|migration/i);
      const retained = new DatabaseSync(join(directory, 'board.sqlite'));
      try { assert.deepEqual(snapshot(retained), before); } finally { retained.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('named job insertion also supports a valid current schema with task_key physically last', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-schema-column-order-'));
  let store;
  try {
    const original = new DatabaseSync(join(directory, 'board.sqlite'));
    try { original.exec(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, definition TEXT NOT NULL,
      revision INTEGER NOT NULL, state TEXT NOT NULL, stage TEXT NOT NULL, task_key TEXT NOT NULL UNIQUE)`); }
    finally { original.close(); }
    store = new BoardStore(directory);
    const job = store.createJob(definition, 'ordered-fixture-capability');
    assert.deepEqual(job.definition, definition);
    assert.equal(store.authenticate('ordered-fixture-capability'), job.id);
    assert.equal(store.findTask(digest(JSON.stringify(definition))).id, job.id);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('independent processes serialize one legacy upgrade without changing history', { timeout: 15000 }, async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const directory = mkdtempSync(join(tmpdir(), 'pi-schema-concurrent-'));
  try {
    legacyBoard(directory, definition);
    const original = new DatabaseSync(join(directory, 'board.sqlite'));
    let before;
    try { before = snapshot(original); } finally { original.close(); }
    const source = `import { BoardStore } from ${JSON.stringify(new URL('./store.mjs', import.meta.url).href)}; const store = new BoardStore(process.argv[1]); try { console.log(store.findTask(${JSON.stringify(digest(JSON.stringify(definition)))}).id); } finally { store.close(); }`;
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, directory], { timeout: 10000, maxBuffer: 65536 })));
    for (const result of results) {
      assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? result.reason.stderr : undefined);
      assert.equal(result.value.stdout.trim(), 'legacy-newest');
    }
    const retained = new DatabaseSync(join(directory, 'board.sqlite'));
    try { assert.deepEqual(snapshot(retained), before); } finally { retained.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('process death before migration commit leaves the complete legacy database recoverable', { timeout: 15000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const directory = mkdtempSync(join(tmpdir(), 'pi-schema-killed-'));
  let child;
  try {
    legacyBoard(directory, definition);
    const original = new DatabaseSync(join(directory, 'board.sqlite'));
    let before;
    try { before = snapshot(original); } finally { original.close(); }
    const source = `import {DatabaseSync} from 'node:sqlite'; import {BoardStore} from ${JSON.stringify(new URL('./store.mjs', import.meta.url).href)}; const original=DatabaseSync.prototype.exec; DatabaseSync.prototype.exec=function(sql) { if (sql.includes('DROP TABLE jobs')) { process.stdout.write('copy-ready\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000); } return original.call(this,sql); }; const store=new BoardStore(process.argv[1]); store.close();`;
    child = spawn(process.execPath, ['--input-type=module', '-e', source, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536); });
    const deadline = AbortSignal.timeout(10000);
    const ready = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', () => resolve());
      child.once('exit', () => reject(new Error('Migration exited before the pre-commit checkpoint')));
      deadline.addEventListener('abort', () => reject(new Error('Migration pre-commit checkpoint timed out')), { once: true });
    });
    await ready;
    assert.match(output, /copy-ready/);
    const ended = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
    child.kill('SIGKILL');
    await ended;
    const retained = new DatabaseSync(join(directory, 'board.sqlite'));
    try {
      assert.deepEqual(snapshot(retained), before);
      assert.equal(retained.prepare('PRAGMA table_info(jobs)').all().some(column => column.name === 'task_key'), false);
      assert.equal(retained.prepare("SELECT name FROM sqlite_schema WHERE name='jobs_task_key_migration'").get(), undefined);
      assert.equal(retained.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    } finally { retained.close(); }
    const repaired = new BoardStore(directory);
    try { assert.equal(repaired.findTask(digest(JSON.stringify(definition))).id, 'legacy-newest'); } finally { repaired.close(); }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy foreign-key dependents refuse automatic rebuild rather than cascading away history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-schema-dependent-'));
  try {
    legacyBoard(directory, definition);
    const original = new DatabaseSync(join(directory, 'board.sqlite'));
    let before;
    try {
      original.exec("CREATE TABLE dependent_history (id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE); INSERT INTO dependent_history VALUES('dependent-history','legacy-newest');");
      before = { ...snapshot(original), dependent: original.prepare('SELECT * FROM dependent_history').all() };
    } finally { original.close(); }
    assert.throws(() => {
      const unexpected = new BoardStore(directory);
      unexpected.close();
    }, /custom.*schema|dependent|migration/i);
    const retained = new DatabaseSync(join(directory, 'board.sqlite'));
    try { assert.deepEqual({ ...snapshot(retained), dependent: retained.prepare('SELECT * FROM dependent_history').all() }, before); } finally { retained.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
