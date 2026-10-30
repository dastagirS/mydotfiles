import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import { fixture } from './fixture.mjs';
import { executeTicket, freezeTicket } from './core.mjs';
import { withStore } from './store.mjs';
import { projectReference, LIMITS } from './repo.mjs';

const REQUEST_BYTES_MAX = 64 * 1024;
const PROXY_CONNECTIONS_MAX = 4;

test('parent creates a pinned-project ticket without claiming or launching it; confirmed replays dedupe', { timeout: 20000 }, async () => fixture(async ({ cwd, agentDir, reference, project, remote }) => {
  const parent = { cwd, agentDir, parentId: 'parent-creation' };
  const parameters = { title: 'Requested feature', description: 'Complete requested scope '.repeat(120), status: 'Blocked' };
  const created = await executeTicket(parent, 'create', parameters, 'create-one');
  assert.equal(created.project_id, reference.projectId);
  assert.equal(created.title, parameters.title);
  assert.equal(created.description, parameters.description);
  assert.equal(created.status, parameters.status);
  assert.equal(created.version, 1);
  withStore(agentDir, store => {
    assert.equal(store.owner(reference, created.id), undefined);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM claims').get().count, 0);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM bindings').get().count, 0);
  });
  assert.equal(existsSync(join(agentDir, 'boards')), false);
  const duplicate = await executeTicket(parent, 'create', parameters, 'create-one');
  assert.equal(duplicate.id, created.id);
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(executeTicket(parent, 'create', { ...parameters, title: 'Changed replay' }, 'create-one'), /different ticket write/);
  assert.equal((await remote(`/api/projects/${project.id}/tickets`)).items.length, 2);
  const defaults = await executeTicket(parent, 'create', { title: 'Title only' }, 'create-two');
  assert.equal(defaults.description, '');
  assert.equal(defaults.status, project.statuses[0]);
  assert.equal(withStore(agentDir, store => store.owner(reference, defaults.id)), undefined);
}));

test('creation validates input, refuses project/ticket overrides and workers, and scopes call replay to the board', { timeout: 20000 }, async () => fixture(async ({ root, cwd, agentDir, reference, project, ticket, remote }) => {
  const parent = { cwd, agentDir, parentId: 'parent-create-guards' };
  for (const [index, parameters] of [
    {}, { title: ' ' }, { title: 'é'.repeat(101) }, { title: 'Null\0title' },
    { title: 'Valid', description: 'x'.repeat(LIMITS.text_bytes + 1) },
    { title: 'Valid', projectUrl: 'http://wrong.invalid/projects/1' },
    { title: 'Valid', ticketId: ticket.id }, { title: 'Valid', version: 1 },
  ].entries()) await assert.rejects(executeTicket(parent, 'create', parameters, `invalid-${index}`));
  await assert.rejects(executeTicket(parent, 'create', { title: 'Invalid status', status: 'NOT_A_WORKFLOW_STATUS' }, 'invalid-status'), /rejected the input/);
  assert.equal((await remote(`/api/projects/${project.id}/tickets`)).items.length, 1);
  await executeTicket(parent, 'start', { ticketId: ticket.id }, 'claim-for-worker');
  const binding = freezeTicket(agentDir, cwd, cwd, parent.parentId, ticket.id);
  withStore(agentDir, store => store.bind(binding, join(root, 'board'), 'worker-create-guard'));
  const worker = { cwd, agentDir, worker: { ticketBinding: binding, jobId: 'worker-create-guard' } };
  await assert.rejects(executeTicket(worker, 'create', { title: 'Not permitted' }, 'worker-create'), /not allowed/);
  assert.equal((await remote(`/api/projects/${project.id}/tickets`)).items.length, 1);
  const created = await executeTicket(parent, 'create', { title: 'Valid creation' }, 'cross-board-call');
  assert.equal(withStore(agentDir, store => store.owner(reference, created.id)), undefined);
  const other = await remote('/api/projects', { name: 'Other board', key: 'OTHER' });
  await writeFile(reference.marker, JSON.stringify({ version: 1, projectUrl: `${reference.origin}/projects/${other.id}` }));
  await assert.rejects(executeTicket(parent, 'create', { title: 'Valid creation' }, 'cross-board-call'), /different ticket write/);
  assert.equal((await remote(`/api/projects/${other.id}/tickets`)).items.length, 0);
}));

