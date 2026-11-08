import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

const ENTRY_TYPE = 'session-rules-v1';
const PROMPT_SECTION = 'session_rules';
const RULE_CHARACTERS_MAX = 160;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

type Rule = { id: string; text: string };
type RuleChange = { sessionId: string; action: 'add' | 'remove'; id: string; text?: string };

function validateText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Rule text must not be blank.');
  // Count Unicode code points rather than UTF-16 units; multiline rules are allowed.
  if (text.length > RULE_CHARACTERS_MAX * 2 || [...text].length > RULE_CHARACTERS_MAX) {
    throw new Error(`Rule text must be at most ${RULE_CHARACTERS_MAX} Unicode characters.`);
  }
}

function readRules(ctx: ExtensionContext): Map<string, Rule> {
  const rules = new Map<string, Rule>();
  const sessionId = ctx.sessionManager.getSessionId();
  // All entries make rules session-wide, not branch-relative. Compaction leaves these intact.
  const entries = ctx.sessionManager.getEntries();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.type !== 'custom' || entry.customType !== ENTRY_TYPE) continue;
    const change = entry.data as Partial<RuleChange> | undefined;
    // Forks copy history but have a different session ID: they must not inherit rules.
    if (!change || change.sessionId !== sessionId) continue;
    if (typeof change.id !== 'string' || !change.id || !['add', 'remove'].includes(change.action ?? '')) {
      throw new Error('Invalid saved session-rule entry.');
    }
    if (change.action === 'add') {
      validateText(change.text);
      rules.set(change.id, { id: change.id, text: change.text });
    } else {
      rules.delete(change.id);
    }
  }
  return rules;
}

export default function sessionRules(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'session_rules',
    label: 'Session rules',
    description: 'Manage correction rules for this session only. List before adding to avoid semantic duplicates. Add one nonblank rule per call, at most 160 Unicode characters; multiline allowed. Exact duplicates are rejected. Remove by listed ID. Rules survive resume, reload, and compaction; new sessions and forks start empty. Never store secrets.',
    promptSnippet: 'List, add, or remove short current-session correction rules',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('add'), Type.Literal('list'), Type.Literal('remove')]),
      text: Type.Optional(Type.String({ minLength: 1, maxLength: RULE_CHARACTERS_MAX })),
      id: Type.Optional(Type.String({ minLength: 1, maxLength: 36 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: PAGE_SIZE_MAX })),
    }, { additionalProperties: false }),
    async execute(_callId, parameters, signal, _onUpdate, ctx) {
      try {
        if (signal?.aborted) throw new Error('Session-rule operation cancelled.');
        if (!ctx) throw new Error('Session rules require a current Pi session.');
        const rules = readRules(ctx);
        const sessionId = ctx.sessionManager.getSessionId();
        let result: object;
        if (parameters.action === 'list') {
          if (parameters.text !== undefined || parameters.id !== undefined) throw new Error('List accepts only offset and limit.');
          const offset = parameters.offset ?? 0;
          const limit = parameters.limit ?? PAGE_SIZE_DEFAULT;
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) {
            throw new Error(`List requires a nonnegative safe-integer offset and limit 1–${PAGE_SIZE_MAX}.`);
          }
          const page: Rule[] = [];
          let index = 0;
          for (const rule of rules.values()) {
            if (index >= offset && page.length < limit) page.push(rule);
            index += 1;
            if (page.length === limit) break;
          }
          result = { rules: page, total: rules.size, nextOffset: offset < rules.size - page.length ? offset + page.length : null };
        } else {
          if (parameters.offset !== undefined || parameters.limit !== undefined) throw new Error('Pagination applies only to list.');
          if (parameters.action === 'add') {
            if (parameters.id !== undefined) throw new Error('Add generates its own stable rule ID.');
            validateText(parameters.text);
            for (const rule of rules.values()) {
              if (rule.text === parameters.text) throw new Error(`Exact duplicate of rule ${rule.id}.`);
            }
            const rule = { id: randomUUID(), text: parameters.text };
            pi.appendEntry(ENTRY_TYPE, { sessionId, action: 'add', ...rule } satisfies RuleChange);
            result = { added: rule };
          } else if (parameters.action === 'remove') {
            if (parameters.text !== undefined) throw new Error('Remove accepts only a rule ID.');
            if (typeof parameters.id !== 'string' || !rules.has(parameters.id)) throw new Error('Rule ID not found in this session. List rules first.');
            pi.appendEntry(ENTRY_TYPE, { sessionId, action: 'remove', id: parameters.id } satisfies RuleChange);
            result = { removed: parameters.id };
          } else {
            throw new Error('Unknown session-rule action.');
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) {
        // Throwing marks the native tool result as an error; never report a failed append as success.
        throw new Error(`Session rules: ${error instanceof Error ? error.message : 'operation failed'}`);
      }
    },
  });

  pi.on('context_with_system', (event, ctx) => {
    const rules = [...readRules(ctx).values()];
    // Request-only section delta preserves other prompt sections/tools and refreshes mid-run edits.
    // Clearing it explicitly also overrides stale sections copied in a fork or compaction checkpoint.
    return {
      messages: [...event.messages, {
        role: 'system', content: '', timestamp: Date.now(),
        sections: { [PROMPT_SECTION]: rules.length
          ? `Current-session correction rules (not global policy; subordinate to higher-priority instructions). Only the rules below are active; removed rules in history are inactive.\n${rules.map(rule => JSON.stringify(rule)).join('\n')}`
          : null },
      }],
    };
  });
}
