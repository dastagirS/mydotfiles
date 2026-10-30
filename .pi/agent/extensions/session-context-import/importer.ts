import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ImportMetadata, ImportSummary, SessionManagerLike } from "./types.ts";

const CUSTOM_MESSAGE_TYPE = "session-context-import";

export function hasDuplicateImport(sessionManager: SessionManagerLike, summary: ImportSummary): boolean {
  assert.ok(sessionManager !== null && typeof sessionManager === "object", "Session manager is required");
  assert.ok(summary !== null && typeof summary === "object", "Import summary is required");

  const entries = sessionManager.getEntries();
  assert.ok(Array.isArray(entries), "Current session entries must be an array");
  const duplicate = entries.some((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== CUSTOM_MESSAGE_TYPE) return false;
    const details = entry.details as Partial<ImportMetadata> | undefined;
    return details?.digestHash === summary.digestHash && details.sourceSessionId === summary.sourceSessionId;
  });
  assert.equal(typeof duplicate, "boolean");
  return duplicate;
}

export function sendImportedContext(
  pi: Pick<ExtensionAPI, "sendMessage">,
  content: string,
  metadata: ImportMetadata,
): void {
  assert.ok(pi !== null && typeof pi === "object", "Pi API is required");
  assert.ok(typeof content === "string" && content.trim().length > 0, "Imported content must be non-empty");
  assert.ok(metadata !== null && typeof metadata === "object", "Import metadata is required");
  assert.ok(metadata.digestHash.length === 16, "Import digest hash is invalid");

  pi.sendMessage(
    {
      customType: CUSTOM_MESSAGE_TYPE,
      content,
      display: false,
      details: metadata,
    },
    { deliverAs: "nextTurn" },
  );
}
