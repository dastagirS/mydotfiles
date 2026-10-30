import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, availability, identifier, readJson, writePrivate } from './protocol.mjs';

function validateConnection(connection) {
  if (!connection || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(connection.url) ||
      Number(new URL(connection.url).port) < 1 || Number(new URL(connection.url).port) > 65535 ||
      typeof connection.token !== 'string' || connection.token.length < 32 || connection.token.length > 256) {
    throw new Error('Invalid local board connection');
  }
}

export async function request(connection, action, payload = {}, options = {}) {
  validateConnection(connection);
  const response = await fetch(connection.url + '/command', {
    method: 'POST', redirect: 'error',
    headers: { authorization: 'Bearer ' + connection.token, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(LIMITS.request_ms)]) : AbortSignal.timeout(LIMITS.request_ms),
  });
  if (!response.body) throw new Error('Board returned no response');
  const reader = response.body.getReader();
  const chunks = [];
  let count = 0;
  try {
    for (let index = 0; index < LIMITS.response_bytes; index += 1) {
      const part = await reader.read();
      if (part.done) {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!response.ok) throw new Error(value.error ?? 'Board request rejected');
        return value;
      }
      count += part.value.length;
      if (count > LIMITS.response_bytes) throw new Error('Board response exceeds limit');
      chunks.push(Buffer.from(part.value));
    }
    throw new Error('Board response read limit exceeded');
  } finally { await reader.cancel().catch(() => {}); }
}

export async function subscribe(connection, signal, onAvailable) {
  validateConnection(connection);
  identifier(connection.consumer);
  const response = await fetch(connection.url + '/events?consumer=' + encodeURIComponent(connection.consumer), {
    headers: { authorization: 'Bearer ' + connection.token }, signal, redirect: 'error',
  });
  if (!response.ok || !response.body) throw new Error('Parent board subscription refused');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (let index = 0; index < LIMITS.notifications; index += 1) {
      const part = await reader.read();
      if (part.done) return;
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length > LIMITS.body_bytes) throw new Error('Board notification limit exceeded');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line) {
        const event = JSON.parse(line);
        if (event.type === 'available') {
          // A coordinator already running before the upgrade emits availability without a count.
          const pending = event.pending === undefined ? (await request(connection, 'status', {}, { signal })).pending : event.pending;
          onAvailable(availability({ ...event, pending }));
        }
      }
    }
    throw new Error('Board notification budget exhausted');
  } finally { await reader.cancel().catch(() => {}); }
}

export async function ensureBoard({ agentDir, parentId, cwd, packageRoot, environment = process.env }) {
  identifier(parentId);
  const path = join(agentDir, 'boards', parentId);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const configPath = join(path, 'config.json');
  if (!existsSync(configPath)) {
    try {
      writeFileSync(configPath, JSON.stringify({ parentId, cwd, agentDir, packageRoot,
        token: randomBytes(32).toString('hex'), umask: process.umask() }), { mode: 0o600, flag: 'wx' });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const configuration = readJson(configPath);
  if (configuration.parentId !== parentId) throw new Error('Board belongs to another parent');
  const endpointPath = join(path, 'endpoint.json');
  if (existsSync(endpointPath)) {
    const endpoint = readJson(endpointPath);
    try {
      const connection = { ...endpoint, token: configuration.token };
      const status = await request(connection, 'status');
      if (status.parentId !== parentId) throw new Error('Connected board belongs to another parent');
      return { ...connection, path, configuration };
    } catch {
      try { process.kill(endpoint.pid, 0); throw new Error('Existing board process is alive but unreachable; refusing duplicate service'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  const lockPath = join(path, 'starting.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = readJson(lockPath);
    try { process.kill(owner.pid, 0); throw new Error('Another process is starting this board'); }
    catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
    unlinkSync(lockPath);
    lock = openSync(lockPath, 'wx', 0o600);
  }
  closeSync(lock);
  writePrivate(lockPath, { pid: process.pid });
  try {
    const log = openSync(join(path, 'service.log'), 'a', 0o600);
    const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'service.mjs'), path], {
      detached: true, stdio: ['ignore', log, log], env: environment,
    });
    closeSync(log);
    let startupError;
    child.on('error', error => { startupError = error; });
    child.unref();
    for (let index = 0; index < LIMITS.startup_checks; index += 1) {
      if (startupError) throw new Error('Could not start board service');
      if (existsSync(endpointPath)) {
        const endpoint = readJson(endpointPath);
        if (endpoint.pid === child.pid) {
          const connection = { ...endpoint, token: configuration.token, path, configuration };
          const status = await request(connection, 'status');
          if (status.parentId !== parentId) throw new Error('Connected board belongs to another parent');
          return connection;
        }
      }
      if (child.exitCode !== null) throw new Error('Board service exited during startup; inspect its private log');
      await new Promise(resolve => setTimeout(resolve, LIMITS.startup_interval_ms));
    }
    child.kill('SIGTERM');
    throw new Error('Board service startup deadline exceeded');
  } finally { unlinkSync(lockPath); }
}
