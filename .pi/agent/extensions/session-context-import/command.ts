import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { parseImportOptions } from "./arguments.ts";
import { extractContext } from "./context.ts";
import { buildDigest, formatDigest, hashImportContent } from "./digest.ts";
import { buildCacheKey, readSummaryCache, writeSummaryCache, SUMMARY_CACHE_VERSION } from "./cache.ts";
import { hasDuplicateImport, sendImportedContext } from "./importer.ts";
import { listCandidates, loadCandidateFromPath, readStableSource, resolveCandidate } from "./sessions.ts";
import { summarizeSession } from "./summarizer.ts";
import type { CandidateSession, ImportMetadata, ImportSummary } from "./types.ts";

const MAX_LABEL_LENGTH = 180;
const MAX_FIRST_MESSAGE_CHARS = 10_000_000;

export async function runImportCommand(
  pi: ExtensionAPI,
  argumentText: string | undefined,
  ctx: ExtensionCommandContext,
): Promise<void> {
  assert.ok(pi !== null && typeof pi === "object", "Pi API is required");
  assert.ok(ctx !== null && typeof ctx === "object", "Command context is required");
  assert.ok(ctx.sessionManager !== null && typeof ctx.sessionManager === "object", "Session manager is required");

  await ctx.waitForIdle();
  if (!ctx.hasUI) {
    ctx.ui.notify("/import-session requires Pi UI for session selection and review.", "error");
    return;
  }

  let options;
  try {
    options = parseImportOptions(argumentText);
  } catch (error) {
    ctx.ui.notify(formatError(error), "error");
    return;
  }

  const currentCwd = ctx.sessionManager.getCwd();
  const currentSessionFile = ctx.sessionManager.getSessionFile();
  assert.ok(typeof currentCwd === "string" && currentCwd.length > 0, "Current cwd is invalid");
  assert.ok(currentSessionFile === undefined || typeof currentSessionFile === "string", "Current session path is invalid");

  let selected: CandidateSession | undefined;
  if (options.sourcePath) {
    try {
      selected = await loadCandidateFromPath(options.sourcePath, currentSessionFile);
    } catch (error) {
      ctx.ui.notify(`Could not open the session path: ${formatError(error)}`, "error");
      return;
    }
  } else {
    let candidates;
    try {
      candidates = await listCandidates(currentCwd, currentSessionFile, options);
    } catch (error) {
      ctx.ui.notify(`Could not list Pi sessions: ${formatError(error)}`, "error");
      return;
    }
    if (candidates.length === 0) {
      ctx.ui.notify(
        options.all || options.cwd
          ? "No other Pi sessions found."
          : "No other Pi sessions found for this working directory. Try /import-session --all.",
        "info",
      );
      return;
    }
    selected = await chooseCandidate(ctx, candidates, options.sessionRef, options.all);
    if (!selected) return;
  }
  assert.ok(selected !== undefined, "A source session must be selected");

  let sourceSnapshot;
  try {
    sourceSnapshot = await readStableSource(selected);
  } catch (error) {
    ctx.ui.notify(`Could not read the selected source session: ${formatError(error)}`, "error");
    return;
  }

  const deterministicExtraction = extractContext(sourceSnapshot.entries);
  const deterministicDigest = buildDigest(
    deterministicExtraction.records,
    selected,
    sourceSnapshot.leafId,
    deterministicExtraction.skippedEntryCount,
    sourceSnapshot.modifiedTimeMs,
  );
  let summary: ImportSummary = {
    content: formatDigest(deterministicDigest),
    digestHash: deterministicDigest.digestHash,
    method: "deterministic",
  };

  if (options.mode !== "fast") {
    const summaryEntries = selectSummaryEntries(sourceSnapshot);
    const summaryExtraction = extractContext(summaryEntries);
    const model = ctx.model;
    if (!model) {
      ctx.ui.notify("No active model; using deterministic import instead.", "warning");
    } else {
      const modelName = `${model.provider}/${model.id}`;
      const cacheKey = buildCacheKey(
        selected.id,
        sourceSnapshot.leafId,
        sourceSnapshot.modifiedTimeMs,
        sourceSnapshot.fileSize,
        modelName,
        options.mode,
      );
      const cached = options.refresh ? undefined : await readSummaryCache(cacheKey);
      if (cached) {
        summary = {
          content: cached.content,
          digestHash: hashImportContent(selected.id, sourceSnapshot.leafId, cached.content),
          method: cached.method,
          model: cached.model,
          inputTokens: cached.inputTokens,
          outputTokens: cached.outputTokens,
          generationMs: cached.generationMs,
        };
        ctx.ui.notify(`Using cached ${cached.method === "llm-deep" ? "deep" : "project-state"} summary.`, "info");
      } else {
        ctx.ui.notify(options.mode === "deep" ? "Generating deep LLM handoff..." : "Generating LLM project state...", "info");
        try {
          const generated = await summarizeSession({
            model,
            modelRegistry: ctx.modelRegistry,
            sourceName: selected.name?.trim() || selected.id,
            sourceId: selected.id,
            sourceLeafId: sourceSnapshot.leafId,
            records: summaryExtraction.records,
            mode: options.mode,
            signal: ctx.signal,
          });
          const content = formatLlmImport(generated.content, selected, sourceSnapshot, generated.method, generated.omittedRecordCount);
          summary = {
            content,
            digestHash: hashImportContent(selected.id, sourceSnapshot.leafId, content),
            method: generated.method,
            model: modelName,
            inputTokens: generated.inputTokens,
            outputTokens: generated.outputTokens,
            generationMs: generated.generationMs,
          };
          await writeSummaryCache({
            version: SUMMARY_CACHE_VERSION,
            key: cacheKey,
            sourceSessionId: selected.id,
            sourceLeafId: sourceSnapshot.leafId,
            sourceModifiedTimeMs: sourceSnapshot.modifiedTimeMs,
            mode: options.mode,
            model: modelName,
            createdAt: new Date().toISOString(),
            content,
            method: generated.method,
            inputTokens: generated.inputTokens,
            outputTokens: generated.outputTokens,
            generationMs: generated.generationMs,
          });
        } catch (error) {
          ctx.ui.notify(`LLM summary failed; using deterministic import: ${formatError(error)}`, "warning");
        }
      }
    }
  }

  const reviewed = await ctx.ui.editor("Review imported session context:", summary.content);
  if (!reviewed?.trim()) {
    ctx.ui.notify("Session import cancelled.", "info");
    return;
  }
  const reviewedSummary: ImportSummary = {
    ...summary,
    content: reviewed.trim(),
    digestHash: hashImportContent(selected.id, sourceSnapshot.leafId, reviewed.trim()),
  };

  if (hasDuplicateImport(ctx.sessionManager, reviewedSummary)) {
    ctx.ui.notify("This exact source session context is already imported.", "warning");
    return;
  }

  const confirmed = await ctx.ui.confirm(
    "Import this session context?",
    "This adds a summarized context message to the current session and does not modify the source session.",
  );
  if (!confirmed) {
    ctx.ui.notify("Session import cancelled.", "info");
    return;
  }

  const metadata: ImportMetadata = {
    sourceSessionId: selected.id,
    sourceSessionPath: selected.path,
    sourceLeafId: sourceSnapshot.leafId,
    sourceModifiedTimeMs: sourceSnapshot.modifiedTimeMs,
    digestHash: reviewedSummary.digestHash,
    importedAt: new Date().toISOString(),
    entryCount: sourceSnapshot.entries.length,
    method: reviewedSummary.method,
    model: reviewedSummary.model,
    inputTokens: reviewedSummary.inputTokens,
    outputTokens: reviewedSummary.outputTokens,
  };
  try {
    sendImportedContext(pi, reviewedSummary.content, metadata);
  } catch (error) {
    ctx.ui.notify(`Could not import session context: ${formatError(error)}`, "error");
    return;
  }
  ctx.ui.notify(`Imported context from ${displayCandidate(selected)}.`, "success");
}