async function creationProxy(configuration, mode, run) {
  const { origin, project, reference } = configuration;
  let posts = 0;
  const proxy = http.createServer(async (incoming, outgoing) => {
    try {
      const parts = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > REQUEST_BYTES_MAX) throw new Error('Proxy fixture request limit'); parts.push(chunk); }
      const response = await fetch(origin + incoming.url, { method: incoming.method,
        headers: { ...incoming.headers, host: new URL(origin).host },
        ...(incoming.method === 'GET' ? {} : { body: Buffer.concat(parts) }), signal: AbortSignal.timeout(LIMITS.request_ms) });
      const value = await response.json();
      if (incoming.method === 'POST') {
        posts++;
        if (posts === 1 && mode === 'drop') { outgoing.destroy(); return; }
        if (posts === 1 && mode === 'wrong-project') value.project_id = project.id + 1;
      }
      outgoing.writeHead(response.status, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify(value));
    } catch { outgoing.destroy(); }
  });
  proxy.requestTimeout = LIMITS.request_ms;
  proxy.headersTimeout = LIMITS.request_ms;
  proxy.maxConnections = PROXY_CONNECTIONS_MAX;
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const linked = projectReference(`http://127.0.0.1:${proxy.address().port}/projects/${project.id}`);
    await writeFile(reference.marker, JSON.stringify({ version: 1, projectUrl: linked.projectUrl }));
    await run(linked, () => posts);
  } finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
}

for (const mode of ['drop', 'wrong-project']) test(`uncertain creation (${mode}) is committed once, blocks replay/new creation, and requires explicit parent resolution`, { timeout: 20000 }, async () => fixture(async configuration => creationProxy(configuration, mode, async (reference, posts) => {
  const { cwd, agentDir, project, remote } = configuration;
  const parent = { cwd, agentDir, parentId: 'parent-create-uncertain' };
  let operation;
  await assert.rejects(executeTicket(parent, 'create', { title: 'Committed creation' }, 'uncertain-create'), error => {
    operation = error.message.match(/operation ([a-f0-9]{64})/)?.[1];
    assert.ok(operation);
    return true;
  });
  assert.equal(posts(), 1);
  const created = (await remote(`/api/projects/${project.id}/tickets`)).items.filter(ticket => ticket.title === 'Committed creation');
  assert.equal(created.length, 1);
  assert.equal(withStore(agentDir, store => store.owner(reference, created[0].id)), undefined);
  await assert.rejects(executeTicket(parent, 'create', { title: 'Committed creation' }, 'uncertain-create'), /not confirmed/);
  await assert.rejects(executeTicket(parent, 'create', { title: 'Another creation' }, 'different-call'), /earlier ticket creation is pending or uncertain/);
  assert.equal(posts(), 1, 'Neither a replay nor a fresh call may blindly resend an uncertain creation');
  withStore(agentDir, store => {
    assert.throws(() => store.resolveOperation(reference, 'other-parent', operation), /belongs to this parent/);
    store.resolveOperation(reference, parent.parentId, operation);
  });
  await assert.rejects(executeTicket(parent, 'create', { title: 'Committed creation' }, 'uncertain-create'), /not confirmed/);
  const later = await executeTicket(parent, 'create', { title: 'Later explicitly requested ticket' }, 'later-create');
  assert.equal(later.project_id, project.id);
  assert.equal(posts(), 2);
  assert.equal(withStore(agentDir, store => store.owner(reference, later.id)), undefined);
})));
