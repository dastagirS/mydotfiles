import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardStore } from './store.mjs';
import { LIMITS, assignment, report, workerInstructions } from './protocol.mjs';

const definition = { cwd: tmpdir(), task: 'Implement assigned module', scope: ['module.js'], acceptance: ['Run the module tests'] };

function fixture(run, limits = LIMITS) {
  const path = mkdtempSync(join(tmpdir(), 'pi-board-store-'));
  const store = new BoardStore(path, limits);
  try { return run(store, path); }
  finally { store.close(); rmSync(path, { recursive: true, force: true }); }
}

test('FIFO claims are durable, single-consumer, and only advance after explicit handling', () => fixture(store => {
  const job = store.createJob(definition, 'private-worker-capability');
  const first = store.post(job.id, 1, { kind: 'progress', summary: 'First' });
  const second = store.post(job.id, 1, { kind: 'needs_decision', summary: 'Second' });
  const batch = store.claim('parent-runtime-one');
  assert.deepEqual(batch.map(row => row.id), [first.id, second.id]);
  assert.equal(store.pending(), 2);
  assert.deepEqual(store.claim('parent-runtime-two'), []);
  assert.throws(() => store.acknowledge('parent-runtime-two', [first.id]), /another consumer/);
  store.acknowledge('parent-runtime-one', [first.id, second.id]);
  assert.equal(store.pending(), 0);
  assert.equal(store.status().unresolved.length, 1, 'Handled questions remain open until answered');
  store.answer(second.id, 'Use the approved interface');
  assert.equal(store.status().unresolved.length, 0);
}));

test('disconnect releases rather than deletes a batch; duplicate posts have one identity', () => fixture(store => {
  const job = store.createJob(definition, 'worker-token');
  const input = { kind: 'progress', summary: 'A milestone' };
  const event = store.post(job.id, 1, input, 'worker', 'event-one');
  assert.equal(store.post(job.id, 1, input, 'worker', 'event-one').duplicate, true);
  assert.equal(store.pending(), 1);
  assert.throws(() => store.post(job.id, 1, { ...input, summary: 'Different' }, 'worker', 'event-one'), /different report/);
  store.claim('first');
  store.release('first');
  assert.equal(store.claim('second')[0].id, event.id);
  assert.equal(store.pending(), 1);
}));

test('database reopening preserves unhandled reports and resets abandoned leases', () => {
  const path = mkdtempSync(join(tmpdir(), 'pi-board-recovery-'));
  let store = new BoardStore(path);
  try {
    const job = store.createJob(definition, 'worker-token');
    const event = store.post(job.id, 1, { kind: 'result', summary: 'Ready for verification' });
    store.claim('old-parent');
    store.close();
    store = new BoardStore(path);
    assert.equal(store.pending(), 1);
    store.recover();
    assert.equal(store.claim('new-parent')[0].id, event.id);
    assert.equal(store.job(job.id).stage, 'result_reported');
    assert.notEqual(store.job(job.id).stage, 'verified');
  } finally { store.close(); rmSync(path, { recursive: true, force: true }); }
});

test('delivery attempts are bounded without silently discarding reports', () => fixture(store => {
  const job = store.createJob(definition, 'worker-token');
  const event = store.post(job.id, 1, { kind: 'progress', summary: 'Still pending' });
  for (let index = 0; index < LIMITS.attempts; index += 1) {
    assert.equal(store.claim('parent')[0].id, event.id);
    store.release('parent');
  }
  assert.deepEqual(store.claim('parent'), []);
  assert.equal(store.status().stalled, true);
  assert.equal(store.pending(), 1);
  store.retry();
  assert.equal(store.claim('parent')[0].id, event.id);
}));

test('stale assignments, unknown capabilities, and overflow do not create new events', () => fixture(store => {
  const job = store.createJob(definition, 'worker-token');
  assert.equal(store.authenticate('worker-token'), job.id);
  assert.equal(store.authenticate('unrelated-token'), undefined);
  store.updateJob(job.id, { revision: 2 });
  assert.throws(() => store.post(job.id, 1, { kind: 'progress', summary: 'Old task' }), /stale/);
  store.post(job.id, 2, { kind: 'progress', summary: 'Current task' });
  assert.throws(() => store.post(job.id, 2, { kind: 'result', summary: 'Overflow' }), /capacity/);
  assert.equal(store.pending(), 1);
}, { ...LIMITS, events: 1 }));

test('questions from superseded assignments remain in history but not the current decision list', () => fixture(store => {
  const job = store.createJob(definition, 'worker-token');
  const question = store.post(job.id, 1, { kind: 'needs_decision', summary: 'Old assignment question' });
  store.updateJob(job.id, { revision: 2 });
  assert.equal(store.status().unresolved.length, 0);
  assert.equal(store.event(question.id).summary, 'Old assignment question');
}));

test('command identities reconcile duplicate launches and reject changed requests', () => fixture(store => {
  const result = { accepted: true, jobId: 'worker-one' };
  store.remember('command-one', 'fingerprint', result);
  assert.deepEqual(store.remembered('command-one', 'fingerprint'), result);
  assert.throws(() => store.remembered('command-one', 'different'), /different action/);
  store.failCommand('command-one');
  assert.throws(() => store.remembered('command-one', 'fingerprint'), /did not complete/);
}));

