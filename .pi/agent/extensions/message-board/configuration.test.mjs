import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('retired custom Codex quota extension cannot load from settings or automatic discovery', () => {
  const settings = JSON.parse(readFileSync(new URL('../../settings.json', import.meta.url), 'utf8'));
  assert.ok(!settings.extensions.some(path => path.includes('codex-usage-status')));
  assert.equal(existsSync(new URL('../codex-usage-status', import.meta.url)), false);
});
