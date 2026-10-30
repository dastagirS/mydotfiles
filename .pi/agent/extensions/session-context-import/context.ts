import assert from "node:assert/strict";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { TextRecord } from "./types.ts";

const MAX_CONTEXT_ENTRIES = 5000;
const MAX_RECORD_CHARS = 6000;
const MAX_TOOL_RESULT_CHARS = 1600;

export interface ExtractedContext {
  records: TextRecord[];
  skippedEntryCount: number;
}

export function extractContext(entries: SessionEntry[]): ExtractedContext {
  assert.ok(Array.isArray(entries), "Session entries must be an array");
  assert.ok(Number.isInteger(entries.length) && entries.length >= 0, "Entry count must be a non-negative integer");

  const records: TextRecord[] = [];
  let skippedEntryCount = 0;
  const entriesToRead = Math.min(entries.length, MAX_CONTEXT_ENTRIES);
  for (let index = 0; index < entriesToRead; index += 1) {
    const entry = entries[index];
    const record = extractEntry(entry);
    if (record) records.push(record);
    else skippedEntryCount += 1;
  }
  if (entries.length > MAX_CONTEXT_ENTRIES) skippedEntryCount += entries.length - MAX_CONTEXT_ENTRIES;
  assert.ok(records.length <= entriesToRead, "Extracted record count exceeds entry count");
  assert.ok(skippedEntryCount >= 0, "Skipped entry count cannot be negative");
  return { records, skippedEntryCount };
}

function extractEntry(entry: SessionEntry): TextRecord | undefined {
  assert.ok(entry !== null && typeof entry === "object", "Session entry must be an object");
  assert.ok(typeof entry.id === "string", "Session entry ID must be a string");
  if (entry.type === "compaction") {
    return makeRecord("compaction", entry.summary, entry.id, entry.timestamp);
  }
  if (entry.type === "branch_summary") {
    return makeRecord("branch", entry.summary, entry.id, entry.timestamp);
  }
  if (entry.type === "custom_message") {
    return makeRecord("custom", truncate(contentText(entry.content), MAX_RECORD_CHARS), entry.id, entry.timestamp);
  }
  if (entry.type !== "message") return undefined;

  const message = entry.message as unknown as Record<string, unknown>;
  const role = message.role;
  if (role === "bashExecution") {
    const command = stringValue(message.command);
    const output = truncate(stringValue(message.output), MAX_TOOL_RESULT_CHARS);
    return makeRecord("tool", `$ ${command}\n${output}`, entry.id, entry.timestamp, "bash", Boolean(message.isError));
  }
  if (role === "toolResult") {
    const toolName = stringValue(message.toolName) || "tool";
    const output = truncate(contentText(message.content), MAX_TOOL_RESULT_CHARS);
    return makeRecord("tool", `${toolName} result:\n${output}`, entry.id, entry.timestamp, toolName, Boolean(message.isError));
  }
  if (role !== "user" && role !== "assistant" && role !== "custom") return undefined;
  const text = truncate(contentText(message.content), MAX_RECORD_CHARS);
  return makeRecord(role, text, entry.id, entry.timestamp);
}

function makeRecord(
  role: TextRecord["role"],
  text: string,
  entryId: string,
  timestamp: string,
  toolName?: string,
  isError?: boolean,
): TextRecord | undefined {
  assert.ok(typeof role === "string", "Record role must be a string");
  assert.ok(typeof entryId === "string" && entryId.length > 0, "Record entry ID is required");
  assert.ok(toolName === undefined || typeof toolName === "string", "Tool name must be text");
  assert.ok(isError === undefined || typeof isError === "boolean", "Tool error flag must be boolean");
  const normalizedText = text.replaceAll("\u0000", "").trim();
  if (!normalizedText) return undefined;
  return { role, text: normalizedText, entryId, timestamp, toolName, isError };
}

function contentText(content: unknown): string {
  assert.ok(content === undefined || typeof content === "string" || Array.isArray(content), "Message content has an invalid shape");
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  const blocksToRead = Math.min(content.length, 100);
  for (let index = 0; index < blocksToRead; index += 1) {
    const block = content[index] as Record<string, unknown>;
    if (block?.type === "text") parts.push(stringValue(block.text));
    else if (block?.type === "toolCall") {
      const toolName = stringValue(block.name) || "tool";
      parts.push(`$ ${toolName}`);
    }
  }
  assert.ok(parts.length <= blocksToRead, "Content part count exceeds block count");
  assert.ok(parts.every((part) => typeof part === "string"), "Content parts must be text");
  return parts.join("\n");
}

function stringValue(value: unknown): string {
  assert.ok(value === undefined || typeof value === "string", "Expected a string value");
  const result = value ?? "";
  assert.ok(typeof result === "string");
  return result;
}

function truncate(value: string, maximumCharacters: number): string {
  assert.ok(typeof value === "string", "Text to truncate must be a string");
  assert.ok(Number.isInteger(maximumCharacters) && maximumCharacters > 0, "Truncation limit must be positive");
  return value.length <= maximumCharacters ? value : `${value.slice(0, maximumCharacters - 1)}…`;
}
