import { closeSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MARKER_VERSION = 1;
export const LIMITS = Object.freeze({
  file_bytes: 8192, ancestors: 64, statuses: 12,
  name_bytes: 100, title_bytes: 200, text_bytes: 16000, page: 20,
  preview_characters: 1200, preview_fields: 24, record_fields: 16, url_characters: 4096,
  sqlite_busy_ms: 3000, sqlite_pages: 16384,
  response_bytes: 2 * 1024 * 1024, response_chunks: 4096, request_ms: 10000,
  claims: 10000, bindings: 32000, receipts: 10000,
  requests_per_minute: 300, minute_ms: 60000,
});

export function ticketId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('A positive safe integer ticket ID is required');
  return value;
}
export function sessionId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid parent session identity');
  return value;
}
export function projectReference(value) {
  if (typeof value !== 'string' || value.length > LIMITS.url_characters) throw new Error('Supply a Docket project URL');
  let url;
  try { url = new URL(value); } catch { throw new Error('Supply a valid Docket project URL'); }
  const match = url.pathname.match(/^\/projects\/([1-9][0-9]*)\/?$/);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !match) throw new Error('Project URL must be http(s)://host/projects/ID without credentials, query, or fragment');
  const projectId = ticketId(Number(match[1]));
  return { projectUrl: `${url.origin}/projects/${projectId}`, origin: url.origin, projectId };
}
function readSmallFile(path) {
  if (!lstatSync(path).isFile()) throw new Error('Ticket/Git metadata must be a regular file');
  const file = openSync(path, 'r');
  try {
    const data = Buffer.alloc(LIMITS.file_bytes + 1);
    const size = readSync(file, data, 0, data.length, 0);
    if (size > LIMITS.file_bytes) throw new Error('Repo ticket marker exceeds its size limit');
    return data.subarray(0, size).toString('utf8');
  } finally { closeSync(file); }
}
export function readMarker(path) {
  let parsed;
  try { parsed = JSON.parse(readSmallFile(path)); } catch { throw new Error('Repo ticket marker is invalid JSON, unreadable, or oversized'); }
  if (parsed?.version !== MARKER_VERSION || Object.keys(parsed).some(key => !['version', 'projectUrl'].includes(key))) throw new Error('Unsupported repo ticket marker');
  return projectReference(parsed.projectUrl);
}
export function discover(cwd) {
  let directory = realpathSync(cwd);
  let gitFile;
  let reachedRoot = false;
  for (let index = 0; index < LIMITS.ancestors; index++) {
    const marker = join(directory, '.pi', 'tickets.json');
    let found = false;
    try {
      if (!lstatSync(marker).isFile()) throw new Error('Repo ticket marker must be a regular file');
      found = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (found) return { ...readMarker(marker), marker, root: directory };
    if (!gitFile) {
      try { if (lstatSync(join(directory, '.git')).isFile()) gitFile = join(directory, '.git'); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const parent = dirname(directory);
    if (parent === directory) { reachedRoot = true; break; }
    directory = parent;
  }
  if (!reachedRoot) throw new Error('Repo ticket discovery exceeded its ancestor bound');
  if (!gitFile) return undefined;
  const match = readSmallFile(gitFile).trim().match(/^gitdir: (.+)$/);
  if (!match) throw new Error('Invalid Git worktree metadata; no board was guessed');
  const gitDirectory = resolve(dirname(gitFile), match[1]);
  let common;
  try { common = readSmallFile(join(gitDirectory, 'commondir')).trim(); }
  catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
  const root = dirname(realpathSync(resolve(gitDirectory, common)));
  const marker = join(root, '.pi', 'tickets.json');
  try { lstatSync(marker); } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
  return { ...readMarker(marker), marker, root };
}
export function attach(cwd, value) {
  const reference = projectReference(value);
  const previous = discover(cwd);
  if (previous) {
    if (previous.projectUrl !== reference.projectUrl) throw new Error('This folder already belongs to a different Docket project; no marker was replaced');
    return previous;
  }
  const root = realpathSync(cwd);
  mkdirSync(join(root, '.pi'), { recursive: true });
  const marker = join(root, '.pi', 'tickets.json');
  try { writeFileSync(marker, JSON.stringify({ version: MARKER_VERSION, projectUrl: reference.projectUrl }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw new Error('Could not write the repo ticket marker');
    if (readMarker(marker).projectUrl !== reference.projectUrl) throw new Error('A different project was attached concurrently; no marker was replaced');
  }
  return { ...reference, root, marker };
}
export function validatePolicy(project, input) {
  const names = project?.statuses;
  if (!Array.isArray(names) || !names.length || names.length > LIMITS.statuses || names.some(name => typeof name !== 'string' || Buffer.byteLength(name) > LIMITS.name_bytes)) throw new Error('Docket returned an invalid project workflow');
  if (!input || Object.keys(input).some(key => !['progressStatuses', 'completionStatus'].includes(key)) || !Array.isArray(input.progressStatuses) || input.progressStatuses.length > LIMITS.statuses || !names.includes(input.completionStatus)) throw new Error('Choose a completion status and a bounded progressStatuses array from this project');
  if (new Set(input.progressStatuses).size !== input.progressStatuses.length || input.progressStatuses.some(name => !names.includes(name) || name === input.completionStatus)) throw new Error('Worker progress statuses must be unique project statuses excluding completion');
  return { progressStatuses: input.progressStatuses, completionStatus: input.completionStatus };
}
