import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request, subscribe } from './client.mjs';
import { LIMITS, readJson } from './protocol.mjs';

test('invalid or nonlocal endpoints never receive board capabilities', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('Must not reach fetch'); };
  try {
    for (const url of ['https://example.invalid', 'http://127.0.0.1:80@evil.invalid', 'http://127.0.0.1:123/path', 'http://127.0.0.1:0']) {
      await assert.rejects(request({ url, token: 'x'.repeat(64) }, 'status'), /Invalid local/);
    }
    await assert.rejects(subscribe({ url: 'https://example.invalid', token: 'x'.repeat(64), consumer: 'parent' }, new AbortController().signal, () => {}), /Invalid local/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('private configuration parse errors do not echo sensitive file content and reads are bounded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-board-config-'));
  try {
    const path = join(directory, 'private.json');
    writeFileSync(path, '{"token":"PRIVATE_VALUE_SHOULD_NOT_APPEAR",bad');
    assert.throws(() => readJson(path), error => {
      assert.match(error.message, /Private board JSON/);
      assert.ok(!error.message.includes('PRIVATE_VALUE_SHOULD_NOT_APPEAR'));
      return true;
    });
    writeFileSync(path, 'x'.repeat(LIMITS.body_bytes + 1));
    assert.throws(() => readJson(path), /size limit/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('availability pushes carry validated pending counts without status polling', async () => {
  const original = globalThis.fetch;
  const counts = [];
  const paths = [];
  globalThis.fetch = async url => {
    paths.push(new URL(url).pathname);
    return new Response('{"type":"available","pending":3}\n{"type":"ping"}\n{"type":"available","pending":0}\n');
  };
  try {
    await subscribe({ url: 'http://127.0.0.1:12345', token: 'x'.repeat(64), consumer: 'parent' }, new AbortController().signal, event => counts.push(event.pending));
    assert.deepEqual(counts, [3, 0]);
    assert.deepEqual(paths, ['/events']);
  } finally { globalThis.fetch = original; }
});

test('an older running coordinator can supply the count through an event-driven status read', async () => {
  const original = globalThis.fetch;
  const paths = [];
  const counts = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === '/events') return new Response('{"type":"available"}\n');
    assert.equal(JSON.parse(options.body).action, 'status');
    return new Response('{"pending":2}');
  };
  try {
    await subscribe({ url: 'http://127.0.0.1:12345', token: 'x'.repeat(64), consumer: 'parent' }, new AbortController().signal, event => counts.push(event.pending));
    assert.deepEqual(counts, [2]);
    assert.deepEqual(paths, ['/events', '/command']);
  } finally { globalThis.fetch = original; }
});

test('invalid pending counts do not reach the footer or delivery callback', async () => {
  const original = globalThis.fetch;
  let deliveries = 0;
  try {
    for (const pending of [-1, 1.5, '3', null, LIMITS.events + 1]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ type: 'available', pending }) + '\n');
      await assert.rejects(subscribe({ url: 'http://127.0.0.1:12345', token: 'x'.repeat(64), consumer: 'parent' }, new AbortController().signal, () => { deliveries += 1; }), /Invalid board pending count/);
    }
    assert.equal(deliveries, 0);
  } finally { globalThis.fetch = original; }
});

test('passive agent indicators arrive in the availability push without reading reports or polling status', async () => {
  const original = globalThis.fetch;
  const paths = [];
  const events = [];
  globalThis.fetch = async url => {
    paths.push(new URL(url).pathname);
    return new Response(JSON.stringify({ type: 'available', pending: 1, stalled: false, agents: [{ ordinal: 1, state: 'working' }, { ordinal: 3, state: 'blocked' }] }) + '\n');
  };
  try {
    await subscribe({ url: 'http://127.0.0.1:12345', token: 'x'.repeat(64), consumer: 'parent' }, new AbortController().signal, event => events.push(event));
    assert.deepEqual(events, [{ pending: 1, stalled: false, agents: [{ ordinal: 1, state: 'working' }, { ordinal: 3, state: 'blocked' }] }]);
    assert.deepEqual(paths, ['/events']);
  } finally { globalThis.fetch = original; }
});

test('malformed agent state cannot reach the overlay', async () => {
  const original = globalThis.fetch;
  let deliveries = 0;
  try {
    for (const agents of [null, [{ ordinal: 0, state: 'working' }], [{ ordinal: 1, state: 'unknown' }], [{ ordinal: 1, state: 'ready' }, { ordinal: 1, state: 'ready' }], Array.from({ length: LIMITS.jobs + 1 }, (_, index) => ({ ordinal: index + 1, state: 'working' }))]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ type: 'available', pending: 0, agents }) + '\n');
      await assert.rejects(subscribe({ url: 'http://127.0.0.1:12345', token: 'x'.repeat(64), consumer: 'parent' }, new AbortController().signal, () => { deliveries++; }), /Invalid agent indicator/);
    }
    assert.equal(deliveries, 0);
  } finally { globalThis.fetch = original; }
});
