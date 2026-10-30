import type {
  SessionEntry,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";

export type ImportMode = "state" | "fast" | "deep";

export interface ImportOptions {
  all: boolean;
  cwd?: string;
  sessionRef?: string;
  sourcePath?: string;
  mode: ImportMode;
  refresh: boolean;
}

export interface TextRecord {
  role: "user" | "assistant" | "tool" | "custom" | "compaction" | "branch";
  text: string;
  entryId: string;
  timestamp: string;
  toolName?: string;
  isError?: boolean;
}

export interface SourceSnapshot {
  session: SessionInfo;
  entries: SessionEntry[];
  branchEntries: SessionEntry[];
  leafId: string | null;
  skippedEntryCount: number;
  fileSize: number;
  modifiedTimeMs: number;
}

export interface SessionDigest {
  sourceName: string;
  sourceSessionId: string;
  sourceSessionPath: string;
  sourceCwd: string;
  sourceLeafId: string | null;
  importedAt: string;
  digestHash: string;
  skippedEntryCount: number;
  truncated: boolean;
  originalGoal: string;
  currentState: string;
  decisions: string[];
  files: string[];
  commands: string[];
  verification: string[];
  constraints: string[];
  todos: string[];
  risks: string[];
}

export interface ImportMetadata {
  sourceSessionId: string;
  sourceSessionPath: string;
  sourceLeafId: string | null;
  sourceModifiedTimeMs: number;
  digestHash: string;
  importedAt: string;
  entryCount: number;
  method: "deterministic" | "llm-state" | "llm-deep";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ImportSummary {
  content: string;
  digestHash: string;
  method: "deterministic" | "llm-state" | "llm-deep";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  generationMs?: number;
}

export interface SessionManagerLike {
  getCwd(): string;
  getSessionFile(): string | undefined;
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
  appendCustomMessageEntry<T>(customType: string, content: string, display: boolean, details: T): string;
}

export interface CommandContextLike {
  cwd: string;
  hasUI: boolean;
  mode: string;
  sessionManager: SessionManagerLike;
  waitForIdle(): Promise<void>;
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
    notify(message: string, level: "info" | "warning" | "error" | "success"): void;
  };
}

export interface CandidateSession extends SessionInfo {}
