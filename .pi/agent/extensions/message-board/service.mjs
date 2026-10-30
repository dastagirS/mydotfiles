import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { BoardStore } from './store.mjs';
import { freezeTicket, referenceFor } from '../docket/core.mjs';
import { withStore } from '../docket/store.mjs';
import { LIMITS, STARTUP_ERROR_TYPES, STARTUP_PHASES, WORKER_MARKER, assignment, digest, identifier, readJson, report, taskPrompt, text, workerInstructions, writePrivate } from './protocol.mjs';

const boardPath = process.argv[2];
if (!boardPath) throw new Error('Board directory required');
process.umask(0o077);
const configuration = readJson(join(boardPath, 'config.json'));
const extensionPath = join(dirname(fileURLToPath(import.meta.url)), 'index.ts');
const store = new BoardStore(boardPath);
const workers = new Map();
const lifetimes = new Set();
let consumer;
let closing = false;
let lastParentMs = Date.now();
let windowStartedMs = Date.now();
let windowRequests = 0;

function notify() {
  if (!consumer || consumer.response.destroyed || consumer.response.writableEnded) return;
  if (consumer.response.writableLength > LIMITS.body_bytes) {
    consumer.response.destroy();
    return;
  }
  consumer.response.write(JSON.stringify({ type: 'available', ...store.availability() }) + '\n');
}
function runtimeEvent(jobId, kind, summary, payload = {}, eventId) {
  const job = store.job(jobId);
  const result = store.post(jobId, job.revision, { kind, summary }, 'runtime', eventId, payload);
  notify();
  return result;
}
if (store.jobs().some(job => job.definition.ticketBinding)) withStore(configuration.agentDir, tickets => tickets.interruptBoard(boardPath));
for (const job of store.recover()) {
  store.updateJob(job.id, { state: 'interrupted' });
  runtimeEvent(job.id, 'interrupted', 'Coordinator restarted; previous RPC control was lost. Work was not automatically replayed.', {}, 'recovery-' + job.id + '-' + job.revision);
}

