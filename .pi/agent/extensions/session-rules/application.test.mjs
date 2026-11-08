import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const PACKAGE_ROOT = process.env.PI_PACKAGE_ROOT ?? join(homedir(), '.local/lib/node_modules/@earendil-works/pi-coding-agent');
const OPERATION_TIMEOUT_MS = 15000;
const REQUESTS_MAX = 64;
const OUTPUT_BYTES_MAX = 4 * 1024 * 1024;
const RULE_TEXT = 'Keep corrections session-local.\nNever change project instructions for a session preference.';

// This client deliberately supplies an allowlisted environment instead of inheriting credentials.
function startClient(directory, sessionFile) {
  const child = spawn(process.execPath, [join(PACKAGE_ROOT, 'dist/bundle/cli.js'), '--mode', 'rpc',
    '--offline', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes',
    '--provider', 'session-rules-fixture', '--model', 'fixture', '--tools', 'session_rules,read',
    ...(sessionFile ? ['--session', sessionFile] : [])], {
    cwd: join(directory, 'project'), stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: join(directory, 'home'), XDG_CONFIG_HOME: join(directory, 'home/.config'),
      PI_CODING_AGENT_DIR: join(directory, 'agent'), PI_OFFLINE: '1', LANG: 'C.UTF-8', NO_PROXY: '127.0.0.1' },
  });
  const pending = new Map();
  const events = [];
  let requestCount = 0;
  let outputBytes = 0;
  let failure;
  let settled;
  function fail(error) {
    failure = error;
    for (const operation of pending.values()) operation.reject(error);
    settled?.reject(error);
  }
  const lines = createInterface({ input: child.stdout });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`Isolated Pi exited: ${code ?? signal}`)));
  child.stdin.on('error', fail);
  child.stderr.on('data', data => {
    outputBytes += data.length;
    if (outputBytes > OUTPUT_BYTES_MAX) { fail(new Error('Fixture output limit exceeded')); child.kill('SIGKILL'); }
  });
  lines.on('line', line => {
    try {
      outputBytes += Buffer.byteLength(line);
      assert.ok(outputBytes <= OUTPUT_BYTES_MAX, 'Bound isolated process output');
      const event = JSON.parse(line);
      if (event.type === 'response') {
        const operation = pending.get(event.id);
        assert.ok(operation, 'Every response must match a pending command');
        if (event.success) operation.resolve(event.data);
        else operation.reject(new Error(`RPC ${event.command}: ${event.error}`));
      } else {
        assert.ok(events.length < 4096, 'Bound collected fixture events');
        events.push(event);
        if (event.type === 'agent_settled') settled?.resolve();
      }
    } catch (error) { fail(error); child.kill('SIGKILL'); }
  });
  async function request(type, fields = {}) {
    if (failure) throw failure;
    assert.equal(pending.size, 0, 'Fixture commands must be sequential');
    assert.ok(requestCount < REQUESTS_MAX, 'Bound RPC command count');
    const id = `fixture-${++requestCount}`;
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`RPC ${type} timed out`)), OPERATION_TIMEOUT_MS);
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
      });
    } finally { clearTimeout(timeout); pending.delete(id); }
  }
  return {
    request, events,
    async prompt(message) {
      assert.equal(settled, undefined);
      let timeout;
      const completion = new Promise((resolve, reject) => {
        settled = { resolve, reject };
        timeout = setTimeout(() => reject(new Error(`Prompt ${message} did not settle`)), OPERATION_TIMEOUT_MS);
      });
      // Attach a rejection handler immediately, including while awaiting command acceptance.
      const observed = completion.then(() => undefined, error => error);
      try {
        const response = await request('prompt', { message });
        assert.equal(response.disposition, 'started');
        const error = await observed;
        if (error) throw error;
      } finally { clearTimeout(timeout); settled = undefined; }
    },
    async stop() {
      lines.close();
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(timeout); }
    },
  };
}

