import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin from './index.js';

async function fixture(storage = new Map()) {
  let tool;
  let hook;
  const context = {
    storage: {
      async get(key) { return structuredClone(storage.get(key)); },
      async set(key, value) { storage.set(key, structuredClone(value)); },
    },
    session: {
      async get({ sessionID }) { if (!['current', 'fresh', 'fork'].includes(sessionID)) throw new Error('Session not found'); },
      async hook(name, callback) { assert.equal(name, 'context'); hook = callback; },
    },
    tool: { async transform(callback) { callback({ add(value) { tool = value; } }); } },
  };
  await plugin.setup(context);
  return { context, storage,
    call: async (input, sessionID = 'current', signal) => JSON.parse((await tool.execute(input, { sessionID, signal })).content),
    async prompt(sessionID = 'current', system = [{ type: 'text', text: 'Shared instructions.' }]) {
      const request = { sessionID, system, tools: { existing: {} }, messages: [{ type: 'user', text: 'Preserve history' }] };
      await hook(request);
      assert.deepEqual(request.tools, { existing: {} });
      assert.deepEqual(request.messages, [{ type: 'user', text: 'Preserve history' }]);
      assert.equal(request.system[0].text, 'Shared instructions.');
      return request.system;
    },
  };
}

test('multiline Unicode character boundaries, duplicates, stable IDs and removal', async () => {
  const current = await fixture();
  for (const text of ['', ' \n ', 'x'.repeat(161), '😀'.repeat(161)]) await assert.rejects(current.call({ action: 'add', text }));
  const text = '😀'.repeat(158) + '\nA';
  const rule = (await current.call({ action: 'add', text })).added;
  await assert.rejects(current.call({ action: 'add', text }), /duplicate/);
  assert.deepEqual((await current.call({ action: 'list' })).rules, [rule]);
  const system = await current.prompt();
  assert.ok(system.at(-1).text.includes(JSON.stringify(text)));
  assert.equal((await current.prompt('current', system)).length, 2);
  await current.call({ action: 'remove', id: rule.id });
  assert.match((await current.prompt()).at(-1).text, /\(none\)/);
  await assert.rejects(current.call({ action: 'remove', id: rule.id }), /not found/);
});

test('pagination has no total cap; saved snapshots survive a new plugin instance but not a different session', async () => {
  const current = await fixture();
  for (let index = 0; index < 105; index += 1) await current.call({ action: 'add', text: `Rule ${index}` });
  const resumed = await fixture(current.storage);
  const first = await resumed.call({ action: 'list', limit: 100 });
  const last = await resumed.call({ action: 'list', offset: first.nextOffset });
  assert.equal(first.total, 105);
  assert.equal(first.rules.length, 100);
  assert.equal(last.rules.length, 5);
  assert.equal(last.nextOffset, null);
  assert.equal(new Set([...first.rules, ...last.rules].map(rule => rule.id)).size, 105);
  for (const session of ['fresh', 'fork']) assert.equal((await resumed.call({ action: 'list' }, session)).total, 0);
  assert.equal((await resumed.call({ action: 'list', offset: Number.MAX_SAFE_INTEGER })).nextOffset, null);
  for (const input of [{ action: 'list', limit: 101 }, { action: 'list', offset: -1 }, { action: 'list', offset: 0.5 },
    { action: 'list', offset: Number.MAX_SAFE_INTEGER + 1 }, { action: 'list', id: 'wrong' },
    { action: 'add', text: 'Fine', limit: 2 }, { action: 'add', text: 'Fine', id: 'wrong' },
    { action: 'remove', id: first.rules[0].id, text: 'wrong' }, { action: 'unknown' }, { action: 'list', extra: true }, null]) {
    await assert.rejects(resumed.call(input));
  }
  await assert.rejects(resumed.call({ action: 'list' }, 'missing'), /not found/);
});

test('failed writes and cancellation preserve old snapshot, reject overlap without losing accepted updates, release guard after failures', async () => {
  const current = await fixture();
  const original = current.context.storage.set;
  current.context.storage.set = async () => { throw new Error('Write failed'); };
  await assert.rejects(current.call({ action: 'add', text: 'Must not persist' }), /Write failed/);
  assert.equal((await current.call({ action: 'list' })).total, 0);
  current.context.storage.set = original;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(current.call({ action: 'add', text: 'Cancelled' }, 'current', controller.signal), /cancelled/);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let began;
  const started = new Promise(resolve => { began = resolve; });
  current.context.storage.set = async (...arguments_) => { began(); await held; await original(...arguments_); };
  const accepted = current.call({ action: 'add', text: 'Accepted' });
  await started;
  try { await assert.rejects(current.call({ action: 'add', text: 'Overlap' }), /in progress/); }
  finally { release(); }
  await accepted;
  assert.deepEqual((await current.call({ action: 'list' })).rules.map(rule => rule.text), ['Accepted']);
  current.context.storage.set = original;
  await current.call({ action: 'add', text: 'Next' });
  assert.equal((await current.call({ action: 'list' })).total, 2);
});

test('corrupt saved state is reported instead of silently dropping rules', async () => {
  const current = await fixture(new Map([['session:current', { version: 1, rules: [{ id: 'bad', text: 'x'.repeat(161) }] }]]));
  await assert.rejects(current.call({ action: 'list' }), /160/);
  await assert.rejects(current.prompt(), /160/);
});
