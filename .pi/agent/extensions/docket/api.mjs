import { LIMITS, ticketId } from './repo.mjs';
import { withStore } from './store.mjs';

/**
 * @param {string} agentDir
 * @param {{projectUrl: string, origin: string, projectId: number}} reference
 * @param {string} suffix
 * @param {{method?: string, body?: Record<string, unknown>, version?: number, actor?: string, signal?: AbortSignal}} options
 */
export async function api(agentDir, reference, suffix = '', options = {}) {
  const { method = 'GET', body, version, actor = 'Pi', signal } = options;
  if (!/^\/(tickets(?:\/[1-9][0-9]*(?:\/(comments|history))?)?|events)$/.test(suffix) && suffix !== '') throw new Error('Unsupported project-scoped API path');
  withStore(agentDir, store => store.spend(reference));
  const url = new URL(`/api/projects/${reference.projectId}${suffix}`, reference.origin);
  if (method === 'GET' && body) {
    if (body.after !== undefined) {
      if (!Number.isSafeInteger(body.after) || body.after < 0) throw new Error('Invalid event/page cursor');
      url.searchParams.set('after', String(body.after));
    }
    const limit = body.limit ?? LIMITS.page;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMITS.page) throw new Error('Page limit must be between 1 and 20');
    url.searchParams.set('limit', String(limit));
    if (body.q !== undefined) {
      if (typeof body.q !== 'string' || Buffer.byteLength(body.q) > LIMITS.title_bytes) throw new Error('Search exceeds its byte limit');
      url.searchParams.set('q', body.q);
    }
  }
  const headers = { 'content-type': 'application/json', 'X-Docket-Actor': actor };
  if (version !== undefined) headers['If-Match'] = '"' + ticketId(version) + '"';
  let response;
  try {
    response = await fetch(url, { method, headers, redirect: 'error', ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(LIMITS.request_ms)]) : AbortSignal.timeout(LIMITS.request_ms) });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing response');
    const chunks = [];
    let size = 0;
    try {
      for (let index = 0; index < LIMITS.response_chunks; index++) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > LIMITS.response_bytes) throw new Error('Response exceeds limit');
        chunks.push(item.value);
        if (index === LIMITS.response_chunks - 1) throw new Error('Response chunk limit reached');
      }
    } finally { await reader.cancel().catch(() => {}); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON response'); }
    if (!response.ok) {
      const messages = { 400: 'Docket rejected the input', 403: 'Docket rejected the configured origin/host', 404: 'Ticket/project not found in the configured board', 409: 'Docket version/data conflict; reload before deciding whether to retry', 415: 'Docket rejected the request format', 428: 'Docket requires the current version', 429: 'Docket rate limit reached; do not poll or retry automatically' };
      const error = new Error(messages[response.status] ?? 'Docket operation failed; inspect its outcome before retrying');
      error.uncertain = method !== 'GET' && response.status >= 500;
      error.status = response.status;
      throw error;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected response shape');
    return value;
  } catch (error) {
    if (Number.isInteger(error?.status)) throw error;
    const failure = new Error(method === 'GET' ? 'Docket is unavailable or returned an invalid response; no fallback board was used' : 'Docket write outcome is uncertain; inspect ticket history before any new attempt');
    failure.uncertain = method !== 'GET';
    throw failure;
  }
}
export function preview(value) {
  if (!value || typeof value !== 'object') return value;
  // Responses have a fixed shallow schema. Handle nested data explicitly, without recursive traversal.
  const result = {};
  for (const [key, field] of Object.entries(value).slice(0, LIMITS.preview_fields)) {
    if (typeof field === 'string') result[key] = field.length > LIMITS.preview_characters ? field.slice(0, LIMITS.preview_characters) + ' [truncated]' : field;
    else if (key === 'items' && Array.isArray(field)) result[key] = field.slice(0, LIMITS.page).map(item => {
      const row = {};
      for (const [name, content] of Object.entries(item).slice(0, LIMITS.record_fields)) row[name] = typeof content === 'string' ? content.slice(0, LIMITS.preview_characters) : typeof content === 'object' && content !== null ? '[data retained on server; use ticket/history API]' : content;
      return row;
    });
    else result[key] = field;
  }
  return result;
}
