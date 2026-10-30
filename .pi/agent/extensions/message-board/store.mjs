import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, digest } from './protocol.mjs';

const SCHEMA_VERSION = 1;
const SCHEMA_BUSY_MS = 3000;
const SCHEMA_ATTEMPTS_MAX = 3;
const SCHEMA_RETRY_MS = 25;
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const LEGACY_JOB_COLUMNS = ['id', 'token_hash', 'definition', 'revision', 'state', 'stage'];
const JOBS_SCHEMA = `id TEXT PRIMARY KEY, task_key TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, stage TEXT NOT NULL`;

export class BoardSchemaError extends Error {
  constructor(message) { super(message); this.name = 'BoardSchemaError'; }
}

function enableWal(database) {
  const deadline = performance.now() + SCHEMA_BUSY_MS;
  const waiter = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  // Concurrent DELETE-to-WAL transitions can fail immediately despite busy_timeout; no data writes have begun.
  for (let attempt = 0; attempt < SCHEMA_ATTEMPTS_MAX; attempt++) {
    database.exec(`PRAGMA busy_timeout=${Math.max(1, Math.floor(deadline - performance.now()))}`);
    try {
      database.exec('PRAGMA journal_mode=WAL');
      database.exec(`PRAGMA busy_timeout=${SCHEMA_BUSY_MS}`);
      return;
    } catch (error) {
      if (![SQLITE_BUSY, SQLITE_LOCKED].includes(error?.errcode) || attempt + 1 === SCHEMA_ATTEMPTS_MAX || performance.now() >= deadline) throw error;
      Atomics.wait(waiter, 0, 0, Math.min(SCHEMA_RETRY_MS, Math.max(0, deadline - performance.now())));
    }
  }
}

