import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { attach, discover, projectReference, validatePolicy } from './repo.mjs';
import { withStore } from './store.mjs';
import { executeTicket, freezeTicket } from './core.mjs';

import { fixture } from './fixture.mjs';

test('repo attachment is idempotent, inherited, and fail-closed on conflicting/malformed references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-docket-repo-'));
  try {
    await mkdir(join(root, 'nested'));
    const first = attach(root, 'http://example.test/projects/7');
    assert.equal(attach(join(root, 'nested'), first.projectUrl).marker, first.marker);
    assert.equal(discover(join(root, 'nested')).projectId, 7);
    assert.throws(() => attach(root, 'http://example.test/projects/8'), /different/);
    for (const value of ['http://user:private@example.test/projects/1', 'http://example.test/projects/1?q=2', 'http://example.test/api/projects/1', 'file:///projects/1']) assert.throws(() => projectReference(value));
    await mkdir(join(root, 'nested/.pi'));
    await writeFile(join(root, 'nested/.pi/tickets.json'), '{broken');
    assert.throws(() => discover(join(root, 'nested')), /invalid JSON/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real API parent/worker scoping, immutable delegation binding, and local ownership', { timeout: 20000 }, async () => fixture(async ({ cwd, root, agentDir, reference, ticket, remote }) => {
  const parent = { cwd, agentDir, parentId: 'parent-one' };
  const run = (action, parameters = {}, id = action) => executeTicket(parent, action, parameters, id);
  const listed = await run('list');
  assert.equal(listed.items[0].id, ticket.id);
  assert.ok(listed.items[0].description.length < ticket.description.length);
  const otherProject = await remote('/api/projects', { name: 'Other scope', key: 'OTHER' });
  const otherTicket = await remote(`/api/projects/${otherProject.id}/tickets`, { title: 'Foreign ticket' });
  await assert.rejects(run('start', { ticketId: otherTicket.id }), /not found/);
  assert.equal(withStore(agentDir, store => store.owner(reference, otherTicket.id)), undefined);
  const foreign = join(root, 'foreign');
  await mkdir(foreign);
  attach(foreign, `${reference.origin}/projects/${otherProject.id}`);
  assert.throws(() => freezeTicket(agentDir, cwd, foreign, parent.parentId, ticket.id), /different Docket board/);
  const started = await run('start', { ticketId: ticket.id });
  assert.equal(started.ticket.description, ticket.description, 'Assigned requirements must not be silently truncated');
  await assert.rejects(executeTicket({ ...parent, parentId: 'other-parent' }, 'start', { ticketId: ticket.id }, 'other'), /another parent/);
  const binding = freezeTicket(agentDir, cwd, cwd, parent.parentId, ticket.id);
  withStore(agentDir, store => store.bind(binding, join(root, 'board'), 'worker-one'));
  const worker = { cwd, agentDir, worker: { ticketBinding: binding, jobId: 'worker-one' } };
  assert.equal((await executeTicket(worker, 'get', {}, 'read')).id, ticket.id);
  await assert.rejects(executeTicket(worker, 'get', { ticketId: ticket.id + 1 }, 'wrong'), /fixed/);
  await assert.rejects(executeTicket(worker, 'update', { title: 'Scope edit' }, 'wrong-action'), /not allowed/);
  await assert.rejects(executeTicket(worker, 'progress', { status: 'Done', version: 1 }, 'done'), /completion belongs/);
  await assert.rejects(run('release', { ticketId: ticket.id }), /active/);
  const moved = await executeTicket(worker, 'progress', { status: 'In Progress', version: 1 }, 'progress');
  assert.equal(moved.version, 2);
  const comment = await executeTicket(worker, 'comment', { body: 'Worker update', version: 2 }, 'comment');
  assert.equal(comment.ticket_version, 3);
  const duplicate = await executeTicket(worker, 'comment', { body: 'Worker update', version: 2 }, 'comment');
  assert.equal(duplicate.comment.id, comment.comment.id);
  await assert.rejects(executeTicket(worker, 'comment', { body: 'Different body', version: 3 }, 'comment'), /different ticket write/);
  assert.equal((await remote(`/api/projects/${reference.projectId}/tickets/${ticket.id}/comments`)).items.length, 1);
  withStore(agentDir, store => store.closeBinding('worker-one'));
  await assert.rejects(executeTicket(worker, 'get', {}, 'expired'), /no longer active/);
  await run('handoff', { ticketId: ticket.id, targetSessionId: 'other-parent' });
  await assert.rejects(run('update', { ticketId: ticket.id, status: 'Done', version: 3 }), /does not own/);
  const finished = await executeTicket({ ...parent, parentId: 'other-parent' }, 'update', { ticketId: ticket.id, status: 'Done', version: 3 }, 'finish');
  assert.equal(finished.status, 'Done');
}));

test('events replay until acknowledged, persist per parent, and cannot acknowledge undelivered data', { timeout: 20000 }, async () => fixture(async ({ cwd, agentDir, reference }) => {
  const parent = { cwd, agentDir, parentId: 'parent-events' };
  const first = await executeTicket(parent, 'events', {}, 'events');
  assert.ok(first.items.length > 0);
  const repeated = await executeTicket(parent, 'events', {}, 'again');
  assert.deepEqual(repeated, first);
  await assert.rejects(executeTicket(parent, 'ack_events', { after: first.next_cursor + 1 }, 'bad-ack'), /only events delivered/);
  await executeTicket(parent, 'ack_events', { after: first.next_cursor }, 'ack');
  assert.equal(withStore(agentDir, store => store.cursor(reference, parent.parentId)).acknowledged, first.next_cursor);
  assert.equal((await executeTicket(parent, 'events', {}, 'after')).items.length, 0);
}));

