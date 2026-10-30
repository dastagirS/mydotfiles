import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { CandidateSession, SessionDigest, TextRecord } from "./types.ts";

const MAX_SOURCE_TEXT_CHARS = 60_000;
const MAX_SECTION_ITEMS = 12;
const MAX_FILES = 20;
const MAX_COMMANDS = 20;
const MAX_ITEM_CHARS = 500;
const LARGE_SOURCE_ENTRY_COUNT = 200;

export function buildDigest(
  records: TextRecord[],
  source: CandidateSession,
  leafId: string | null,
  skippedEntryCount: number,
  sourceModifiedTimeMs: number,
): SessionDigest {
  assert.ok(Array.isArray(records), "Digest records must be an array");
  assert.ok(source !== null && typeof source === "object", "Digest source is required");
  assert.ok(Number.isInteger(skippedEntryCount) && skippedEntryCount >= 0, "Skipped count must be non-negative");
  assert.ok(Number.isFinite(sourceModifiedTimeMs) && sourceModifiedTimeMs >= 0, "Source modification time is invalid");

  const fullText = records.map((record) => `[${record.role}] ${record.text}`).join("\n\n");
  const boundedText = trimToBudget(fullText, MAX_SOURCE_TEXT_CHARS);
  const userRecords = records.filter((record) => record.role === "user");
  const stateRecords = records.filter((record) => ["assistant", "tool", "compaction", "branch"].includes(record.role));
  const importedAt = new Date().toISOString();
  const digestHash = hashText(`${source.id}\n${leafId ?? ""}\n${boundedText}`);
  const truncated = boundedText.length < fullText.length || records.length > LARGE_SOURCE_ENTRY_COUNT;

  const digest: SessionDigest = {
    sourceName: source.name?.trim() || firstLine(source.firstMessage) || source.id,
    sourceSessionId: source.id,
    sourceSessionPath: source.path,
    sourceCwd: source.cwd,
    sourceLeafId: leafId,
    importedAt,
    digestHash,
    skippedEntryCount,
    truncated,
    originalGoal: cleanText(userRecords[0]?.text || source.firstMessage) || "Not identified.",
    currentState: cleanText(lastUseful(stateRecords)?.text) || "Not identified from the source context.",
    decisions: uniqueLines(extractMatching(boundedText, /\b(decided|decision|choose|chosen|approach|settled|will use|using)\b/i), MAX_SECTION_ITEMS),
    files: extractFiles(boundedText).slice(0, MAX_FILES),
    commands: extractCommands(boundedText).slice(0, MAX_COMMANDS),
    verification: uniqueLines(extractMatching(boundedText, /\b(pass(?:ed)?|fail(?:ed)?|test|verify|verified|check|validated|validation)\b/i), MAX_SECTION_ITEMS),
    constraints: uniqueLines(extractMatching(boundedText, /\b(must|must not|do not|don't|constraint|requirement|required|important)\b/i), MAX_SECTION_ITEMS),
    todos: uniqueLines(extractMatching(boundedText, /\b(todo|next|follow-?up|remaining|later|still need|open task|unfinished)\b/i), MAX_SECTION_ITEMS),
    risks: uniqueLines(extractMatching(boundedText, /\b(risk|avoid|danger|unsafe|corrupt|destructive|warning|blocked|failure)\b/i), MAX_SECTION_ITEMS),
  };
  assert.ok(digest.digestHash.length === 16, "Digest hash must be 16 characters");
  assert.ok(digest.sourceSessionId === source.id, "Digest source ID mismatch");
  return digest;
}

export function hashImportContent(sourceSessionId: string, sourceLeafId: string | null, content: string): string {
  assert.ok(typeof sourceSessionId === "string" && sourceSessionId.length > 0, "Source session ID is required");
  assert.ok(sourceLeafId === null || typeof sourceLeafId === "string", "Source leaf ID is invalid");
  assert.ok(typeof content === "string" && content.length > 0, "Import content is required");
  assert.ok(content.length <= MAX_SOURCE_TEXT_CHARS * 2, "Import content exceeds hash limit");
  const digestHash = hashText(`${sourceSessionId}\n${sourceLeafId ?? ""}\n${content}`);
  assert.ok(digestHash.length === 16, "Import hash must be 16 characters");
  return digestHash;
}

export function formatDigest(digest: SessionDigest): string {
  assert.ok(digest !== null && typeof digest === "object", "Digest is required");
  assert.ok(digest.digestHash.length === 16, "Digest hash is invalid");

  const warningLines = [
    digest.truncated ? "> Source context was truncated to stay within the import limit." : "",
    digest.skippedEntryCount > 0 ? `> ${digest.skippedEntryCount} source entries were skipped because they were unsupported or malformed.` : "",
  ].filter(Boolean);
  const output = `# Imported Session Context

Source: ${digest.sourceName}
Source session ID: ${digest.sourceSessionId}
Source working directory: ${digest.sourceCwd || "unknown"}
Source digest: ${digest.digestHash}
Imported at: ${digest.importedAt}
${warningLines.length > 0 ? `\n${warningLines.join("\n")}\n` : ""}
## Original Goal

${digest.originalGoal}

## Current State

${digest.currentState}

## Important Decisions

${bulletList(digest.decisions)}

## Relevant Files and Paths

${bulletList(digest.files)}

## Commands and Verification

${bulletList([...digest.commands, ...digest.verification])}

## Constraints and Assumptions

${bulletList(digest.constraints)}

## Open TODOs / Next Steps

${bulletList(digest.todos)}

## Risks / Things Not To Do

${bulletList(digest.risks)}
`;
  assert.ok(output.startsWith("# Imported Session Context"), "Formatted digest heading is missing");
  assert.ok(output.length > digest.originalGoal.length, "Formatted digest is unexpectedly empty");
  return output;
}

export function extractFiles(text: string): string[] {
  assert.ok(typeof text === "string", "File source text must be a string");
  assert.ok(text.length <= MAX_SOURCE_TEXT_CHARS + MAX_ITEM_CHARS, "File source text exceeds bounded input");
  const matches = text.match(/(?:[A-Za-z]:)?(?:[.]{1,2}[\\/]|[\\/]|[\w.-]+[\\/])[\w. @()[\]{}+,:;=-]+\.[A-Za-z0-9]{1,8}/g) ?? [];
  const files = [...new Set(matches.map((match) => match.trim().replace(/[),.;:]+$/, "")))];
  assert.ok(files.length <= matches.length, "Unique file count exceeds match count");
  assert.ok(files.every((file) => file.length > 0), "File paths must be non-empty");
  return files;
}

export function extractCommands(text: string): string[] {
  assert.ok(typeof text === "string", "Command source text must be a string");
  assert.ok(text.length <= MAX_SOURCE_TEXT_CHARS + MAX_ITEM_CHARS, "Command source text exceeds bounded input");
  const commands: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && commands.length < MAX_COMMANDS; index += 1) {
    addCommand(commands, lines[index]);
  }
  assert.ok(commands.length <= MAX_COMMANDS, "Command count exceeds limit");
  assert.ok(commands.every((command) => command.length <= MAX_ITEM_CHARS), "Command exceeds item limit");
  return [...new Set(commands)];
}

function addCommand(commands: string[], line: string): void {
  assert.ok(Array.isArray(commands), "Command collection is required");
  assert.ok(typeof line === "string", "Command line must be a string");
  const trimmed = line.trim().replace(/^\$\s*/, "");
  if (/^(npm|pnpm|yarn|node|git|rg|grep|find|ls|cd|mkdir|rm|cp|mv|cat|sed|python|pip|cargo|go|deno|bun|rift|pi)\b/.test(trimmed)) {
    commands.push(cleanText(trimmed, MAX_ITEM_CHARS));
  }
}

function extractMatching(text: string, pattern: RegExp): string[] {
  assert.ok(typeof text === "string", "Matching text must be a string");
  assert.ok(pattern instanceof RegExp, "Matching pattern is required");
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= MAX_ITEM_CHARS && pattern.test(line));
}