test('real isolated Pi CLI: provider tool loop, native reload, compaction, restart/resume, fork, removal and new-session isolation', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-session-rules-application-'));
  const requests = [];
  const serverErrors = [];
  const cursors = new Map();
  let ruleId;
  let client;
  let toolCallCount = 0;
  const server = createServer(async (incoming, outgoing) => {
    try {
      assert.equal(incoming.method, 'POST');
      assert.equal(incoming.url, '/v1/chat/completions');
      assert.ok(requests.length < REQUESTS_MAX, 'Bound local provider requests');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        assert.ok(bytes <= OUTPUT_BYTES_MAX, 'Bound provider request size');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      const tools = body.tools?.map(tool => tool.function?.name ?? tool.name) ?? [];
      let call;
      let content = 'SCRIPTED_NATIVE_COMPACTION_SUMMARY: isolated lifecycle fixture.';
      if (tools.includes('session_rules')) {
        assert.ok(tools.includes('read'), 'Existing native tool declaration must remain');
        const system = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
        for (const sentinel of ['GLOBAL_FIXTURE_INSTRUCTIONS', 'APPENDED_FIXTURE_INSTRUCTIONS', 'PROJECT_FIXTURE_INSTRUCTIONS']) {
          assert.ok(system.includes(sentinel), `Preserve ${sentinel}`);
        }
        const userContent = body.messages.findLast(message => message.role === 'user')?.content;
        const phase = typeof userContent === 'string' ? userContent : userContent?.map(part => part.text ?? '').join('');
        assert.equal(typeof phase, 'string');
        const cursor = cursors.get(phase) ?? 0;
        cursors.set(phase, cursor + 1);
        assert.ok(cursor < 5, 'Bound each scripted tool loop');
        const active = phase === 'ADD_RULE' ? cursor >= 2
          : phase === 'REMOVE_RULE' ? cursor === 0
          : ['DUPLICATE_RULE', 'INVALID_RULE', 'VERIFY_RELOAD', 'VERIFY_COMPACTION', 'VERIFY_RESUME', 'VERIFY_SWITCH'].includes(phase);
        assert.equal(system.includes(JSON.stringify(RULE_TEXT)), active, `Active rule at ${phase} request ${cursor}`);
        assert.equal((system.match(/Current-session correction rules \(not global policy/g) ?? []).length, active ? 1 : 0,
          'Only one active rule section, without accumulation');
        const plans = {
          ADD_RULE: [{ action: 'list' }, { action: 'add', text: RULE_TEXT }, { action: 'list' }],
          DUPLICATE_RULE: [{ action: 'add', text: RULE_TEXT }],
          INVALID_RULE: [{ action: 'add', text: 'x'.repeat(161) }],
          REMOVE_RULE: [{ action: 'remove', id: ruleId }, { action: 'list' }],
        };
        const plan = plans[phase] ?? [{ action: 'list' }];
        if (cursor > 0) {
          const last = body.messages.at(-1);
          assert.equal(last.role, 'tool', 'Native agent must execute the preceding tool call');
          if (phase === 'DUPLICATE_RULE') assert.match(last.content, /duplicate/);
          else if (phase === 'INVALID_RULE') assert.match(last.content, /160/);
          else {
            const result = JSON.parse(last.content);
            const previous = plan[cursor - 1];
            if (previous.action === 'add') {
              assert.equal(result.added.text, RULE_TEXT);
              assert.match(result.added.id, /^[a-f0-9-]{36}$/);
              ruleId = result.added.id;
            } else if (previous.action === 'remove') assert.equal(result.removed, ruleId);
            else {
              assert.equal(result.total, active ? 1 : 0, `List reflects ${phase}`);
              assert.deepEqual(result.rules, active ? [{ id: ruleId, text: RULE_TEXT }] : []);
            }
          }
        }
        if (cursor < plan.length) call = { name: 'session_rules', arguments: JSON.stringify(plan[cursor]) };
        content = `Completed ${phase}.`;
      } else {
        assert.equal(tools.length, 0, 'Only native compaction requests omit tools');
        assert.match(JSON.stringify(body.messages), /summar|conversation/i);
      }
      outgoing.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: `fixture-call-${++toolCallCount}`, type: 'function', function: call }] }
        : { role: 'assistant', content };
      outgoing.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
      outgoing.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }) + '\n\n');
      outgoing.end('data: [DONE]\n\n');
    } catch (error) {
      serverErrors.push(error);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: { message: 'Isolated fixture assertion failed' } }));
    }
  });
  server.requestTimeout = OPERATION_TIMEOUT_MS;
  server.headersTimeout = OPERATION_TIMEOUT_MS;
  server.maxConnections = 4;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const agentDir = join(directory, 'agent');
    const project = join(directory, 'project');
    await Promise.all([mkdir(join(agentDir, 'extensions/session-rules'), { recursive: true }), mkdir(project), mkdir(join(directory, 'home'))]);
    await copyFile(new URL('./index.ts', import.meta.url), join(agentDir, 'extensions/session-rules/index.ts'));
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ packages: [], retry: { enabled: false },
      compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1 } }));
    await writeFile(join(agentDir, 'SYSTEM.md'), 'GLOBAL_FIXTURE_INSTRUCTIONS: preserve normal instructions.');
    await writeFile(join(agentDir, 'APPEND_SYSTEM.md'), 'APPENDED_FIXTURE_INSTRUCTIONS: preserve appended instructions.');
    await writeFile(join(project, 'AGENTS.md'), 'PROJECT_FIXTURE_INSTRUCTIONS: preserve project instructions.');
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'session-rules-fixture': {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'public-local-fixture',
      models: [{ id: 'fixture', name: 'Isolated scripted provider', reasoning: false, input: ['text'], contextWindow: 32000,
        maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }));
    await writeFile(join(agentDir, 'extensions/lifecycle.ts'), `
import {appendFileSync} from 'node:fs';
export default function(pi) {
  pi.on('session_start', (event,ctx) => appendFileSync(${JSON.stringify(join(directory, 'lifecycle.jsonl'))}, JSON.stringify({reason:event.reason,id:ctx.sessionManager.getSessionId()})+'\\n'));
  pi.registerCommand('fixture-reload', {description:'Reload this isolated fixture only', handler:async(_args,ctx)=>{await ctx.reload();}});
}
`);
    client = startClient(directory);
    const initial = await client.request('get_state');
    await client.prompt('ADD_RULE');
    assert.deepEqual(serverErrors, []);
    assert.ok(ruleId, JSON.stringify(client.events.filter(event => ['message_end', 'extension_error'].includes(event.type))));
    await client.prompt('DUPLICATE_RULE');
    await client.prompt('INVALID_RULE');
    assert.deepEqual(serverErrors, []);
    const state = await client.request('get_state');
    assert.equal(state.sessionId, initial.sessionId);
    assert.ok(state.sessionFile.startsWith(directory + '/'));
    assert.equal((await client.request('prompt', { message: '/fixture-reload' })).disposition, 'handled');
    await client.prompt('VERIFY_RELOAD');
    const lifecycle = (await readFile(join(directory, 'lifecycle.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(lifecycle.some(event => event.reason === 'reload' && event.id === state.sessionId), 'Native reload must replace/restart extension runtime');
    const compacted = await client.request('compact', { customInstructions: 'Summarize this isolated lifecycle fixture.' });
    assert.match(compacted.summary, /SCRIPTED_NATIVE_COMPACTION_SUMMARY/);
    await client.prompt('VERIFY_COMPACTION');
    let entries = (await readFile(state.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(entries.some(entry => entry.type === 'compaction' && entry.summary.includes('SCRIPTED_NATIVE_COMPACTION_SUMMARY')));
    assert.equal(entries.filter(entry => entry.type === 'custom' && entry.customType === 'session-rules-v1').length, 1,
      'Invalid and duplicate tool calls must not append state');
    await client.stop();
    client = startClient(directory, state.sessionFile);
    assert.equal((await client.request('get_state')).sessionId, state.sessionId);
    await client.prompt('VERIFY_RESUME');
    await client.request('clone');
    assert.notEqual((await client.request('get_state')).sessionId, state.sessionId);
    await client.prompt('VERIFY_FORK');
    await client.request('switch_session', { sessionPath: state.sessionFile });
    await client.prompt('VERIFY_SWITCH');
    await client.prompt('REMOVE_RULE');
    assert.equal((await client.request('prompt', { message: '/fixture-reload' })).disposition, 'handled');
    await client.prompt('VERIFY_REMOVED_RELOAD');
    await client.request('new_session');
    assert.notEqual((await client.request('get_state')).sessionId, state.sessionId);
    await client.prompt('VERIFY_NEW');
    await client.stop();
    client = startClient(directory, state.sessionFile);
    await client.request('get_state');
    await client.prompt('VERIFY_REMOVED_RESUME');
    assert.deepEqual(serverErrors, []);
    assert.ok(requests.some(body => !body.tools?.length), 'Native compactor must call the local scripted provider');
    entries = (await readFile(state.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(entries.filter(entry => entry.type === 'custom' && entry.customType === 'session-rules-v1').length, 2);
    assert.equal(entries.filter(entry => entry.type === 'custom' && entry.customType === 'session-rules-v1').at(-1).data.action, 'remove');
    for (const [path, expected] of [[join(agentDir, 'SYSTEM.md'), 'GLOBAL_FIXTURE_INSTRUCTIONS: preserve normal instructions.'],
      [join(agentDir, 'APPEND_SYSTEM.md'), 'APPENDED_FIXTURE_INSTRUCTIONS: preserve appended instructions.'],
      [join(project, 'AGENTS.md'), 'PROJECT_FIXTURE_INSTRUCTIONS: preserve project instructions.']]) {
      assert.equal(await readFile(path, 'utf8'), expected, 'Instruction files must remain byte-identical');
    }
    console.log(`PASS isolated Pi CLI: ${requests.length} loopback provider requests, native tool execution/reload/compaction/restart/fork/removal/new-session isolation; no real model service.`);
  } finally {
    try {
      await client?.stop();
    } finally {
      try {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
      } finally {
        await rm(directory, { recursive: true, force: true });
        await assert.rejects(access(directory), { code: 'ENOENT' });
      }
    }
  }
});