function selectSummaryEntries(sourceSnapshot: { entries: SessionEntry[]; branchEntries: SessionEntry[] }): SessionEntry[] {
  assert.ok(sourceSnapshot !== null && typeof sourceSnapshot === "object", "Source snapshot is required");
  assert.ok(Array.isArray(sourceSnapshot.entries) && Array.isArray(sourceSnapshot.branchEntries), "Source entries are invalid");
  const hasCompaction = sourceSnapshot.branchEntries.some((entry) => entry.type === "compaction" || entry.type === "branch_summary");
  const selected = hasCompaction ? sourceSnapshot.entries : sourceSnapshot.branchEntries;
  assert.ok(selected.length > 0, "Summary source entries must not be empty");
  assert.ok(selected.every((entry) => entry !== null && typeof entry === "object"), "Summary source entries are invalid");
  return selected;
}

function formatLlmImport(
  content: string,
  selected: CandidateSession,
  sourceSnapshot: { leafId: string | null; fileSize: number; entries: SessionEntry[] },
  method: "llm-state" | "llm-deep",
  omittedRecordCount: number,
): string {
  assert.ok(typeof content === "string" && content.trim().length > 0, "LLM import content is required");
  assert.ok(selected !== null && typeof selected === "object", "Selected source is required");
  assert.ok(sourceSnapshot !== null && typeof sourceSnapshot === "object", "Source snapshot is required");
  assert.ok(Number.isInteger(omittedRecordCount) && omittedRecordCount >= 0, "Omitted record count is invalid");
  const methodLabel = method === "llm-deep" ? "deep LLM handoff" : "LLM project state";
  const lines = [
    "# Imported Session Context",
    "",
    `Source: ${selected.name?.trim() || selected.id}`,
    `Source session ID: ${selected.id}`,
    `Source working directory: ${selected.cwd}`,
    `Source branch leaf: ${sourceSnapshot.leafId ?? "(root)"}`,
    `Import method: ${methodLabel}`,
    `Source entries: ${sourceSnapshot.entries.length}`,
    `Source file size: ${sourceSnapshot.fileSize} bytes`,
    omittedRecordCount > 0 ? `Evidence records omitted before summarization: ${omittedRecordCount}` : "",
    "",
    content.trim(),
    "",
    "> This is summarized historical context. Verify it against the current workspace before acting.",
  ].filter((line) => line.length > 0);
  const output = lines.join("\n");
  assert.ok(output.startsWith("# Imported Session Context"), "LLM import heading is missing");
  assert.ok(output.length > content.length, "LLM import metadata is missing");
  return output;
}