test('independent local processes cannot both claim the same ticket', { timeout: 20000 }, async () => fixture(async ({ agentDir, reference, ticket }) => {
  const source = `import {withStore} from ${JSON.stringify(new URL('./store.mjs', import.meta.url).href)}; const [directory,reference,parent]=process.argv.slice(1); try { withStore(directory,store=>store.claim(JSON.parse(reference),${ticket.id},parent)); console.log('claimed'); } catch(error) { if (!error.message.includes('another parent')) throw error; console.log('rejected'); }`;
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, agentDir, JSON.stringify(reference), `parent-${index}`], { timeout: 10000, maxBuffer: 65536 })));
  assert.equal(results.filter(result => result.stdout.trim() === 'claimed').length, 1);
  assert.equal(results.filter(result => result.stdout.trim() === 'rejected').length, 3);
}));

test('lost HTTP write response is not retried and blocks writes/handoff until explicit resolution', { timeout: 20000 }, async () => fixture(async ({ cwd, agentDir, origin, reference, project, ticket, remote }) => {
  let drop = true;
  const proxy = http.createServer(async (incoming, outgoing) => {
    try {
      const parts = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > 65536) throw new Error('Proxy fixture body limit'); parts.push(chunk); }
      const headers = { ...incoming.headers, host: new URL(origin).host };
      const response = await fetch(origin + incoming.url, { method: incoming.method, headers, ...(incoming.method === 'GET' ? {} : { body: Buffer.concat(parts) }), signal: AbortSignal.timeout(5000) });
      const body = await response.arrayBuffer();
      if (drop && incoming.method === 'POST') { drop = false; outgoing.destroy(); return; }
      outgoing.writeHead(response.status, { 'content-type': 'application/json' }); outgoing.end(Buffer.from(body));
    } catch { outgoing.destroy(); }
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const linked = projectReference(`http://127.0.0.1:${proxy.address().port}/projects/${project.id}`);
    await writeFile(reference.marker, JSON.stringify({ version: 1, projectUrl: linked.projectUrl }));
    withStore(agentDir, store => { store.configure(linked, { progressStatuses: ['In Progress'], completionStatus: 'Done' }); store.claim(linked, ticket.id, 'parent-loss'); });
    const parent = { cwd, agentDir, parentId: 'parent-loss' };
    await assert.rejects(executeTicket(parent, 'comment', { ticketId: ticket.id, body: 'Committed once', version: 1 }, 'lost'), /uncertain/);
    const pending = (await executeTicket(parent, 'ownership', { ticketId: ticket.id }, 'inspect')).pendingWrites;
    assert.equal(pending.length, 1);
    await assert.rejects(executeTicket(parent, 'comment', { ticketId: ticket.id, body: 'Committed once', version: 1 }, 'lost'), /not confirmed/);
    await assert.rejects(executeTicket(parent, 'release', { ticketId: ticket.id }, 'release'), /uncertain/);
    assert.equal((await remote(`/api/projects/${project.id}/tickets/${ticket.id}/comments`)).items.length, 1);
    withStore(agentDir, store => store.resolveOperation(linked, parent.parentId, pending[0].id));
    await executeTicket(parent, 'comment', { ticketId: ticket.id, body: 'Later distinct update', version: 2 }, 'later');
  } finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
}));

test('ordinary Git worktrees discover the primary repo marker without creating another board', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-docket-worktree-'));
  const primary = join(root, 'primary');
  const worktree = join(root, 'worktree');
  const git = async (arguments_) => promisify(execFile)('git', arguments_, { timeout: 5000, maxBuffer: 65536 });
  try {
    await git(['init', '--template=', '--initial-branch=master', primary]);
    await git(['-C', primary, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Fixture']);
    await git(['-C', primary, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '-b', 'fixture-work', worktree]);
    const reference = attach(primary, 'http://example.test/projects/9');
    assert.equal(discover(worktree).projectUrl, reference.projectUrl);
    assert.equal(attach(worktree, reference.projectUrl).marker, reference.marker);
    assert.throws(() => attach(worktree, 'http://example.test/projects/10'), /different/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('interrupted workers block handoff until explicit recovery; schema and policy limits fail closed', { timeout: 20000 }, async () => fixture(async ({ root, cwd, agentDir, reference, ticket }) => {
  withStore(agentDir, store => store.claim(reference, ticket.id, 'parent-recovery'));
  const binding = freezeTicket(agentDir, cwd, cwd, 'parent-recovery', ticket.id);
  withStore(agentDir, store => store.bind(binding, join(root, 'board'), 'worker-recovery'));
  withStore(agentDir, store => {
    assert.throws(() => store.configure(reference, { progressStatuses: [], completionStatus: 'Done' }), /Cancel or recover/);
    assert.throws(() => store.recover(reference, ticket.id, 'parent-recovery'), /active worker/);
    store.interruptBoard(join(root, 'board'));
    assert.throws(() => store.current(binding, 'worker-recovery'), /no longer active/);
    assert.throws(() => store.transfer(reference, ticket.id, 'parent-recovery', 'other-parent'), /interrupted/);
    store.recover(reference, ticket.id, 'parent-recovery');
    store.transfer(reference, ticket.id, 'parent-recovery', 'other-parent');
    assert.equal(store.owner(reference, ticket.id).parent, 'other-parent');
  });
  assert.throws(() => validatePolicy({ statuses: ['Done'] }, { progressStatuses: ['Done'], completionStatus: 'Done' }), /excluding completion/);
  withStore(agentDir, store => store.database.exec('PRAGMA user_version=2'));
  assert.throws(() => withStore(agentDir, () => {}), /schema is newer/);
}));
