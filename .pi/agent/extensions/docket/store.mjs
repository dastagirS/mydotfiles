import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, projectReference, sessionId, ticketId } from './repo.mjs';

const SCHEMA_VERSION = 1;
// Real ticket IDs are positive; zero reserves a creation receipt before its server ID is known.
const CREATION_TICKET_ID = 0;

export class TicketStore {
  constructor(agentDir) {
    const directory = join(agentDir, 'docket');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.database = new DatabaseSync(join(directory, 'coordination.sqlite'));
    try {
      chmodSync(join(directory, 'coordination.sqlite'), 0o600);
      if (this.database.prepare('PRAGMA user_version').get().user_version > SCHEMA_VERSION) throw new Error('Ticket coordination schema is newer than this extension');
      this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=${LIMITS.sqlite_busy_ms}; PRAGMA max_page_count=${LIMITS.sqlite_pages};
      CREATE TABLE IF NOT EXISTS policies(project TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(project TEXT NOT NULL, ticket INTEGER NOT NULL, parent TEXT NOT NULL, generation TEXT NOT NULL, PRIMARY KEY(project,ticket));
      CREATE TABLE IF NOT EXISTS bindings(job TEXT PRIMARY KEY, board TEXT NOT NULL, project TEXT NOT NULL, ticket INTEGER NOT NULL, parent TEXT NOT NULL, generation TEXT NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cursors(project TEXT NOT NULL, parent TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project,parent));
      CREATE TABLE IF NOT EXISTS rates(project TEXT PRIMARY KEY, started INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, project TEXT NOT NULL, ticket INTEGER NOT NULL, parent TEXT NOT NULL, state TEXT NOT NULL, result TEXT);
      CREATE INDEX IF NOT EXISTS pending_operations ON operations(project,ticket,state);
      PRAGMA user_version=${SCHEMA_VERSION};`);
    } catch (error) { this.database.close(); throw error; }
  }
  close() { this.database.close(); }
  transaction(callback) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.database.exec('COMMIT'); return result; }
    catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { throw new Error('Ticket coordination rollback failed; inspect local storage before continuing'); }
      throw error;
    }
  }
  policy(reference) {
    const row = this.database.prepare('SELECT version,data FROM policies WHERE project=?').get(reference.projectUrl);
    return row ? { version: row.version, ...JSON.parse(row.data) } : undefined;
  }
  configure(reference, data) {
    return this.transaction(() => {
      if (this.database.prepare("SELECT 1 FROM bindings WHERE project=? AND state!='closed' LIMIT 1").get(reference.projectUrl)) throw new Error('Cancel or recover existing ticket workers before changing their policy');
      const previous = this.policy(reference);
      if (!previous && this.database.prepare('SELECT count(*) AS count FROM policies').get().count >= LIMITS.claims) throw new Error('Project policy capacity reached');
      this.database.prepare('INSERT INTO policies VALUES(?,?,?) ON CONFLICT(project) DO UPDATE SET version=excluded.version,data=excluded.data')
        .run(reference.projectUrl, (previous?.version ?? 0) + 1, JSON.stringify(data));
      return this.policy(reference);
    });
  }
  owner(reference, id) {
    ticketId(id);
    return this.database.prepare('SELECT parent,generation FROM claims WHERE project=? AND ticket=?').get(reference.projectUrl, id);
  }
  claim(reference, id, parent) {
    ticketId(id); sessionId(parent);
    return this.transaction(() => {
      const previous = this.owner(reference, id);
      if (previous) {
        if (previous.parent !== parent) throw new Error('Ticket already belongs to another parent session; ask that parent for an explicit handoff');
        return previous;
      }
      if (this.database.prepare('SELECT count(*) AS count FROM claims').get().count >= LIMITS.claims) throw new Error('Local ticket claim capacity reached');
      this.database.prepare('INSERT INTO claims VALUES(?,?,?,?)').run(reference.projectUrl, id, parent, randomUUID());
      return this.owner(reference, id);
    });
  }
  owned(reference, id, parent) {
    const owner = this.owner(reference, id);
    if (!owner || owner.parent !== parent) throw new Error('This parent does not own the ticket; start it explicitly or request handoff');
    return owner;
  }
  transfer(reference, id, parent, target) {
    if (target !== undefined) sessionId(target);
    return this.transaction(() => {
      this.owned(reference, id, parent);
      if (this.database.prepare("SELECT 1 FROM bindings WHERE project=? AND ticket=? AND state!='closed' LIMIT 1").get(reference.projectUrl, id)) throw new Error('Ticket still has active or interrupted workers; cancel/recover them before releasing or handing off');
      if (this.pending(reference, id).length) throw new Error('Ticket has pending or uncertain writes; inspect and resolve them before handoff');
      if (target === undefined) this.database.prepare('DELETE FROM claims WHERE project=? AND ticket=?').run(reference.projectUrl, id);
      else this.database.prepare('UPDATE claims SET parent=?,generation=? WHERE project=? AND ticket=?').run(target, randomUUID(), reference.projectUrl, id);
      return this.owner(reference, id) ?? { released: true };
    });
  }
  freeze(reference, id, parent) {
    const owner = this.owned(reference, id, parent);
    const policy = this.policy(reference);
    if (!policy) throw new Error('Configure this project with /tickets:init before delegating a ticket');
    return { projectUrl: reference.projectUrl, ticketId: id, parentId: parent, generation: owner.generation, policyVersion: policy.version };
  }
  bind(binding, board, job) {
    return this.transaction(() => {
      this.current(binding);
      if (this.database.prepare('SELECT count(*) AS count FROM bindings').get().count >= LIMITS.bindings) throw new Error('Local worker binding capacity reached');
      this.database.prepare("INSERT INTO bindings VALUES(?,?,?,?,?,?,'active')").run(sessionId(job), board, binding.projectUrl, binding.ticketId, binding.parentId, binding.generation);
    });
  }
  current(binding, job) {
    const reference = projectReference(binding.projectUrl);
    const owner = this.owned(reference, ticketId(binding.ticketId), sessionId(binding.parentId));
    const policy = this.policy(reference);
    if (owner.generation !== binding.generation || policy?.version !== binding.policyVersion) throw new Error('Ticket ownership or workflow policy changed; this assignment is no longer valid');
    if (job !== undefined) {
      const row = this.database.prepare('SELECT * FROM bindings WHERE job=?').get(sessionId(job));
      if (!row || row.state !== 'active' || row.project !== reference.projectUrl || row.ticket !== binding.ticketId || row.parent !== binding.parentId || row.generation !== binding.generation) throw new Error('Worker ticket assignment is no longer active');
    }
    return { reference, policy };
  }
  closeBinding(job) { this.database.prepare("UPDATE bindings SET state='closed' WHERE job=?").run(sessionId(job)); }
  interruptBoard(board) { this.database.prepare("UPDATE bindings SET state='interrupted' WHERE board=? AND state='active'").run(board); }
  recover(reference, id, parent) {
    return this.transaction(() => {
      this.owned(reference, id, parent);
      if (this.database.prepare("SELECT 1 FROM bindings WHERE project=? AND ticket=? AND state='active' LIMIT 1").get(reference.projectUrl, id)) throw new Error('A coordinator still has active worker bindings; inspect/cancel it first');
      this.database.prepare("UPDATE bindings SET state='closed' WHERE project=? AND ticket=? AND parent=? AND state='interrupted'").run(reference.projectUrl, id, parent);
    });
  }
  cursor(reference, parent) {
    sessionId(parent);
    return this.database.prepare('SELECT acknowledged,delivered FROM cursors WHERE project=? AND parent=?').get(reference.projectUrl, parent) ?? { acknowledged: 0, delivered: 0 };
  }
  deliver(reference, parent, after) {
    return this.transaction(() => {
      const previous = this.cursor(reference, parent);
      if (!Number.isSafeInteger(after) || after < previous.acknowledged) throw new Error('Invalid delivered event cursor');
      if (!this.database.prepare('SELECT 1 FROM cursors WHERE project=? AND parent=?').get(reference.projectUrl, parent) && this.database.prepare('SELECT count(*) AS count FROM cursors').get().count >= LIMITS.receipts) throw new Error('Event consumer capacity reached');
      this.database.prepare('INSERT INTO cursors VALUES(?,?,?,?) ON CONFLICT(project,parent) DO UPDATE SET delivered=excluded.delivered')
        .run(reference.projectUrl, parent, previous.acknowledged, Math.max(previous.delivered, after));
    });
  }
  acknowledge(reference, parent, after) {
    const previous = this.cursor(reference, parent);
    if (!Number.isSafeInteger(after) || after < previous.acknowledged || after > previous.delivered) throw new Error('Acknowledge only events delivered to this parent');
    this.database.prepare('UPDATE cursors SET acknowledged=? WHERE project=? AND parent=?').run(after, reference.projectUrl, parent);
  }
  pending(reference, id) {
    return this.database.prepare(`SELECT id,state FROM operations WHERE project=? AND ticket=? AND state IN ('pending','uncertain') LIMIT ${LIMITS.page}`).all(reference.projectUrl, id);
  }
  replayOperation(id, fingerprint) {
    const previous = this.database.prepare('SELECT * FROM operations WHERE id=?').get(id);
    if (!previous) return undefined;
    if (previous.fingerprint !== fingerprint) throw new Error('Tool call identity was reused for a different ticket write');
    if (previous.state !== 'confirmed') throw new Error(`Previous write was not confirmed; inspect history instead of retrying [operation ${id}]`);
    return { previous: JSON.parse(previous.result) };
  }
  prepareCreation(reference, parent, id, fingerprint) {
    sessionId(parent);
    return this.transaction(() => {
      const previous = this.replayOperation(id, fingerprint);
      if (previous) return previous;
      const pending = this.database.prepare("SELECT id FROM operations WHERE project=? AND parent=? AND ticket=? AND state IN ('pending','uncertain') LIMIT 1").get(reference.projectUrl, parent, CREATION_TICKET_ID);
      if (pending) throw new Error(`An earlier ticket creation is pending or uncertain; inspect project tickets/events and resolve it before another creation [operation ${pending.id}]`);
      if (this.database.prepare('SELECT count(*) AS count FROM operations').get().count >= LIMITS.receipts) throw new Error('Local write receipt capacity reached');
      this.database.prepare("INSERT INTO operations(id,fingerprint,project,ticket,parent,state,result) VALUES(?,?,?,?,?,'pending',NULL)").run(id, fingerprint, reference.projectUrl, CREATION_TICKET_ID, parent);
      return {};
    });
  }
  prepareOperation(binding, job, id, fingerprint) {
    return this.transaction(() => {
      const { reference } = this.current(binding, job);
      const previous = this.replayOperation(id, fingerprint);
      if (previous) return previous;
      if (this.pending(reference, binding.ticketId).length) throw new Error('Another ticket write is pending or uncertain; inspect ownership status before proceeding');
      if (this.database.prepare('SELECT count(*) AS count FROM operations').get().count >= LIMITS.receipts) throw new Error('Local write receipt capacity reached');
      this.database.prepare("INSERT INTO operations VALUES(?,?,?,?,?,'pending',NULL)").run(id, fingerprint, binding.projectUrl, binding.ticketId, binding.parentId);
      return {};
    });
  }
  settleOperation(id, state, result) {
    if (!['confirmed', 'rejected', 'uncertain'].includes(state)) throw new Error('Invalid write outcome');
    this.database.prepare('UPDATE operations SET state=?,result=? WHERE id=?').run(state, result === undefined ? null : JSON.stringify(result), id);
  }
  resolveOperation(reference, parent, id) {
    const row = this.database.prepare("SELECT * FROM operations WHERE id=? AND project=? AND state IN ('pending','uncertain')").get(id, reference.projectUrl);
    if (!row || row.parent !== parent) throw new Error('No unresolved write belongs to this parent and project');
    if (row.ticket !== CREATION_TICKET_ID) this.owned(reference, row.ticket, parent);
    this.database.prepare("UPDATE operations SET state='resolved' WHERE id=?").run(id);
  }
  spend(reference) {
    this.transaction(() => {
      const row = this.database.prepare('SELECT started,count FROM rates WHERE project=?').get(reference.projectUrl);
      const now = Date.now();
      if (row && now - row.started < LIMITS.minute_ms && row.count >= LIMITS.requests_per_minute) throw new Error('Local Docket request rate reached; do not poll in a loop');
      if (!row && this.database.prepare('SELECT count(*) AS count FROM rates').get().count >= LIMITS.claims) throw new Error('Local request accounting capacity reached');
      const fresh = !row || now - row.started >= LIMITS.minute_ms;
      this.database.prepare('INSERT INTO rates VALUES(?,?,?) ON CONFLICT(project) DO UPDATE SET started=excluded.started,count=excluded.count').run(reference.projectUrl, fresh ? now : row.started, fresh ? 1 : row.count + 1);
    });
  }
}
/** @template Value @param {string} agentDir @param {(store: TicketStore) => Value} callback @returns {Value} */
export function withStore(agentDir, callback) {
  const store = new TicketStore(agentDir);
  try { return callback(store); } finally { store.close(); }
}
