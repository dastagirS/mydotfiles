import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS } from './protocol.mjs';

const TIMEOUT_MS = 10000;

test('unexpected SDK import failures retain phase/type without exposing raw private paths', { timeout: TIMEOUT_MS }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-worker-diagnostics-'));
  try {
    const configuration = join(directory, 'worker.json');
    await writeFile(configuration, JSON.stringify({ umask: 0o077, packageRoot: join(directory, 'PRIVATE_SDK_PATH_SENTINEL') }), { mode: 0o600 });
    await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url)), configuration], { timeout: TIMEOUT_MS, maxBuffer: LIMITS.stderr_bytes }), error => {
      assert.equal(error.code, 1);
      const response = JSON.parse(error.stdout.trim());
      assert.equal(response.command, 'startup');
      assert.equal(response.success, false);
      assert.equal(response.startupPhase, 'sdk_loading');
      assert.equal(response.errorType, 'Error');
      assert.match(error.stderr, /phase=sdk_loading; type=Error/);
      assert.ok(!error.stderr.includes('PRIVATE_SDK_PATH_SENTINEL'));
      assert.ok(!error.stdout.includes('PRIVATE_SDK_PATH_SENTINEL'));
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