function upgradeLegacyJobs(database, jobsMax) {
  // Dropping the old table can cascade into custom dependents even when replacement IDs are identical.
  if (database.prepare(`SELECT 1 FROM sqlite_schema AS objects JOIN pragma_foreign_key_list(objects.name) AS dependency
    WHERE objects.type='table' AND dependency."table"='jobs' LIMIT 1`).get()) throw new BoardSchemaError('Legacy board has dependent foreign keys; schema migration requires manual review. Preserve all history.');
  if (database.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name='jobs' AND type IN ('index','trigger') AND sql IS NOT NULL LIMIT 1").get()) throw new BoardSchemaError('Unsupported custom jobs schema; preserve board history and review the migration manually.');
  const rows = database.prepare(`SELECT rowid AS original_rowid,id,token_hash,revision,state,stage,
    CASE WHEN length(CAST(definition AS BLOB))<=? THEN definition END AS definition
    FROM jobs ORDER BY rowid DESC LIMIT ?`).all(LIMITS.response_bytes, jobsMax + 1);
  if (rows.length > jobsMax) throw new BoardSchemaError('Legacy board exceeds the supported migration job limit; preserve its history and review migration capacity.');
  database.exec(`CREATE TABLE jobs_task_key_migration (${JOBS_SCHEMA})`);
  const insert = database.prepare('INSERT INTO jobs_task_key_migration(rowid,id,task_key,token_hash,definition,revision,state,stage) VALUES(?,?,?,?,?,?,?,?)');
  const used = new Set();
  for (const row of rows) {
    let definition;
    try {
      if (typeof row.definition !== 'string') throw new Error('Invalid assignment');
      definition = JSON.parse(row.definition);
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('Invalid assignment');
    } catch { throw new BoardSchemaError('Invalid or oversized legacy assignment; schema migration rolled back. Inspect the existing board backup/data, not model authentication.'); }
    const logical = digest(JSON.stringify(definition));
    // Newest owns the logical key; older duplicates retain distinct keys and unchanged history/rowids.
    const key = used.has(logical) ? 'legacy_' + digest(row.id) : logical;
    if (used.has(key)) throw new BoardSchemaError('Legacy migration key collision; preserve board history and review the migration manually.');
    used.add(key);
    insert.run(row.original_rowid, row.id, key, row.token_hash, row.definition, row.revision, row.state, row.stage);
  }
  database.exec('DROP TABLE jobs; ALTER TABLE jobs_task_key_migration RENAME TO jobs;');
}

export class BoardStore {
  constructor(path, limits = LIMITS) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    this.limits = limits;
    let transaction = false;
    try {
      this.database = new DatabaseSync(join(path, 'board.sqlite'));
      chmodSync(join(path, 'board.sqlite'), 0o600);
      enableWal(this.database);
      this.database.exec('BEGIN IMMEDIATE');
      transaction = true;
      if (this.database.prepare('PRAGMA user_version').get().user_version > SCHEMA_VERSION) throw new BoardSchemaError('Board schema is newer than this extension; upgrade Pi message-board code. Do not reset or delete its history.');
      const columns = this.database.prepare('PRAGMA table_info(jobs)').all();
      const names = columns.map(column => column.name);
      const legacy = names.length === LEGACY_JOB_COLUMNS.length && LEGACY_JOB_COLUMNS.every(name => names.includes(name));
      const current = names.length === LEGACY_JOB_COLUMNS.length + 1 && [...LEGACY_JOB_COLUMNS, 'task_key'].every(name => names.includes(name));
      if (names.length && !legacy && !current) throw new BoardSchemaError('Unsupported board jobs schema; preserve its history and review the migration before retrying.');
      if (legacy) upgradeLegacyJobs(this.database, this.limits.jobs);
      if (current && (!columns.find(column => column.name === 'task_key').notnull || !this.database.prepare(`SELECT 1 FROM pragma_index_list('jobs') AS indexes
        WHERE indexes."unique"=1 AND indexes.partial=0
        AND (SELECT count(*) FROM pragma_index_info(indexes.name))=1
        AND EXISTS (SELECT 1 FROM pragma_index_info(indexes.name) WHERE name='task_key') LIMIT 1`).get())) throw new BoardSchemaError('Incomplete task-key schema; preserve board history and review the migration manually.');
      this.database.exec(`CREATE TABLE IF NOT EXISTS jobs (${JOBS_SCHEMA});
        CREATE TABLE IF NOT EXISTS events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, job_id TEXT NOT NULL,
          revision INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL,
          payload TEXT NOT NULL, created_ms INTEGER NOT NULL, consumer TEXT, handled INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0, answer TEXT);
        CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS event_rate ON events(job_id,created_ms);
        PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`);
      transaction = false;
    } catch (error) {
      let failure = error instanceof BoardSchemaError ? error : new BoardSchemaError('Board schema initialization/migration failed; inspect schema, storage and permissions. Preserve board history; no workers were launched by this operation.');
      if (transaction) {
        try { this.database.exec('ROLLBACK'); }
        catch { failure = new BoardSchemaError('Board schema rollback could not be confirmed; stop and inspect SQLite storage/backups before any retry. Do not delete its history.'); }
      }
      try { this.database?.close(); }
      catch { throw new BoardSchemaError('Board schema connection cleanup failed; inspect SQLite storage before continuing. Preserve its history.'); }
      throw failure;
    }
  }
  close() { this.database.close(); }
  jobs() {
    return this.database.prepare('SELECT id,definition,revision,state,stage FROM jobs ORDER BY rowid LIMIT ?').all(this.limits.jobs)
      .map(row => ({ ...row, definition: JSON.parse(row.definition) }));
  }
  job(id) { return this.jobs().find(job => job.id === id); }
  authenticate(token) {
    return this.database.prepare('SELECT id FROM jobs WHERE token_hash=?').get(digest(token))?.id;
  }
  findTask(key) {
    const row = this.database.prepare('SELECT id FROM jobs WHERE task_key=?').get(key);
    return row ? this.job(row.id) : undefined;
  }
  createJob(definition, token, key = digest(JSON.stringify(definition))) {
    if (this.database.prepare('SELECT count(*) AS count FROM jobs').get().count >= this.limits.jobs) throw new Error('Parent-session board job limit reached');
    const id = randomUUID();
    this.database.prepare('INSERT INTO jobs(id,task_key,token_hash,definition,revision,state,stage) VALUES(?,?,?,?,1,?,?)').run(id, key, digest(token), JSON.stringify(definition), 'starting', 'assigned');
    return this.job(id);
  }
  updateJob(id, patch) {
    const previous = this.job(id);
    if (!previous) throw new Error('Unknown worker');
    const next = { ...previous, ...patch };
    this.database.prepare('UPDATE jobs SET definition=?,revision=?,state=?,stage=? WHERE id=?')
      .run(JSON.stringify(next.definition), next.revision, next.state, next.stage, id);
    return next;
  }
  post(jobId, revision, input, source = 'worker', eventId = randomUUID(), payload = {}) {
    const previous = this.database.prepare('SELECT * FROM events WHERE id=?').get(eventId);
    if (previous) {
      if (previous.job_id !== jobId || previous.revision !== revision || previous.kind !== input.kind ||
          previous.summary !== input.summary || previous.payload !== JSON.stringify({ ...input, ...payload })) {
        throw new Error('Event ID was already used for a different report');
      }
      return { id: previous.id, sequence: previous.sequence, duplicate: true };
    }
    const job = this.job(jobId);
    if (!job || revision !== job.revision) throw new Error('Unknown worker or stale assignment');
    if (source === 'worker' && this.database.prepare('SELECT count(*) AS count FROM events WHERE job_id=? AND created_ms>?').get(jobId, Date.now() - LIMITS.minute_ms).count >= this.limits.reports_per_minute) {
      throw new Error('Worker report rate limit reached; do not flood the parent');
    }
    if (this.database.prepare('SELECT count(*) AS count FROM events').get().count >= this.limits.events) throw new Error('Board event capacity reached; no report was discarded');
    const result = this.database.prepare(`INSERT INTO events(id,job_id,revision,source,kind,summary,payload,created_ms)
      VALUES(?,?,?,?,?,?,?,?)`).run(eventId, jobId, revision, source, input.kind, input.summary, JSON.stringify({ ...input, ...payload }), Date.now());
    if (source === 'worker' && ['needs_decision', 'result', 'failed'].includes(input.kind)) {
      this.updateJob(jobId, { stage: input.kind === 'result' ? 'result_reported' : input.kind });
    }
    return { id: eventId, sequence: Number(result.lastInsertRowid), duplicate: false };
  }
  pending() {
    return this.database.prepare('SELECT count(*) AS count FROM events WHERE handled=0').get().count;
  }
  claim(consumer) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (this.database.prepare('SELECT 1 FROM events WHERE handled=0 AND consumer=? LIMIT 1').get(consumer)) {
        this.database.exec('COMMIT');
        return [];
      }
      const rows = this.database.prepare('SELECT * FROM events WHERE handled=0 ORDER BY sequence LIMIT ?').all(this.limits.batch);
      if (!rows.length || rows[0].consumer || rows[0].attempts >= this.limits.attempts) {
        this.database.exec('COMMIT');
        return [];
      }
      const claimed = [];
      for (const row of rows) {
        if (row.consumer || row.attempts >= this.limits.attempts) break;
        this.database.prepare('UPDATE events SET consumer=?,attempts=attempts+1 WHERE id=?').run(consumer, row.id);
        claimed.push({ ...row, payload: JSON.parse(row.payload), attempts: row.attempts + 1,
          answer: row.answer === null ? null : row.answer.slice(0, this.limits.status_text),
          answerTruncated: row.answer !== null && row.answer.length > this.limits.status_text });
      }
      this.database.exec('COMMIT');
      return claimed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  acknowledge(consumer, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > this.limits.batch) throw new Error('Acknowledge a bounded delivered batch');
    const rows = ids.map(id => this.database.prepare('SELECT * FROM events WHERE id=?').get(id));
    if (rows.some(row => !row || (!row.handled && row.consumer !== consumer))) throw new Error('Cannot acknowledge another consumer delivery');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) this.database.prepare('UPDATE events SET handled=1,consumer=NULL WHERE id=?').run(id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  release(consumer) {
    this.database.prepare('UPDATE events SET consumer=NULL WHERE consumer=? AND handled=0').run(consumer);
  }
  recover() {
    this.database.prepare('UPDATE events SET consumer=NULL WHERE handled=0').run();
    return this.jobs().filter(job => !['cancelled', 'exited', 'interrupted'].includes(job.state));
  }
  event(id) {
    const row = this.database.prepare('SELECT * FROM events WHERE id=?').get(id);
    return row ? { ...row, payload: JSON.parse(row.payload) } : undefined;
  }
  answer(id, answer) {
    if (!this.event(id)) throw new Error('Unknown event');
    this.database.prepare('UPDATE events SET answer=? WHERE id=?').run(answer, id);
  }
  availability() {
    const rows = this.database.prepare(`SELECT jobs.state,jobs.stage,count(events.id) AS pending
      FROM jobs LEFT JOIN events ON events.job_id=jobs.id AND events.handled=0
      GROUP BY jobs.id ORDER BY jobs.rowid LIMIT ?`).all(this.limits.jobs);
    const agents = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (['cancelled', 'exited', 'interrupted'].includes(row.state) && !row.pending) continue;
      if (row.state === 'idle' && !row.pending && row.stage !== 'needs_decision') continue;
      let state = 'idle';
      if (row.stage === 'startup_failed' || row.stage === 'failed' || row.state === 'error') state = 'error';
      else if (row.state === 'interrupted') state = 'interrupted';
      else if (row.state === 'cancelled') state = 'stopped';
      else if (row.state === 'exited' && row.stage !== 'result_reported') state = 'error';
      else if (row.stage === 'needs_decision') state = 'blocked';
      else if (row.stage === 'result_reported') state = 'ready';
      else if (['starting', 'working', 'cancelling'].includes(row.state)) state = 'working';
      agents.push({ ordinal: index + 1, state });
    }
    const head = this.database.prepare('SELECT attempts,consumer FROM events WHERE handled=0 ORDER BY sequence LIMIT 1').get();
    return { pending: this.pending(), stalled: !!head && head.attempts >= this.limits.attempts && !head.consumer, agents };
  }
  status() {
    const unresolved = this.database.prepare(`SELECT events.id,job_id,summary,handled FROM events
      JOIN jobs ON jobs.id=events.job_id WHERE kind='needs_decision' AND answer IS NULL
      AND events.revision=jobs.revision ORDER BY sequence LIMIT ?`).all(this.limits.decisions)
      .map(row => ({ ...row, summary: row.summary.slice(0, this.limits.status_text), summaryTruncated: row.summary.length > this.limits.status_text }));
    const jobs = this.jobs().map(({ definition, ...job }) => ({ ...job,
      cwdPreview: definition.cwd.slice(0, this.limits.status_text), taskPreview: definition.task.slice(0, this.limits.status_text),
      ...(definition.ticketBinding ? { ticketId: definition.ticketBinding.ticketId, projectUrl: definition.ticketBinding.projectUrl } : {}) }));
    return { jobs, unresolved, ...this.availability() };
  }
  retry() {
    this.database.prepare('UPDATE events SET attempts=0 WHERE handled=0 AND consumer IS NULL').run();
  }
  remembered(id, fingerprint) {
    const row = this.database.prepare('SELECT * FROM commands WHERE id=?').get(id);
    if (!row) return undefined;
    if (row.fingerprint !== fingerprint) throw new Error('Command ID already used for a different action');
    const result = JSON.parse(row.result);
    if (result.error) throw new Error(result.error);
    return result;
  }
  failCommand(id) {
    this.database.prepare('UPDATE commands SET result=? WHERE id=?').run(JSON.stringify({ error: 'Previous command did not complete. Inspect status before sending a new command.' }), id);
  }
  ensureCommandCapacity() {
    if (this.database.prepare('SELECT count(*) AS count FROM commands').get().count >= this.limits.events) throw new Error('Board command capacity reached');
  }
  remember(id, fingerprint, result) {
    this.ensureCommandCapacity();
    this.database.prepare('INSERT INTO commands VALUES(?,?,?)').run(id, fingerprint, JSON.stringify(result));
  }
}
