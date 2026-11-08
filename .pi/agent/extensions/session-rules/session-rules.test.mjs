import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = process.env.PI_PACKAGE_ROOT ?? join(homedir(), '.local/lib/node_modules/@earendil-works/pi-coding-agent');
const { createJiti } = await import(pathToFileURL(join(packageRoot, 'node_modules/jiti/lib/jiti.mjs')));
const loader = createJiti(import.meta.url, { alias: {
  typebox: join(packageRoot, 'node_modules/typebox/build/index.mjs'),
  '@earendil-works/pi-coding-agent': join(packageRoot, 'dist/index.js'),
} });
const { default: extension } = await loader.import(new URL('./index.ts', import.meta.url).pathname);
const { SessionManager, DefaultResourceLoader, SettingsManager, createAgentSession } = await import(pathToFileURL(join(packageRoot, 'dist/index.js')));
const { getCurrentSystemPrompt, getCurrentTools } = await import(pathToFileURL(join(packageRoot, 'node_modules/@earendil-works/pi-ai/dist/utils/transcript.js')));
const { validateToolArguments } = await import(pathToFileURL(join(packageRoot, 'node_modules/@earendil-works/pi-ai/dist/utils/validation.js')));

function fixture(sessionManager = SessionManager.inMemory()) {
  const handlers = new Map();
  let tool;
  extension({ registerTool(value) { tool = value; }, on(name, handler) { handlers.set(name, handler); },
    appendEntry(type, data) { sessionManager.appendCustomEntry(type, data); } });
  const context = { sessionManager };
  return {
    sessionManager,
    call: parameters => tool.execute('test', parameters, undefined, undefined, context),
    callValidated: async parameters => tool.execute('test', validateToolArguments(tool, { name: tool.name, arguments: parameters }), undefined, undefined, context),
    prompt: messages => handlers.get('context_with_system')({ messages }, context).messages,
  };
}
const base = [{ role: 'system', content: '', sections: { preamble: 'Shared instructions unchanged.' },
  toolsAdded: [{ name: 'existing_tool', description: 'Preserve me', parameters: {} }], timestamp: 1 }];

test('character-only boundaries, multiline, exact duplicates, stable IDs and removal', async () => {
  const current = fixture();
  for (const text of ['', ' \n ', 'x'.repeat(161), '😀'.repeat(161)]) {
    await assert.rejects(current.call({ action: 'add', text }), /blank|160/);
  }
  const text = '😀'.repeat(158) + '\nA';
  await assert.rejects(current.callValidated({ action: 'add', text: '😀'.repeat(161) }), /160/);
  const added = (await current.callValidated({ action: 'add', text })).details.added;
  assert.equal(added.text, text);
  await assert.rejects(current.call({ action: 'add', text }), /duplicate/);
  assert.deepEqual((await current.call({ action: 'list' })).details.rules, [added]);
  const prompt = current.prompt(base);
  assert.match(getCurrentSystemPrompt(prompt), /Shared instructions unchanged/);
  assert.ok(getCurrentSystemPrompt(prompt).includes(JSON.stringify(text)));
  assert.deepEqual(getCurrentTools(prompt), getCurrentTools(base));
  assert.equal(base.length, 1, 'Request projection must not mutate history');
  await current.call({ action: 'remove', id: added.id });
  assert.doesNotMatch(getCurrentSystemPrompt(current.prompt(prompt)), /Current-session correction rules/);
  assert.match(getCurrentSystemPrompt(current.prompt(prompt)), /Shared instructions unchanged/);
  await assert.rejects(current.call({ action: 'remove', id: added.id }), /not found/);
});

test('pagination has no overall rule cap and rejects invalid or mixed inputs', async () => {
  const current = fixture();
  for (let index = 0; index < 105; index += 1) await current.call({ action: 'add', text: `Rule ${index}` });
  const first = (await current.call({ action: 'list', limit: 100 })).details;
  const last = (await current.call({ action: 'list', offset: first.nextOffset, limit: 100 })).details;
  assert.equal(first.total, 105);
  assert.equal(first.rules.length, 100);
  assert.equal(last.rules.length, 5);
  assert.equal(last.nextOffset, null);
  assert.equal(new Set([...first.rules, ...last.rules].map(rule => rule.id)).size, 105);
  assert.equal((await current.call({ action: 'list', offset: 999 })).details.nextOffset, null);
  for (const parameters of [
    { action: 'list', limit: 101 }, { action: 'list', offset: -1 }, { action: 'list', offset: 0.5 },
    { action: 'list', offset: Number.MAX_SAFE_INTEGER + 1 }, { action: 'list', text: 'wrong' },
    { action: 'add', text: 'Fine', limit: 2 }, { action: 'add', text: 'Fine', id: 'wrong' },
    { action: 'remove', id: first.rules[0].id, text: 'wrong' }, { action: 'unknown' },
  ]) await assert.rejects(current.call(parameters));
});

