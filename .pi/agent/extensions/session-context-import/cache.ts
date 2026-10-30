import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { ImportMode } from "./types.ts";

const CACHE_DIRECTORY = "session-context-import/cache";
export const SUMMARY_CACHE_VERSION = 3;
const MAX_CACHE_TEXT_CHARS = 80_000;

export interface SummaryCacheEntry {
  version: number;
  key: string;
  sourceSessionId: string;
  sourceLeafId: string | null;
  sourceModifiedTimeMs: number;
  mode: ImportMode;
  model: string;
  createdAt: string;
  content: string;
  method: "llm-state" | "llm-deep";
  inputTokens: number;
  outputTokens: number;
  generationMs: number;
}

export function buildCacheKey(
  sourceSessionId: string,
  sourceLeafId: string | null,
  sourceModifiedTimeMs: number,
  sourceFileSize: number,
  model: string,
  mode: Exclude<ImportMode, "fast">,
): string {
  assert.ok(typeof sourceSessionId === "string" && sourceSessionId.length > 0, "Cache source ID is required");
  assert.ok(sourceLeafId === null || typeof sourceLeafId === "string", "Cache leaf ID is invalid");
  assert.ok(Number.isFinite(sourceModifiedTimeMs) && sourceModifiedTimeMs >= 0, "Cache modification time is invalid");
  assert.ok(Number.isInteger(sourceFileSize) && sourceFileSize >= 0, "Cache file size is invalid");
  assert.ok(typeof model === "string" && model.length > 0, "Cache model is required");
  assert.ok(mode === "state" || mode === "deep", "Cache mode is invalid");
  const input = [SUMMARY_CACHE_VERSION, sourceSessionId, sourceLeafId ?? "", sourceModifiedTimeMs, sourceFileSize, model, mode].join("|");
  const key = createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
  assert.ok(key.length === 32, "Cache key must be 32 characters");
  assert.ok(/^[a-f0-9]+$/.test(key), "Cache key must be hexadecimal");
  return key;
}

export async function readSummaryCache(key: string): Promise<SummaryCacheEntry | undefined> {
  assert.ok(typeof key === "string" && /^[a-f0-9]{32}$/.test(key), "Cache key is invalid");
  const path = cacheFilePath(key);
  try {
    const raw = await readFile(path, "utf8");
    const entry = JSON.parse(raw) as SummaryCacheEntry;
    assertValidEntry(entry, key);
    return entry;
  } catch {
    return undefined;
  }
}

export async function writeSummaryCache(entry: SummaryCacheEntry): Promise<void> {
  assertValidEntry(entry, entry.key);
  assert.ok(entry.content.length <= MAX_CACHE_TEXT_CHARS, "Cache content exceeds limit");
  const directory = join(getAgentDir(), CACHE_DIRECTORY);
  const path = cacheFilePath(entry.key);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(path, JSON.stringify(entry), { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
  } catch {
    // Cache failure must not prevent a confirmed import.
  }
}

function cacheFilePath(key: string): string {
  assert.ok(typeof key === "string" && /^[a-f0-9]{32}$/.test(key), "Cache key is invalid");
  assert.ok(CACHE_DIRECTORY.length > 0, "Cache directory is required");
  return join(getAgentDir(), CACHE_DIRECTORY, `${key}.json`);
}

function assertValidEntry(entry: SummaryCacheEntry, expectedKey: string): void {
  assert.ok(entry !== null && typeof entry === "object", "Cache entry is required");
  assert.equal(entry.version, SUMMARY_CACHE_VERSION);
  assert.equal(entry.key, expectedKey);
  assert.ok(typeof entry.sourceSessionId === "string" && entry.sourceSessionId.length > 0, "Cache source ID is invalid");
  assert.ok(entry.sourceLeafId === null || typeof entry.sourceLeafId === "string", "Cache source leaf is invalid");
  assert.ok(Number.isFinite(entry.sourceModifiedTimeMs) && entry.sourceModifiedTimeMs >= 0, "Cache source time is invalid");
  assert.ok(entry.mode === "state" || entry.mode === "deep", "Cache entry mode is invalid");
  assert.ok(typeof entry.model === "string" && entry.model.length > 0, "Cache entry model is invalid");
  assert.ok(typeof entry.content === "string" && entry.content.length > 0, "Cache entry content is invalid");
  assert.ok(entry.method === "llm-state" || entry.method === "llm-deep", "Cache entry method is invalid");
  assert.ok(Number.isFinite(entry.inputTokens) && entry.inputTokens >= 0, "Cache input tokens are invalid");
  assert.ok(Number.isFinite(entry.outputTokens) && entry.outputTokens >= 0, "Cache output tokens are invalid");
  assert.ok(Number.isFinite(entry.generationMs) && entry.generationMs >= 0, "Cache generation time is invalid");
}
