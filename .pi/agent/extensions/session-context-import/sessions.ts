import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { CandidateSession, ImportOptions, SourceSnapshot } from "./types.ts";

export async function loadCandidateFromPath(sourcePath: string, currentSessionFile: string | undefined): Promise<CandidateSession> {
  assert.ok(typeof sourcePath === "string" && sourcePath.length > 0, "Source path is required");
  assert.ok(currentSessionFile === undefined || typeof currentSessionFile === "string", "Current session path is invalid");
  const absolutePath = resolve(sourcePath);
  assert.ok(absolutePath.endsWith(".jsonl"), "Source path must point to a JSONL session");
  assert.ok(normalizePath(absolutePath) !== normalizePath(currentSessionFile), "Cannot import the current session");
  const sourceStat = await stat(absolutePath);
  assert.ok(sourceStat.isFile(), "Source path is not a regular file");
  const sourceManager = SessionManager.open(absolutePath);
  const header = sourceManager.getHeader();
  const entries = sourceManager.getEntries();
  assert.ok(header !== undefined, "Source session header is missing");
  assert.ok(Array.isArray(entries), "Source session entries are invalid");
  const candidate: CandidateSession = {
    path: absolutePath,
    id: header.id,
    cwd: header.cwd,
    name: sourceManager.getSessionName(),
    created: new Date(header.timestamp),
    modified: sourceStat.mtime,
    messageCount: entries.filter((entry) => entry.type === "message").length,
    firstMessage: "",
    allMessagesText: "",
  };
  assert.ok(candidate.id.length > 0, "Source session ID is missing");
  assert.ok(candidate.modified instanceof Date, "Source session modification date is invalid");
  return candidate;
}

const MAX_CANDIDATES = 100;
const MAX_SOURCE_READ_ATTEMPTS = 2;

export async function listCandidates(
  currentCwd: string,
  currentSessionFile: string | undefined,
  options: ImportOptions,
): Promise<CandidateSession[]> {
  assert.ok(typeof currentCwd === "string" && currentCwd.length > 0, "Current cwd is required");
  assert.ok(options !== null && typeof options === "object", "Import options are required");
  assert.ok(currentSessionFile === undefined || typeof currentSessionFile === "string", "Session file must be a string");

  const sessions = options.all
    ? await SessionManager.listAll()
    : await SessionManager.list(options.cwd ?? currentCwd);
  assert.ok(Array.isArray(sessions), "Pi returned an invalid session list");

  const currentPath = normalizePath(currentSessionFile);
  const candidates = sessions
    .filter((session) => normalizePath(session.path) !== currentPath)
    .sort((first, second) => second.modified.getTime() - first.modified.getTime())
    .slice(0, MAX_CANDIDATES);
  assert.ok(candidates.length <= MAX_CANDIDATES, "Candidate limit exceeded");
  return candidates;
}

export function resolveCandidate(candidates: CandidateSession[], reference: string): CandidateSession | "ambiguous" | undefined {
  assert.ok(Array.isArray(candidates), "Candidates must be an array");
  assert.ok(typeof reference === "string" && reference.trim().length > 0, "Session reference is required");

  const normalizedReference = normalizePath(reference.trim());
  const matches = candidates.filter((candidate) => {
    const candidatePath = normalizePath(candidate.path);
    const candidateName = (candidate.name ?? "").toLowerCase();
    return candidate.id.startsWith(reference.trim())
      || candidatePath === normalizedReference
      || candidatePath.includes(normalizedReference)
      || candidateName.includes(reference.trim().toLowerCase());
  });
  assert.ok(matches.length <= candidates.length, "Invalid candidate match count");
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return "ambiguous";
  return matches[0];
}

export async function readStableSource(session: CandidateSession): Promise<SourceSnapshot> {
  assert.ok(session !== null && typeof session === "object", "Source session is required");
  assert.ok(typeof session.path === "string" && session.path.endsWith(".jsonl"), "Source must be a Pi JSONL session");

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_SOURCE_READ_ATTEMPTS; attempt += 1) {
    try {
      const before = await stat(session.path);
      const sourceManager = await SessionManager.open(session.path);
      const after = await stat(session.path);
      assert.ok(before.isFile() && after.isFile(), "Source session is not a regular file");
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error("Source session changed while it was being read");
      }

      const entries = sourceManager.buildContextEntries();
      const branchEntries = sourceManager.getBranch();
      const leafId = sourceManager.getLeafId();
      assert.ok(Array.isArray(entries), "Source context entries must be an array");
      assert.ok(Array.isArray(branchEntries), "Source branch entries must be an array");
      assert.ok(leafId === null || typeof leafId === "string", "Source leaf ID is invalid");
      return {
        session,
        entries,
        branchEntries,
        leafId,
        skippedEntryCount: 0,
        fileSize: after.size,
        modifiedTimeMs: after.mtimeMs,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not read a stable source session: ${formatError(lastError)}`);
}

function normalizePath(value: string | undefined): string {
  assert.ok(value === undefined || typeof value === "string", "Path must be a string");
  const normalized = (value ?? "").replaceAll("\\", "/");
  assert.ok(typeof normalized === "string");
  return normalized;
}

function formatError(error: unknown): string {
  assert.ok(error !== null && error !== undefined, "An error is required");
  const message = error instanceof Error ? error.message : String(error);
  assert.ok(message.length > 0, "Error message must be non-empty");
  return message;
}