test('native JSONL resume/compaction retain rules, branches retain removals, fresh/fork sessions exclude copied rules', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-session-rules-'));
  try {
    const manager = SessionManager.create(directory, directory);
    const userId = manager.appendMessage({ role: 'user', content: 'Offline fixture', timestamp: 1 });
    const current = fixture(manager);
    const rule = (await current.call({ action: 'add', text: 'Keep this correction session-local.' })).details.added;
    const keepId = manager.appendMessage({ role: 'user', content: 'Keep', timestamp: 2 });
    manager.appendCompaction('Offline synthetic summary', keepId, 100);
    assert.equal(fixture(SessionManager.open(manager.getSessionFile())).prompt(base).at(-1).sections.session_rules.includes(rule.text), true);
    const fork = SessionManager.forkFrom(manager.getSessionFile(), directory, directory);
    assert.notEqual(fork.getSessionId(), manager.getSessionId());
    assert.equal((await fixture(fork).call({ action: 'list' })).details.total, 0);
    assert.doesNotMatch(getCurrentSystemPrompt(fixture(fork).prompt(current.prompt(base))), /Keep this correction/);
    const resumed = fixture(SessionManager.open(manager.getSessionFile()));
    assert.deepEqual((await resumed.call({ action: 'list' })).details.rules, [rule]);
    await resumed.call({ action: 'remove', id: rule.id });
    resumed.sessionManager.branch(userId);
    assert.equal((await resumed.call({ action: 'list' })).details.total, 0, 'Rules are session-wide even after tree navigation');
    assert.equal((await fixture(SessionManager.open(manager.getSessionFile())).call({ action: 'list' })).details.total, 0);
    assert.equal((await fixture().call({ action: 'list' })).details.total, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    assert.equal(existsSync(directory), false);
  }
});

test('failed persistence and cancellation never claim success', async () => {
  const current = fixture();
  const controller = new AbortController();
  controller.abort();
  let tool;
  extension({ registerTool(value) { tool = value; }, on() {}, appendEntry() { throw new Error('disk unavailable'); } });
  await assert.rejects(tool.execute('test', { action: 'add', text: 'Test' }, controller.signal, undefined, { sessionManager: current.sessionManager }), /cancelled/);
  await assert.rejects(tool.execute('test', { action: 'add', text: 'Test' }, undefined, undefined, { sessionManager: current.sessionManager }), /disk unavailable/);
  assert.equal((await current.call({ action: 'list' })).details.total, 0);
});

test('isolated native SDK discovers tool and applies actual request transform without a provider call', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-session-rules-sdk-'));
  let session;
  try {
    const settingsManager = SettingsManager.inMemory({ packages: [], compaction: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager,
      noExtensions: true, additionalExtensionPaths: [new URL('./index.ts', import.meta.url).pathname], noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true, systemPrompt: 'Isolated shared instructions.' });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    ({ session } = await createAgentSession({ cwd: directory, agentDir: directory, settingsManager, resourceLoader,
      sessionManager: SessionManager.inMemory(directory), tools: ['session_rules'] }));
    await session.bindExtensions({});
    const tool = session.agent.state.tools.find(tool => tool.name === 'session_rules');
    assert.ok(tool, 'Native SDK must expose the extension tool');
    const rule = (await tool.execute('sdk-add', { action: 'add', text: 'Apply immediately before the next request.' })).details.added;
    const projected = await session.agent.transformContext(base);
    const repeated = await session.agent.transformContext(base);
    assert.equal(repeated.length, projected.length, 'Unchanged requests must not accumulate rule messages');
    assert.equal(getCurrentSystemPrompt(repeated), getCurrentSystemPrompt(projected));
    assert.ok(getCurrentSystemPrompt(projected).includes(rule.text));
    assert.match(getCurrentSystemPrompt(projected), /Shared instructions unchanged/);
    assert.deepEqual(getCurrentTools(projected), getCurrentTools(base));
    await tool.execute('sdk-remove', { action: 'remove', id: rule.id });
    assert.doesNotMatch(getCurrentSystemPrompt(await session.agent.transformContext(projected)), /Apply immediately/);
    assert.equal(session.sessionManager.getEntries().filter(entry => entry.type === 'message').length, 0,
      'Request-only rule sections must not be persisted as conversation messages');
  } finally {
    session?.dispose();
    rmSync(directory, { recursive: true, force: true });
    assert.equal(existsSync(directory), false);
  }
});
