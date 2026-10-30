import assert from "node:assert/strict";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ImportOptions } from "./types.ts";

const MAX_ARGUMENT_TOKENS = 20;

export function parseImportOptions(argumentText: string | undefined): ImportOptions {
  assert.ok(argumentText === undefined || typeof argumentText === "string");
  assert.ok(argumentText === undefined || argumentText.length <= 10_000, "Command arguments are too long");

  const tokens = tokenize(argumentText ?? "");
  assert.ok(tokens.length <= MAX_ARGUMENT_TOKENS, "Too many /import-session arguments");

  const options: ImportOptions = { all: false, mode: "state", refresh: false };
  const referenceTokens: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    assert.ok(token.length > 0, "Empty command argument");
    if (token === "--all" || token === "-a") {
      options.all = true;
      continue;
    }
    if (token === "--fast") {
      options.mode = "fast";
      continue;
    }
    if (token === "--deep") {
      options.mode = "deep";
      continue;
    }
    if (token === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (token === "--path") {
      const nextToken = tokens[index + 1];
      assert.ok(nextToken, "/import-session --path requires a file path");
      options.sourcePath = cleanSessionPath(expandTildePath(nextToken));
      index += 1;
      continue;
    }
    if (token.startsWith("--path=")) {
      const value = token.slice("--path=".length);
      assert.ok(value.length > 0, "/import-session --path requires a file path");
      options.sourcePath = cleanSessionPath(expandTildePath(value));
      continue;
    }
    if (token === "--cwd") {
      const nextToken = tokens[index + 1];
      assert.ok(nextToken, "/import-session --cwd requires a path");
      options.cwd = expandTildePath(nextToken);
      index += 1;
      continue;
    }
    if (token.startsWith("--cwd=")) {
      const value = token.slice("--cwd=".length);
      assert.ok(value.length > 0, "/import-session --cwd requires a path");
      options.cwd = expandTildePath(value);
      continue;
    }
    assert.ok(!token.startsWith("-"), `Unknown /import-session option: ${token}`);
    if (options.sourcePath && !isAbsolute(token) && !token.startsWith("~") && !token.startsWith("\\")) {
      referenceTokens.push(token);
      continue;
    }
    if (looksLikeSessionPath(token)) {
      assert.ok(options.sourcePath === undefined, "Only one session path may be provided");
      options.sourcePath = cleanSessionPath(expandTildePath(token));
      continue;
    }
    referenceTokens.push(token);
  }

  if (options.sourcePath && referenceTokens.length > 0) {
    options.sourcePath = cleanSessionPath(options.sourcePath + referenceTokens.join(""));
    referenceTokens.length = 0;
  }
  if (referenceTokens.length > 0) options.sessionRef = referenceTokens.join(" ");
  assert.ok(!(options.sourcePath && options.sessionRef), "Use either a session path or a session reference, not both");
  if (options.cwd) options.all = false;
  assert.ok(!options.cwd || options.cwd.length > 0, "Review cwd must not be empty");
  assert.ok(options.mode === "state" || options.mode === "fast" || options.mode === "deep", "Invalid import mode");
  assert.equal(typeof options.refresh, "boolean");
  return options;
}

export function expandTildePath(pathValue: string, homeDirectory = homedir()): string {
  assert.ok(typeof pathValue === "string" && pathValue.length > 0, "Path must be non-empty");
  assert.ok(typeof homeDirectory === "string" && homeDirectory.length > 0, "Home directory must be non-empty");
  if (pathValue === "~") return homeDirectory;
  if (pathValue.startsWith("~/") || pathValue.startsWith("~\\")) {
    return join(homeDirectory, pathValue.slice(2));
  }
  return pathValue;
}

function cleanSessionPath(value: string): string {
  assert.ok(typeof value === "string", "Session path must be text");
  assert.ok(value.length > 0, "Session path must not be empty");
  const cleaned = value.replace(/[\r\n]/g, "").trim();
  assert.ok(cleaned.length > 0, "Session path must not be empty after normalization");
  return cleaned;
}

function looksLikeSessionPath(value: string): boolean {
  assert.ok(typeof value === "string", "Session path candidate must be text");
  assert.ok(value.length > 0, "Session path candidate must not be empty");
  return value.endsWith(".jsonl") || isAbsolute(value) || value.startsWith("~\\") || value.startsWith("~/");
}

function tokenize(input: string): string[] {
  assert.equal(typeof input, "string");
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    assert.ok(tokens.length < MAX_ARGUMENT_TOKENS, "Too many command arguments");
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  assert.equal(tokens.length <= MAX_ARGUMENT_TOKENS, true);
  return tokens;
}
