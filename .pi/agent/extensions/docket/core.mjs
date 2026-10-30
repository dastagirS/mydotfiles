import { createHash } from 'node:crypto';
import { api, preview } from './api.mjs';
import { discover, LIMITS, projectReference, sessionId, ticketId } from './repo.mjs';
import { withStore } from './store.mjs';

export function referenceFor(cwd) {
  const reference = discover(cwd);
  if (!reference) throw new Error('Attach this repo with /tickets:init <project URL> first');
  return reference;
}
export function freezeTicket(agentDir, parentCwd, workerCwd, parentId, id) {
  const reference = referenceFor(parentCwd);
  if (referenceFor(workerCwd).projectUrl !== reference.projectUrl) throw new Error('Worker directory belongs to a different Docket board');
  return withStore(agentDir, store => store.freeze(reference, ticketId(id), sessionId(parentId)));
}
function context(configuration) {
  if (!configuration.worker) return { reference: referenceFor(configuration.cwd), parent: sessionId(configuration.parentId) };
  const binding = configuration.worker.ticketBinding;
  if (!binding) throw new Error('This worker has no assigned Docket ticket');
  if (referenceFor(configuration.cwd).projectUrl !== binding.projectUrl) throw new Error('Repo board reference changed; worker ticket access is blocked');
  const { reference, policy } = withStore(configuration.agentDir, store => store.current(binding, configuration.worker.jobId));
  return { reference, parent: binding.parentId, binding, policy, job: configuration.worker.jobId };
}
function identity(value, reference, id) {
  if (value?.id !== id || value.project_id !== reference.projectId || !Number.isSafeInteger(value.version) || value.version < 1) throw new Error('Docket returned an invalid or wrong-board ticket');
  return value;
}
function validText(value, maximum, required) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > maximum || value.includes('\0') || (required && !value.trim())) throw new Error('Ticket text is missing or exceeds its UTF-8 byte limit');
  return value;
}