test('status remains transportable at the supported job and decision limits', () => fixture(store => {
  let first;
  for (let index = 0; index < LIMITS.jobs; index += 1) {
    const job = store.createJob({ ...definition, task: 'x'.repeat(LIMITS.task - 10) + index,
      scope: Array(16).fill('s'.repeat(1000)), acceptance: Array(16).fill('a'.repeat(1000)) }, 'token-' + index);
    if (!first) first = job;
    if (index >= LIMITS.workers) store.updateJob(job.id, { state: 'cancelled' });
  }
  for (let index = 0; index < LIMITS.decisions; index += 1) store.post(first.id, 1, { kind: 'needs_decision', summary: '\u0001'.repeat(LIMITS.summary) });
  const status = store.status();
  assert.equal(status.jobs.length, LIMITS.jobs);
  assert.equal(status.unresolved.length, LIMITS.decisions);
  assert.ok(Buffer.byteLength(JSON.stringify(status)) < LIMITS.response_bytes, 'Status must fit the client response limit without losing durable history');
  assert.equal(store.job(first.id).definition.scope.length, 16);
}));

test('replaying answered reports fits a bounded batch without discarding full answers', () => fixture(store => {
  const job = store.createJob(definition, 'worker-token');
  const answer = '\u0001'.repeat(LIMITS.task);
  let first;
  for (let index = 0; index < LIMITS.batch; index += 1) {
    const event = store.post(job.id, 1, { kind: 'needs_decision', summary: '\u0001'.repeat(LIMITS.summary), details: 'd'.repeat(LIMITS.details) });
    store.answer(event.id, answer);
    if (!first) first = event;
  }
  const batch = store.claim('parent');
  assert.ok(Buffer.byteLength(JSON.stringify({ events: batch })) < LIMITS.response_bytes);
  assert.equal(batch[0].answerTruncated, true);
  assert.equal(store.event(first.id).answer, answer);
}));

test('contracts require explicit scope and acceptance; worker prompt is an append-only role contract', () => {
  assert.deepEqual(assignment(definition), definition);
  assert.throws(() => assignment({ ...definition, scope: [] }), /scope/);
  assert.throws(() => assignment({ ...definition, thinking: 'unbounded' }), /thinking/);
  assert.throws(() => assignment({ ...definition, cwd: '/elsewhere' }, definition), /new worker/);
  assert.throws(() => assignment({ ...definition, model: 'different' }, { ...definition, model: 'original' }), /new worker/);
  assert.throws(() => report({ kind: 'peer', summary: 'Contact sibling' }), /kind/);
  assert.throws(() => report({ kind: 'progress', summary: 'x'.repeat(LIMITS.summary + 1) }), /summary/);
  const prompt = workerInstructions({ parentId: 'parent', jobId: 'worker', cwd: '/project' });
  assert.match(prompt, /controlled by parent/);
  assert.match(prompt, /normal Pi instructions/);
  assert.match(prompt, /Do not spawn or delegate/);
  assert.match(prompt, /Do not create message ping-pong/);
});

test('agent indicators preserve ordinal identity, follow real lifecycle/report state, and never consume reports', () => fixture(store => {
  const first = store.createJob(definition, 'first-indicator');
  const next = store.createJob({ ...definition, task: 'Second indicator job' }, 'second-indicator');
  assert.deepEqual(store.availability().agents, [{ ordinal: 1, state: 'working' }, { ordinal: 2, state: 'working' }]);
  store.updateJob(first.id, { state: 'idle' });
  assert.deepEqual(store.availability().agents, [{ ordinal: 2, state: 'working' }]);
  const question = store.post(next.id, 1, { kind: 'needs_decision', summary: 'Choose the approved option' });
  const before = store.event(question.id);
  assert.deepEqual(store.availability().agents, [{ ordinal: 2, state: 'blocked' }]);
  assert.deepEqual(store.event(question.id), before, 'Passive indicator reads cannot lease, acknowledge or answer reports');
  const batch = store.claim('indicator-consumer');
  store.acknowledge('indicator-consumer', batch.map(event => event.id));
  assert.deepEqual(store.availability().agents, [{ ordinal: 2, state: 'blocked' }], 'Deferred unanswered decisions remain visible after acknowledgement');
  store.answer(question.id, 'Approved');
  store.updateJob(next.id, { stage: 'assigned', state: 'working' });
  store.post(next.id, 1, { kind: 'result', summary: 'Ready for verification' });
  store.updateJob(next.id, { state: 'idle' });
  assert.deepEqual(store.availability().agents, [{ ordinal: 2, state: 'ready' }]);
  store.acknowledge('indicator-consumer', store.claim('indicator-consumer').map(event => event.id));
  assert.deepEqual(store.availability().agents, [], 'Handled idle results clear the panel without treating idle as success');
  store.updateJob(first.id, { state: 'error', stage: 'startup_failed' });
  assert.deepEqual(store.availability().agents, [{ ordinal: 1, state: 'error' }]);
}));
