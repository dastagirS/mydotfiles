import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from './protocol.mjs';

export const LEGACY_JOBS_SCHEMA = `CREATE TABLE jobs (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, definition TEXT NOT NULL,
  revision INTEGER NOT NULL, state TEXT NOT NULL, stage TEXT NOT NULL
)`;
export const LEGACY_TOKENS = ['legacy-fixture-' + 'a'.repeat(32), 'legacy-fixture-' + 'b'.repeat(32)];

export function legacyBoard(directory, definition) {
  mkdirSync(directory, { recursive: true });
  assert.equal(existsSync(join(directory, 'board.sqlite')), false, 'Fixture must never replace an existing board');
  const database = new DatabaseSync(join(directory, 'board.sqlite'));
  try {
    database.exec(`${LEGACY_JOBS_SCHEMA};
      CREATE TABLE events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, job_id TEXT NOT NULL,
        revision INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL,
        payload TEXT NOT NULL, created_ms INTEGER NOT NULL, consumer TEXT, handled INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, answer TEXT);
      CREATE TABLE commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
      CREATE INDEX event_rate ON events(job_id,created_ms);`);
    const insert = database.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?)');
    insert.run('legacy-oldest', digest(LEGACY_TOKENS[0]), JSON.stringify(definition), 2, 'interrupted', 'assigned');
    insert.run('legacy-newest', digest(LEGACY_TOKENS[1]), JSON.stringify(definition), 3, 'exited', 'result_reported');
    database.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(7, 'legacy-handled', 'legacy-newest', 3, 'worker', 'needs_decision', 'Synthetic retained question', JSON.stringify({ kind: 'needs_decision', details: 'Synthetic retained payload' }), 123, null, 1, 2, 'Synthetic retained answer');
    database.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(11, 'legacy-pending', 'legacy-oldest', 1, 'worker', 'progress', 'Synthetic retained progress', '{}', 456, null, 0, 1, null);
    database.prepare('INSERT INTO commands VALUES(?,?,?)').run('legacy-command', 'legacy-fingerprint', JSON.stringify({ accepted: true, jobId: 'legacy-newest' }));
  } finally { database.close(); }
}