async function chooseCandidate(
  ctx: ExtensionCommandContext,
  candidates: CandidateSession[],
  reference: string | undefined,
  showFullCwd: boolean,
): Promise<CandidateSession | undefined> {
  assert.ok(ctx !== null && typeof ctx === "object", "Command context is required");
  assert.ok(Array.isArray(candidates) && candidates.length > 0, "Candidates are required");
  assert.ok(reference === undefined || reference.length > 0, "Session reference must be non-empty");

  if (reference) {
    const resolved = resolveCandidate(candidates, reference);
    if (resolved !== "ambiguous" && resolved) return resolved;
    if (resolved === undefined) {
      ctx.ui.notify("No session matched that reference.", "warning");
      return undefined;
    }
    ctx.ui.notify("Session reference matched multiple sessions; choose one from the picker.", "warning");
  }

  const labels = candidates.map((candidate) => formatCandidate(candidate, showFullCwd));
  assert.ok(labels.length === candidates.length, "Candidate labels do not match candidates");
  const choice = await ctx.ui.select("Choose a session to import:", labels);
  if (!choice) return undefined;
  const selectedIndex = labels.indexOf(choice);
  assert.ok(selectedIndex >= 0 && selectedIndex < candidates.length, "Picker returned an unknown session");
  return candidates[selectedIndex];
}

function formatCandidate(candidate: CandidateSession, showFullCwd: boolean): string {
  assert.ok(candidate !== null && typeof candidate === "object", "Candidate is required");
  assert.ok(typeof candidate.id === "string" && candidate.id.length > 0, "Candidate ID is required");
  const title = candidate.name?.trim() || firstLine(candidate.firstMessage) || candidate.id;
  const cwd = showFullCwd ? candidate.cwd : basename(candidate.cwd);
  const label = `${title} — ${candidate.modified.toISOString()} — ${cwd} — ${candidate.messageCount} entries`;
  const boundedLabel = label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label;
  assert.ok(boundedLabel.length > 0, "Candidate label must be non-empty");
  assert.ok(boundedLabel.length <= MAX_LABEL_LENGTH, "Candidate label exceeds UI limit");
  return boundedLabel;
}

function displayCandidate(candidate: CandidateSession): string {
  assert.ok(candidate !== null && typeof candidate === "object", "Candidate is required");
  assert.ok(typeof candidate.id === "string" && candidate.id.length > 0, "Candidate ID is required");
  return candidate.name?.trim() || candidate.id;
}

function firstLine(value: string): string {
  assert.ok(typeof value === "string", "First message must be text");
  assert.ok(value.length <= MAX_FIRST_MESSAGE_CHARS, "First message is unreasonably large");
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function basename(value: string): string {
  assert.ok(typeof value === "string", "Working directory must be text");
  assert.ok(value.length > 0, "Working directory must be non-empty");
  const normalized = value.replaceAll("\\", "/").replace(/\/$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) || normalized : normalized;
}

function formatError(error: unknown): string {
  assert.ok(error !== null && error !== undefined, "An error is required");
  const message = error instanceof Error ? error.message : String(error);
  assert.ok(message.length > 0, "Error message must be non-empty");
  return message;
}