export async function executeTicket(configuration, action, parameters, callId, signal) {
  const current = context(configuration);
  const { reference, parent } = current;
  const worker = Boolean(configuration.worker);
  const allowed = worker ? ['get', 'comments', 'history', 'comment', 'progress'] : ['list', 'get', 'comments', 'history', 'create', 'start', 'comment', 'update', 'ownership', 'release', 'handoff', 'events', 'ack_events'];
  if (!allowed.includes(action)) throw new Error('This ticket action is not allowed for the session role');
  if (worker && parameters.ticketId !== undefined) throw new Error('Worker ticket identity is fixed; do not supply another ticket ID');
  if (worker && Object.keys(parameters).some(key => !['action', 'body', 'status', 'version', 'after', 'limit'].includes(key))) throw new Error('Worker tools accept only assigned-ticket read/comment/progress fields');
  if (action === 'list') {
    const result = await api(configuration.agentDir, reference, '/tickets', { body: { after: parameters.after ?? 0, q: parameters.query }, signal });
    if (!Array.isArray(result.items) || result.items.length > LIMITS.page || result.items.some(item => item?.project_id !== reference.projectId || !Number.isSafeInteger(item.id) || item.id < 1)) throw new Error('Docket returned an invalid or wrong-board ticket list');
    return preview(result);
  }
  if (action === 'events') {
    const cursor = withStore(configuration.agentDir, store => store.cursor(reference, parent));
    const result = await api(configuration.agentDir, reference, '/events', { body: { after: cursor.acknowledged }, signal });
    if (!Array.isArray(result.items) || result.items.length > LIMITS.page || result.items.some(event => event.project_id !== reference.projectId) || !Number.isSafeInteger(result.next_cursor) || result.next_cursor < cursor.acknowledged) throw new Error('Docket returned an invalid project event page');
    withStore(configuration.agentDir, store => store.deliver(reference, parent, result.next_cursor));
    return { ...preview(result), acknowledged: cursor.acknowledged, instruction: 'Persist handling/deduplication before ack_events; delivery is not acknowledgement. No worker was launched.' };
  }
  if (action === 'ack_events') {
    withStore(configuration.agentDir, store => store.acknowledge(reference, parent, parameters.after));
    return { acknowledged: parameters.after };
  }
  const creating = action === 'create';
  if (creating && Object.keys(parameters).some(key => !['action', 'title', 'description', 'status'].includes(key))) throw new Error('Ticket creation accepts only title, description and status on the pinned project');
  const id = creating ? undefined : worker ? current.binding.ticketId : ticketId(parameters.ticketId);
  const path = creating ? '/tickets' : `/tickets/${id}`;
  if (action === 'get' || action === 'start') {
    const value = identity(await api(configuration.agentDir, reference, path, { signal }), reference, id);
    if (action === 'start') {
      if (!withStore(configuration.agentDir, store => store.policy(reference))) throw new Error('Configure worker workflow permissions with /tickets:init first');
      return { ticket: value, ownership: withStore(configuration.agentDir, store => store.claim(reference, id, parent)), instruction: 'Claimed only. No worker was launched; delegate explicitly with this ticketId after agreeing on scope.' };
    }
    return value;
  }
  if (action === 'comments' || action === 'history') {
    const result = await api(configuration.agentDir, reference, `${path}/${action}`, { body: { after: parameters.after ?? 0, limit: parameters.limit }, signal });
    if (!Array.isArray(result.items) || result.items.length > LIMITS.page || result.items.some(item => item.ticket_id !== id || (action === 'history' && item.project_id !== reference.projectId))) throw new Error('Docket returned records outside the assigned ticket');
    return parameters.limit === 1 ? result : preview(result);
  }
  if (action === 'ownership') return withStore(configuration.agentDir, store => ({ owner: store.owner(reference, id) ?? null, pendingWrites: store.pending(reference, id) }));
  if (action === 'release' || action === 'handoff') {
    if (action === 'handoff' && !parameters.targetSessionId) throw new Error('Handoff needs an explicit target parent session ID');
    return withStore(configuration.agentDir, store => store.transfer(reference, id, parent, action === 'handoff' ? parameters.targetSessionId : undefined));
  }
  const binding = creating ? undefined : current.binding ?? withStore(configuration.agentDir, store => store.freeze(reference, id, parent));
  const body = {};
  let method = creating ? 'POST' : 'PATCH';
  let suffix = path;
  if (action === 'comment') {
    body.body = validText(parameters.body, LIMITS.text_bytes, true);
    method = 'POST'; suffix += '/comments';
  } else if (action === 'progress') {
    if (!current.policy.progressStatuses.includes(parameters.status) || parameters.status === current.policy.completionStatus) throw new Error('Worker status is not an approved progress state; completion belongs to the parent');
    body.status = parameters.status;
  } else {
    if (creating || parameters.title !== undefined) body.title = validText(parameters.title, LIMITS.title_bytes, true);
    if (parameters.description !== undefined) body.description = validText(parameters.description, LIMITS.text_bytes, false);
    if (parameters.status !== undefined) body.status = validText(parameters.status, LIMITS.name_bytes, true);
    if (!creating && !Object.keys(body).length) throw new Error('No ticket changes supplied');
  }
  const version = creating ? undefined : ticketId(parameters.version);
  const operation = createHash('sha256').update(JSON.stringify([parent, current.job ?? 'parent', String(callId)])).digest('hex');
  const fingerprint = createHash('sha256').update(JSON.stringify(creating ? { project: reference.projectUrl, action, body } : { binding, job: current.job, action, body, version })).digest('hex');
  const previous = withStore(configuration.agentDir, store => creating ? store.prepareCreation(reference, parent, operation, fingerprint) : store.prepareOperation(binding, current.job, operation, fingerprint));
  if (previous.previous) return { ...previous.previous, duplicate: true };
  let result;
  try {
    result = await api(configuration.agentDir, reference, suffix, { method, body, version, actor: worker ? `Pi worker ${current.job}` : `Pi parent ${parent}`, signal });
    if (action !== 'comment') {
      try { identity(result, reference, creating ? ticketId(result.id) : id); }
      catch { throw Object.assign(new Error('Unexpected ticket write response'), { uncertain: true }); }
    }
    else if (result.comment?.ticket_id !== id || !Number.isSafeInteger(result.ticket_version)) throw Object.assign(new Error('Unexpected comment response'), { uncertain: true });
  } catch (error) {
    withStore(configuration.agentDir, store => store.settleOperation(operation, error?.uncertain ? 'uncertain' : 'rejected'));
    throw new Error(`${error.message} [operation ${operation}]`);
  }
  try { withStore(configuration.agentDir, store => store.settleOperation(operation, 'confirmed', result)); }
  catch { throw new Error(`Write may be committed but its receipt could not be saved. Inspect history; do not retry. Operation ${operation}`); }
  return result;
}
