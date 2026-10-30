import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { attach, validatePolicy } from './repo.mjs';
import { withStore } from './store.mjs';

export const executable = process.env.DOCKET_TEST_BINARY ?? join(homedir(), 'dojo/personal/docket/bin/docket');
export async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'pi-docket-test-'));
  const agentDir = join(root, 'agent');
  const cwd = join(root, 'repo');
  await mkdir(cwd); await mkdir(agentDir);
  const child = spawn(executable, ['--database', join(root, 'test.sqlite'), '--listen', '127.0.0.1:0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let output = ''; let failure;
  child.on('error', error => { failure = error; });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-65536); });
  let origin;
  let completed = false;
  try {
    for (let index = 0; index < 100; index++) {
      if (failure) throw failure;
      origin = output.match(/url=(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (origin) break;
      if (child.exitCode !== null) throw new Error('Disposable Docket failed to start');
      await delay(50);
    }
    assert.ok(origin, 'Disposable Docket startup timed out');
    const remote = async (path, body, method = body ? 'POST' : 'GET', version) => {
      const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...(version ? { 'If-Match': `"${version}"` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
      const value = await response.json();
      assert.ok(response.ok, `Fixture API status ${response.status}`);
      return value;
    };
    const project = await remote('/api/projects', { name: 'Scoped project', key: 'SCOPED' });
    const reference = attach(cwd, `${origin}/projects/${project.id}`);
    withStore(agentDir, store => store.configure(reference, validatePolicy(project, { progressStatuses: ['In Progress', 'Blocked', 'In Review'], completionStatus: 'Done' })));
    const ticket = await remote(`/api/projects/${project.id}/tickets`, { title: 'Assigned work', description: 'Full requirements '.repeat(150) });
    await run({ root, cwd, agentDir, origin, reference, project, ticket, remote });
    completed = true;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
      child.kill('SIGTERM');
      try { await ended; } catch (error) { child.kill('SIGKILL'); throw error; }
    }
    if (completed) await rm(root, { recursive: true, force: true });
    else console.error('Failed disposable Docket fixture retained at', root);
  }
}