function uniqueLines(lines: string[], maximumItems: number): string[] {
  assert.ok(Array.isArray(lines), "Lines must be an array");
  assert.ok(Number.isInteger(maximumItems) && maximumItems > 0, "Item limit must be positive");
  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < lines.length && result.length < maximumItems; index += 1) {
    const line = lines[index].replace(/^[-*]\s*/, "");
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  assert.ok(result.length <= maximumItems, "Unique line count exceeds limit");
  assert.ok(result.every((line) => line.length > 0), "Unique lines must be non-empty");
  return result;
}

function cleanText(value: string | undefined, maximumCharacters = 1200): string {
  assert.ok(value === undefined || typeof value === "string", "Text must be a string");
  assert.ok(Number.isInteger(maximumCharacters) && maximumCharacters > 0, "Text limit must be positive");
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > maximumCharacters ? `${cleaned.slice(0, maximumCharacters - 1)}…` : cleaned;
}

function firstLine(value: string | undefined): string {
  assert.ok(value === undefined || typeof value === "string", "First message must be text");
  assert.ok(MAX_ITEM_CHARS > 0);
  return cleanText(value, 160);
}

function lastUseful(records: TextRecord[]): TextRecord | undefined {
  assert.ok(Array.isArray(records), "State records must be an array");
  assert.ok(records.every((record) => record !== null && typeof record === "object"), "State records are invalid");
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].text.trim().length > 20) return records[index];
  }
  return records.at(-1);
}

function trimToBudget(text: string, maximumCharacters: number): string {
  assert.ok(typeof text === "string", "Text budget input must be a string");
  assert.ok(Number.isInteger(maximumCharacters) && maximumCharacters > 0, "Text budget must be positive");
  if (text.length <= maximumCharacters) return text;
  const headCharacters = Math.floor(maximumCharacters * 0.65);
  const tailCharacters = Math.floor(maximumCharacters * 0.30);
  assert.ok(headCharacters + tailCharacters < maximumCharacters, "Text budget leaves truncation marker space");
  return `${text.slice(0, headCharacters)}\n\n[...source context truncated... ]\n\n${text.slice(text.length - tailCharacters)}`;
}

function hashText(text: string): string {
  assert.ok(typeof text === "string", "Hash input must be a string");
  assert.ok(text.length <= MAX_SOURCE_TEXT_CHARS + MAX_ITEM_CHARS, "Hash input exceeds limit");
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function bulletList(items: string[]): string {
  assert.ok(Array.isArray(items), "Bullet items must be an array");
  assert.ok(items.length <= MAX_FILES + MAX_COMMANDS + MAX_SECTION_ITEMS * 4, "Bullet list exceeds expected bounds");
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None identified.";
}
