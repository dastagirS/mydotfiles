import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignment } from './protocol.mjs';

const input = { cwd: '/tmp', task: 'Implement the assigned ticket', scope: ['one file'], acceptance: ['Check behavior'] };

test('explicit ticket IDs are preserved, validated, and immutable across instructions', () => {
  const first = assignment({ ...input, ticketId: 7 });
  assert.equal(first.ticketId, 7);
  assert.equal(assignment({ task: 'Continue' }, first).ticketId, 7);
  assert.throws(() => assignment({ task: 'Retarget', ticketId: 8 }, first), /new worker/);
  assert.throws(() => assignment({ task: 'Bind later', ticketId: 7 }, assignment(input)), /new worker/);
  for (const ticketId of [0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assignment({ ...input, ticketId }), /ticket ID/);
  }
});