function sendRpc(worker, command) {
  if (!worker.process.stdin?.writable || worker.pending.size >= LIMITS.rpc_pending) throw new Error('Worker RPC is unavailable or its command queue is full');
  const id = randomUUID();
  if (command.type !== 'extension_ui_response') worker.pending.set(id, command.type);
  const data = JSON.stringify({ id, ...command }) + '\n';
  if (Buffer.byteLength(data) > LIMITS.body_bytes) throw new Error('Worker command exceeds limit');
  worker.process.stdin.write(data, error => {
    if (error) {
      worker.pending.delete(id);
      try { runtimeEvent(worker.id, 'rpc_error', 'Worker command could not be delivered; inspect status before retrying.'); }
      catch { stop(1); }
    }
  });
  return id;
}
function rpcRecord(worker, record) {
  if (record.type === 'response') {
    worker.pending.delete(record.id);
    if (record.success === false) {
      if (record.command === 'startup') {
        const phase = STARTUP_PHASES.includes(record.startupPhase) ? record.startupPhase : 'unknown';
        const errorType = STARTUP_ERROR_TYPES.includes(record.errorType) ? record.errorType : 'UnknownError';
        store.updateJob(worker.id, { state: 'error', stage: 'startup_failed' });
        runtimeEvent(worker.id, 'startup_failed', `Worker initialization failed during ${phase} (${errorType}); inspect private diagnostics. No automatic retry.`,
          { phase, errorType, stderrPath: join(boardPath, 'workers', worker.id, 'stderr.log') });
      } else {
        store.updateJob(worker.id, { state: 'error' });
        runtimeEvent(worker.id, 'rpc_error', 'Worker RPC command was rejected. Inspect the worker session; no automatic retry.');
      }
    }
  } else if (record.type === 'agent_start' && !worker.cancelled) {
    store.updateJob(worker.id, { state: 'working' });
    notify();
  } else if (record.type === 'agent_settled' && !worker.cancelled) {
    const job = store.updateJob(worker.id, { state: 'idle' });
    if (!['result_reported', 'needs_decision', 'failed'].includes(job.stage)) {
      runtimeEvent(worker.id, 'worker_idle', 'Worker became idle without a result or decision request. This is not proof the task succeeded.');
    }
    notify();
  } else if (record.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(record.method)) {
    if (worker.ui.size >= LIMITS.ui_pending || Buffer.byteLength(JSON.stringify(record)) > LIMITS.body_bytes) throw new Error('Worker UI request limit exceeded');
    worker.ui.set(record.id, record);
    runtimeEvent(worker.id, 'needs_decision', 'Worker extension needs ' + record.method + ': ' + String(record.title ?? '').slice(0, 1000), { rpcUi: record });
  }
}
function drain(worker) {
  if (worker.draining || worker.process.exitCode !== null) return;
  worker.draining = true;
  try {
    for (let index = 0; index < LIMITS.rpc_records_batch; index += 1) {
      const end = worker.buffer.indexOf('\n');
      if (end < 0) break;
      const line = worker.buffer.slice(0, end).replace(/\r$/, '');
      worker.buffer = worker.buffer.slice(end + 1);
      if (line) rpcRecord(worker, JSON.parse(line));
    }
  } catch {
    worker.cancelled = true;
    try {
      store.updateJob(worker.id, { state: 'error' });
      runtimeEvent(worker.id, 'rpc_error', 'Worker emitted invalid or unsupported RPC output; it was stopped safely.');
    } catch { stop(1); }
    worker.process.kill('SIGTERM');
  } finally {
    worker.draining = false;
    if (worker.buffer.includes('\n') && !worker.cancelled) setImmediate(() => drain(worker));
  }
}
function launch(job, token) {
  if (workers.size >= LIMITS.workers) throw new Error('Concurrent worker limit reached');
  const path = join(boardPath, 'workers', job.id);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const workerConfig = {
    jobId: job.id, parentId: configuration.parentId, cwd: job.definition.cwd,
    agentDir: configuration.agentDir, packageRoot: configuration.packageRoot,
    extensionPath, url: 'http://127.0.0.1:' + server.address().port, token,
    ...(job.definition.ticketBinding ? { ticketBinding: job.definition.ticketBinding, ticketExtensionPath: join(dirname(extensionPath), '../docket/index.ts') } : {}),
    provider: job.definition.provider, model: job.definition.model, thinking: job.definition.thinking,
    sessionDir: join(path, 'sessions'), umask: configuration.umask,
  };
  writePrivate(join(path, 'worker.json'), workerConfig);
  writeFileSync(join(path, 'instructions.md'), workerInstructions(workerConfig), { mode: 0o600 });
  const child = spawn(process.execPath, [join(dirname(extensionPath), 'worker.mjs'), join(path, 'worker.json')], {
    cwd: job.definition.cwd,
    env: { ...process.env, PI_CODING_AGENT_DIR: configuration.agentDir, [WORKER_MARKER]: join(path, 'worker.json') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const worker = { id: job.id, process: child, pending: new Map(), ui: new Map(), decoder: new StringDecoder('utf8'), buffer: '', stderrBytes: 0, draining: false, cancelled: false };
  workers.set(job.id, worker);
  const deadline = setTimeout(() => cancelOrStop(job.id, 'Worker runtime deadline reached'), LIMITS.worker_ms);
  lifetimes.add(deadline);
  child.stdout.on('data', chunk => {
    worker.buffer += worker.decoder.write(chunk);
    if (Buffer.byteLength(worker.buffer) > LIMITS.rpc_line_bytes) {
      cancelOrStop(job.id, 'Worker RPC output exceeded its bounded buffer');
      return;
    }
    drain(worker);
  });
  child.stderr.on('data', chunk => {
    if (worker.stderrBytes >= LIMITS.stderr_bytes) return;
    const remaining = LIMITS.stderr_bytes - worker.stderrBytes;
    const bytes = chunk.subarray(0, remaining);
    worker.stderrBytes += bytes.length;
    try { appendFileSync(join(path, 'stderr.log'), bytes, { mode: 0o600 }); }
    catch { cancelOrStop(job.id, 'Could not preserve private worker diagnostics'); }
  });
  child.on('error', () => {
    try {
      store.updateJob(job.id, { state: 'error' });
      runtimeEvent(job.id, 'failed', 'Could not start the worker process.');
    } catch { stop(1); }
  });
  child.on('close', (code, signal) => {
    clearTimeout(deadline);
    lifetimes.delete(deadline);
    workers.delete(job.id);
    if (job.definition.ticketBinding) {
      try { withStore(configuration.agentDir, tickets => tickets.closeBinding(job.id)); }
      catch { stop(1); }
    }
    try {
      const state = worker.cancelled ? 'cancelled' : 'exited';
      store.updateJob(job.id, { state });
      if (!closing) runtimeEvent(job.id, state, `Worker process ${state}; exit=${code}, signal=${signal ?? 'none'}.`, { stderrPath: join(path, 'stderr.log') });
    } catch { stop(1); }
  });
  child.stdin.on('error', () => {}); // The write callback and close handler record the actionable failure.
  sendRpc(worker, { type: 'prompt', message: taskPrompt(job) });
}
function cancelOrStop(jobId, reason) {
  try { cancel(jobId, reason); }
  catch { stop(1); }
}
function cancel(jobId, reason = 'Cancelled by parent') {
  const worker = workers.get(jobId);
  if (!worker) throw new Error('Worker is not controlled by this service; no PID was guessed');
  worker.cancelled = true;
  store.updateJob(jobId, { state: 'cancelling' });
  worker.process.kill('SIGTERM');
  const escalation = setTimeout(() => {
    if (worker.process.exitCode === null && worker.process.signalCode === null) worker.process.kill('SIGKILL');
    lifetimes.delete(escalation);
  }, LIMITS.kill_delay_ms);
  lifetimes.add(escalation);
  runtimeEvent(jobId, 'cancellation_requested', reason + '; already completed side effects are not rolled back.');
}
function respond(event, answer) {
  const worker = workers.get(event.job_id);
  const job = store.job(event.job_id);
  if (!worker || worker.cancelled || job.revision !== event.revision) throw new Error('Worker unavailable or request belongs to an old assignment');
  if (event.payload.rpcUi) {
    const original = worker.ui.get(event.payload.rpcUi.id);
    if (!original) throw new Error('Interactive request is no longer pending');
    const response = { type: 'extension_ui_response', id: original.id };
    if (original.method === 'confirm') {
      if (!['true', 'false'].includes(answer)) throw new Error('Confirmation answer must be true or false');
      response.confirmed = answer === 'true';
    } else {
      if (original.method === 'select' && !original.options?.includes(answer)) throw new Error('Answer is not a listed option');
      response.value = answer;
    }
    sendRpc(worker, response);
    worker.ui.delete(original.id);
  } else {
    sendRpc(worker, { type: 'prompt', message: `Parent response to event ${event.id}:\n${answer}`, streamingBehavior: 'steer' });
  }
  store.answer(event.id, answer);
  store.updateJob(job.id, { stage: 'assigned' });
  notify();
}

async function command(actor, body) {
  if (actor !== 'parent') {
    const job = store.job(actor);
    if (body.action === 'context') return { job };
    if (body.action !== 'post') throw new Error('Workers may only read their assignment and post to their parent; delegation and peer messaging are forbidden');
    if (body.to !== undefined || body.parentId !== undefined || body.jobId !== undefined) throw new Error('Worker report recipients and identities are fixed by the service');
    identifier(body.eventId);
    const result = store.post(actor, body.revision, report(body), 'worker', body.eventId);
    notify();
    return { ...result, delivery: 'durably_queued', parentId: configuration.parentId };
  }
  lastParentMs = Date.now();
  if (body.action === 'status') return { ...store.status(), parentId: configuration.parentId, cwd: configuration.cwd, ticketBindingVersion: 1 };
  if (body.action === 'claim') {
    if (!consumer || consumer.id !== body.consumer) throw new Error('Attach a parent consumer before claiming');
    return { events: store.claim(body.consumer) };
  }
  if (body.action === 'ack') {
    if (!consumer || consumer.id !== body.consumer) throw new Error('Parent consumer is not active');
    store.acknowledge(body.consumer, body.ids);
    notify();
    return { acknowledged: body.ids };
  }
  if (body.action === 'retry') { store.retry(); notify(); return { retryEnabled: true }; }
  if (body.action === 'stop') { setTimeout(() => stop(0), 50); return { stopping: true }; }
  identifier(body.commandId);
  const fingerprint = digest(JSON.stringify(body));
  const remembered = store.remembered(body.commandId, fingerprint);
  if (remembered) return remembered;
  store.ensureCommandCapacity();
  let result;
  if (body.action === 'delegate') {
    const definition = assignment(body);
    if (definition.ticketId !== undefined) definition.ticketBinding = freezeTicket(configuration.agentDir, configuration.cwd, definition.cwd, configuration.parentId, definition.ticketId);
    const taskKey = body.taskKey === undefined ? digest(JSON.stringify(definition)) : identifier(body.taskKey);
    const existing = store.findTask(taskKey);
    if (existing) {
      if (JSON.stringify(existing.definition) !== JSON.stringify(definition)) throw new Error('Task key already belongs to a different assignment');
      result = { accepted: true, duplicate: true, jobId: existing.id, revision: existing.revision, cwd: existing.definition.cwd };
      store.remember(body.commandId, fingerprint, result);
      return result;
    }
    if (workers.size >= LIMITS.workers) throw new Error('Concurrent worker limit reached; cancel an idle worker before delegating more');
    if (!statSync(definition.cwd).isDirectory()) throw new Error('Worker cwd must be an existing directory; workspaces are managed separately');
    const token = randomBytes(32).toString('hex');
    const job = store.createJob(definition, token, taskKey);
    result = { accepted: true, jobId: job.id, revision: job.revision, cwd: definition.cwd };
    try {
      if (definition.ticketBinding) withStore(configuration.agentDir, tickets => tickets.bind(definition.ticketBinding, boardPath, job.id));
      store.remember(body.commandId, fingerprint, result);
      launch(job, token);
      notify();
    }
    catch {
      if (definition.ticketBinding) {
        if (workers.has(job.id)) cancelOrStop(job.id, 'Ticket worker startup failed');
        else withStore(configuration.agentDir, tickets => tickets.closeBinding(job.id));
      }
      store.updateJob(job.id, { state: 'error' });
      runtimeEvent(job.id, 'failed', 'Worker startup failed; inspect board status. No automatic re-launch.');
    }
    return result;
  }
  if (body.action === 'respond') {
    const event = store.event(body.eventId);
    if (!event || event.kind !== 'needs_decision') throw new Error('Respond to a decision event from this board');
    const answer = text(body.answer, 'answer', LIMITS.task);
    if (event.answer !== null) {
      if (event.answer !== answer) throw new Error('Decision already answered differently');
      return { alreadyAnswered: event.id };
    }
    result = { accepted: true, eventId: event.id };
    store.remember(body.commandId, fingerprint, result);
    try { respond(event, answer); }
    catch (error) { store.failCommand(body.commandId); throw error; }
  } else if (body.action === 'instruct') {
    const job = store.job(body.jobId);
    const worker = workers.get(body.jobId);
    if (!worker || worker.cancelled || job?.state !== 'idle') throw new Error('Wait for the worker idle state before assigning a new task');
    const definition = assignment(body, job.definition);
    if (definition.ticketBinding) {
      if (referenceFor(definition.cwd).projectUrl !== definition.ticketBinding.projectUrl) throw new Error('Worker repo board changed; a new worker is required');
      withStore(configuration.agentDir, tickets => tickets.current(definition.ticketBinding, job.id));
    }
    const next = store.updateJob(job.id, { definition, revision: job.revision + 1, state: 'working', stage: 'assigned' });
    result = { accepted: true, jobId: job.id, revision: next.revision };
    store.remember(body.commandId, fingerprint, result);
    try { sendRpc(worker, { type: 'prompt', message: taskPrompt(next) }); notify(); }
    catch (error) { store.failCommand(body.commandId); store.updateJob(job.id, { state: 'error' }); throw error; }
  } else if (body.action === 'cancel') {
    text(body.jobId, 'worker identity', 128);
    result = { cancellationRequested: body.jobId };
    store.remember(body.commandId, fingerprint, result);
    try { cancel(body.jobId); }
    catch (error) { store.failCommand(body.commandId); throw error; }
  } else throw new Error('Unknown parent action');
  return result;
}
function reply(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
const server = http.createServer(async (incoming, response) => {
  try {
    if (closing) return reply(response, 503, { error: 'Board is stopping' });
    if (Date.now() - windowStartedMs >= LIMITS.minute_ms) { windowStartedMs = Date.now(); windowRequests = 0; }
    if (++windowRequests > LIMITS.requests_per_minute) return reply(response, 429, { error: 'Board request rate limit reached' });
    const token = incoming.headers.authorization?.replace(/^Bearer /, '');
    if (!token || token.length > 256) return reply(response, 403, { error: 'Board capability required' });
    const actor = digest(token) === digest(configuration.token) ? 'parent' : store.authenticate(token);
    if (!actor) return reply(response, 403, { error: 'Unknown board capability' });
    if (incoming.method === 'GET' && incoming.url?.startsWith('/events?')) {
      if (actor !== 'parent') return reply(response, 403, { error: 'Only parent can consume board updates' });
      const id = identifier(new URL(incoming.url, 'http://127.0.0.1').searchParams.get('consumer'));
      if (consumer) return reply(response, 409, { error: 'This board already has a live parent consumer' });
      consumer = { id, response };
      response.on('error', () => response.destroy());
      response.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      notify();
      response.on('close', () => {
        if (consumer?.id === id) {
          consumer = undefined;
          try { store.release(id); } catch { stop(1); }
        }
      });
      return;
    }
    if (incoming.method !== 'POST' || incoming.url !== '/command') return reply(response, 404, { error: 'Unknown board endpoint' });
    const parts = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > LIMITS.body_bytes) return reply(response, 413, { error: 'Board command size limit exceeded' });
      parts.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Command object required');
    reply(response, 200, await command(actor, body));
  } catch (error) {
    let message = error instanceof Error && !('code' in error) ? error.message : 'Board operation failed; inspect coordinator state and storage before retrying';
    if (error?.code === 'ERR_SQLITE_ERROR') {
      message = 'Board SQLite operation failed. Inspect schema/storage and existing jobs before retrying; safely stop/reinitialize with current extension code to check/apply schema migration. Preserve board history.';
      try {
        const code = Number.isSafeInteger(error.errcode) ? error.errcode : 'unknown';
        const diagnostic = `Board SQLite request failed [code=ERR_SQLITE_ERROR; sqlite=${code}]. No request data logged.\n`;
        const logPath = join(boardPath, 'service.log');
        if ((statSync(logPath, { throwIfNoEntry: false })?.size ?? 0) + Buffer.byteLength(diagnostic) > LIMITS.stderr_bytes) message += ' Diagnostic capacity reached; existing service.log was retained.';
        else {
          appendFileSync(logPath, diagnostic, { mode: 0o600 });
          message += ' A sanitized diagnostic was saved to service.log.';
        }
      } catch { message += ' The private diagnostic could not be saved; check storage permissions/capacity.'; }
    }
    reply(response, 400, { error: message });
  }
});
server.headersTimeout = 5000;
server.requestTimeout = LIMITS.request_ms;
server.maxConnections = LIMITS.connections;
server.listen(0, '127.0.0.1', () => {
  writePrivate(join(boardPath, 'endpoint.json'), { url: 'http://127.0.0.1:' + server.address().port, pid: process.pid });
});
function stop(code) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const timer of lifetimes) clearTimeout(timer);
  for (const worker of workers.values()) {
    worker.cancelled = true;
    worker.process.kill('SIGTERM');
  }
  if (consumer) consumer.response.end();
  server.closeAllConnections();
  server.close();
  const escalation = setTimeout(() => {
    for (const worker of workers.values()) {
      if (worker.process.exitCode === null && worker.process.signalCode === null) worker.process.kill('SIGKILL');
    }
    store.close();
  }, LIMITS.kill_delay_ms);
  escalation.unref();
}
const lifetime = setTimeout(() => stop(0), LIMITS.service_ms);
const idle = setInterval(() => {
  if (consumer && !consumer.response.destroyed && !consumer.response.writableEnded) {
    try { consumer.response.write(JSON.stringify({ type: 'ping' }) + '\n'); }
    catch { consumer.response.destroy(); }
  }
  if (!consumer && !workers.size && Date.now() - lastParentMs > LIMITS.detached_idle_ms) stop(0);
}, LIMITS.heartbeat_ms);
lifetimes.add(lifetime);
lifetimes.add(idle);
server.on('error', () => stop(1));
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
