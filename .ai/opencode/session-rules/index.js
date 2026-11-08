import { randomUUID } from 'node:crypto';

const RULE_CHARACTERS_MAX = 160;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const STORAGE_VERSION = 1;
const PROMPT_MARKER = 'session-rules-v1';

function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Rule text must not be blank.');
  if (text.length > RULE_CHARACTERS_MAX * 2 || [...text].length > RULE_CHARACTERS_MAX) {
    throw new Error(`Rule text must be at most ${RULE_CHARACTERS_MAX} Unicode characters.`);
  }
}

async function readRules(context, sessionId) {
  const saved = await context.storage.get(`session:${sessionId}`);
  if (saved === undefined) return [];
  if (!saved || saved.version !== STORAGE_VERSION || !Array.isArray(saved.rules)) throw new Error('Invalid saved session rules.');
  const identifiers = new Set();
  const texts = new Set();
  for (const rule of saved.rules) {
    if (!rule || typeof rule.id !== 'string' || !rule.id || identifiers.has(rule.id) || texts.has(rule.text)) {
      throw new Error('Invalid saved session rule.');
    }
    validateText(rule.text);
    identifiers.add(rule.id);
    texts.add(rule.text);
  }
  return saved.rules;
}

export default {
  id: 'local.session-rules',
  async setup(context) {
    if (typeof context.storage?.get !== 'function' || typeof context.storage?.set !== 'function'
      || typeof context.session?.hook !== 'function' || typeof context.tool?.transform !== 'function') {
      throw new Error('Session rules require the OpenCode 2 plugin API.');
    }
    // Native KV writes replace one snapshot atomically. Refuse overlapping mutations rather than losing an update.
    // No queued work or background task is created; reads can still observe the last committed snapshot.
    let mutating = false;
    await context.tool.transform(editor => editor.add({
      name: 'session_rules',
      description: 'Manage correction rules for this session only. List before adding to avoid semantic duplicates. Add one nonblank rule per call, at most 160 Unicode characters; multiline allowed. Exact duplicates are rejected. Remove by listed stable ID. Resume and compaction preserve rules; new session IDs and forks start empty. Reusing a deleted session ID restores its rules. Never store secrets.',
      options: { codemode: false },
      input: {
        type: 'object', additionalProperties: false, required: ['action'],
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'remove'] },
          text: { type: 'string', minLength: 1, maxLength: RULE_CHARACTERS_MAX },
          id: { type: 'string', minLength: 1, maxLength: 36 },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: PAGE_SIZE_MAX },
        },
      },
      async execute(input, toolContext) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected session-rule arguments.');
        if (Object.keys(input).some(key => !['action', 'text', 'id', 'offset', 'limit'].includes(key))) throw new Error('Unknown session-rule argument.');
        if (toolContext.signal?.aborted) throw new Error('Session-rule operation cancelled.');
        const sessionId = toolContext.sessionID;
        await context.session.get({ sessionID: sessionId });
        const mutation = input.action === 'add' || input.action === 'remove';
        if (mutation && mutating) throw new Error('Another session-rule mutation is in progress. List again before retrying.');
        if (mutation) mutating = true;
        try {
          const rules = await readRules(context, sessionId);
          let result;
          if (input.action === 'list') {
            if (input.text !== undefined || input.id !== undefined) throw new Error('List accepts only offset and limit.');
            const offset = input.offset ?? 0;
            const limit = input.limit ?? PAGE_SIZE_DEFAULT;
            if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) {
              throw new Error(`List requires a nonnegative safe-integer offset and limit 1–${PAGE_SIZE_MAX}.`);
            }
            const page = rules.slice(offset, offset + limit);
            result = { rules: page, total: rules.length, nextOffset: offset < rules.length - page.length ? offset + page.length : null };
          } else {
            if (input.offset !== undefined || input.limit !== undefined) throw new Error('Pagination applies only to list.');
            if (input.action === 'add') {
              if (input.id !== undefined) throw new Error('Add generates its own stable rule ID.');
              validateText(input.text);
              const duplicate = rules.find(rule => rule.text === input.text);
              if (duplicate) throw new Error(`Exact duplicate of rule ${duplicate.id}.`);
              const rule = { id: randomUUID(), text: input.text };
              rules.push(rule);
              result = { added: rule };
            } else if (input.action === 'remove') {
              if (input.text !== undefined) throw new Error('Remove accepts only a rule ID.');
              const index = rules.findIndex(rule => rule.id === input.id);
              if (index < 0) throw new Error('Rule ID not found in this session. List rules first.');
              rules.splice(index, 1);
              result = { removed: input.id };
            } else throw new Error('Unknown session-rule action.');
            if (toolContext.signal?.aborted) throw new Error('Session-rule operation cancelled.');
            await context.storage.set(`session:${sessionId}`, { version: STORAGE_VERSION, rules });
          }
          return { content: JSON.stringify(result) };
        } finally {
          if (mutation) mutating = false;
        }
      },
    }));
    await context.session.hook('context', async request => {
      const rules = await readRules(context, request.sessionID);
      // Replace only our request-local part; leave native instructions, history and tools untouched.
      request.system = request.system.filter(part => part.metadata?.sessionRules !== PROMPT_MARKER);
      request.system.push({
        type: 'text', metadata: { sessionRules: PROMPT_MARKER },
        text: `Current-session correction rules (not global policy; subordinate to higher-priority instructions). Only this list is active; removed or inherited rules in history are inactive.\n${rules.length ? rules.map(rule => JSON.stringify(rule)).join('\n') : '(none)'}`,
      });
    });
  },
};
