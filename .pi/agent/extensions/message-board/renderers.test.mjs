import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homedir, tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = process.env.PI_PACKAGE_ROOT ?? join(homedir(), '.local/lib/node_modules/@earendil-works/pi-coding-agent');
const tuiPath = join(packageRoot, 'node_modules/@earendil-works/pi-tui/dist/index.js');
const { createJiti } = await import(pathToFileURL(join(packageRoot, 'node_modules/jiti/lib/jiti.mjs')).href);
const jiti = createJiti(import.meta.url, { alias: {
  '@earendil-works/pi-tui': tuiPath,
  '@earendil-works/pi-coding-agent': join(packageRoot, 'dist/index.js'),
  typebox: join(packageRoot, 'node_modules/typebox/build/index.mjs'),
} });
const extension = (await jiti.import(new URL('./index.ts', import.meta.url).pathname)).default;
const { ToolExecutionComponent } = await import(pathToFileURL(join(packageRoot, 'dist/modes/interactive/components/tool-execution.js')).href);
const { stripTerminalSequences, visibleWidth } = await import(pathToFileURL(tuiPath).href);
const theme = await import(pathToFileURL(join(packageRoot, 'dist/modes/interactive/theme/theme.js')).href);
theme.initTheme('dark');

async function definitions() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-renderer-registration-'));
  const previous = process.env.PI_MESSAGE_BOARD_WORKER;
  const tools = new Map();
  const api = { registerTool: definition => tools.set(definition.name, definition), on() {}, registerCommand() {} };
  try {
    delete process.env.PI_MESSAGE_BOARD_WORKER;
    extension(api);
    const worker = join(directory, 'worker.json');
    await writeFile(worker, JSON.stringify({ url: 'http://127.0.0.1:1', token: 'fixture-only' }));
    process.env.PI_MESSAGE_BOARD_WORKER = worker;
    extension(api);
    return tools;
  } finally {
    if (previous === undefined) delete process.env.PI_MESSAGE_BOARD_WORKER;
    else process.env.PI_MESSAGE_BOARD_WORKER = previous;
    await rm(directory, { recursive: true, force: true });
  }
}
function row(definition, args, details, content = JSON.stringify(details), isError = false) {
  const component = new ToolExecutionComponent(definition.name, 'fixture-call', args, {}, definition, { requestRender() {} }, '/fixture');
  component.setArgsComplete();
  component.markExecutionStarted();
  component.updateResult({ content: [{ type: 'text', text: content }], details, isError });
  return component;
}
function lines(component, width = 100) { return component.render(width).map(stripTerminalSequences).filter(line => line.trim()); }

const jobId = '3d711173-9c88-41d1-af04-4366b7688937';
const args = { action: 'status', jobId, task: 'PRIVATE_TASK_SENTINEL', scope: ['/private/source'], answer: 'PRIVATE_ANSWER_SENTINEL' };
const status = { jobs: Array.from({ length: 32 }, (_, index) => ({ id: `job-${index}`, state: 'cancelled', stage: 'result_reported', taskPreview: 'PRIVATE_TASK_SENTINEL', cwdPreview: '/private/source' })), pending: 0, unresolved: [], deliveryMode: 'paused' };

test('registered subagent status stays two content lines; native expansion preserves complete arguments and results', async () => {
  const tool = (await definitions()).get('subagent');
  const component = row(tool, args, status);
  const collapsed = lines(component);
  assert.equal(collapsed.length, 2, 'Collapsed status must not dump argument/result JSON');
  assert.match(collapsed[0], /subagent.*status/);
  assert.match(collapsed[1], /32 jobs.*0 working.*32 cancelled.*0 reports pending/);
  assert.ok(!collapsed.join('\n').includes('PRIVATE_TASK_SENTINEL'));
  assert.ok(!collapsed.join('\n').includes(jobId));
  component.setExpanded(true);
  const expanded = lines(component).join('\n');
  for (const value of ['PRIVATE_TASK_SENTINEL', 'PRIVATE_ANSWER_SENTINEL', jobId, '/private/source', 'job-31']) assert.ok(expanded.includes(value));
  component.setExpanded(false);
  assert.deepEqual(lines(component), collapsed);
  for (let width = 20; width <= 120; width++) assert.ok(lines(component, width).every(line => visibleWidth(line) <= width));
});

test('both roles register compact renderers; each action reflects acceptance rather than claiming completion', async () => {
  const tools = await definitions();
  const parent = tools.get('subagent');
  for (const [action, details, expected] of [
    ['init', { initialized: true }, /initialized.*paused/],
    ['delegate', { accepted: true, jobId, revision: 1 }, /accepted/],
    ['delegate', { accepted: true, duplicate: true, jobId, revision: 1 }, /existing task/],
    ['instruct', { accepted: true, jobId, revision: 2 }, /accepted/],
    ['respond', { accepted: true, eventId: 'event' }, /accepted/],
    ['respond', { alreadyAnswered: 'event' }, /already answered/i],
    ['ack', { acknowledged: ['event-one', 'event-two'] }, /Acknowledged 2 reports/],
    ['cancel', { cancellationRequested: jobId }, /Cancellation requested/],
    ['retry', { retryEnabled: true }, /retry enabled/i],
    ['reconnect', { reconnected: true }, /reconnected/],
    ['stop', { stopping: true }, /stop requested/],
  ]) {
    const component = row(parent, { action, task: 'PRIVATE_TASK_SENTINEL' }, details);
    assert.equal(lines(component).length, 2);
    assert.match(lines(component)[1], expected);
  }
  for (const kind of ['progress', 'needs_decision', 'result', 'failed']) {
    const parameters = { kind, summary: 'PRIVATE_REPORT_SENTINEL', details: 'PRIVATE_DETAILS_SENTINEL', artifacts: ['/private/artifact'] };
    const response = { id: 'stored-event', delivery: 'durably_queued', duplicate: false };
    const component = row(tools.get('board_post'), parameters, response);
    const collapsed = lines(component);
    assert.equal(collapsed.length, 2);
    assert.match(collapsed[0], new RegExp(`board_post.*${kind}`));
    assert.match(collapsed[1], /Report queued/);
    assert.ok(!collapsed.join('\n').includes('PRIVATE_REPORT_SENTINEL'));
    component.setExpanded(true);
    for (const value of ['PRIVATE_REPORT_SENTINEL', 'PRIVATE_DETAILS_SENTINEL', '/private/artifact', 'stored-event']) assert.ok(lines(component).join('\n').includes(value));
  }
});

test('errors stay visible, malformed/old results stay compact, and rendering never mutates model-visible payloads', async () => {
  const tools = await definitions();
  for (const tool of tools.values()) {
    const parameters = { action: 'status', kind: 'progress' };
    const details = { unexpected: 'PRIVATE_RESULT_SENTINEL' };
    const original = JSON.stringify({ parameters, details });
    const component = row(tool, parameters, details);
    assert.equal(lines(component).length, 2);
    assert.ok(!lines(component).join('\n').includes('PRIVATE_RESULT_SENTINEL'));
    const error = row(tool, parameters, undefined, 'Connection failed\nInspect the existing receipt before retrying', true);
    assert.match(lines(error).join('\n'), /Connection failed/);
    assert.equal(lines(error).length, 2);
    error.setExpanded(true);
    assert.match(lines(error).join('\n'), /Inspect the existing receipt before retrying/);
    assert.equal(JSON.stringify({ parameters, details }), original);
  }
});

test('streaming, duplicate posts, invalid arguments and nonserializable expanded arguments degrade safely', async () => {
  const tools = await definitions();
  const parent = tools.get('subagent');
  const component = new ToolExecutionComponent('subagent', 'partial-call', {}, {}, parent, { requestRender() {} }, '/fixture');
  component.updateResult({ content: [], details: undefined }, true);
  assert.match(lines(component).join('\n'), /Working…/);
  component.updateArgs({ action: 'status\nINJECTED_TITLE' });
  assert.ok(!lines(component).join('\n').includes('INJECTED_TITLE'));
  const cyclic = { action: 'status' };
  cyclic.self = cyclic;
  component.updateArgs(cyclic);
  component.setExpanded(true);
  assert.match(lines(component).join('\n'), /not serializable/);
  const duplicate = row(tools.get('board_post'), { kind: 'result' }, { delivery: 'durably_queued', id: 'same-event', duplicate: true });
  assert.match(lines(duplicate).join('\n'), /already stored/);
  const invalid = row(parent, null, { jobs: null });
  assert.equal(lines(invalid).length, 2);
  const error = row(parent, {}, undefined, '\x1b[31mConnection failed\x1b[0m\x00', true);
  error.setExpanded(true);
  assert.match(lines(error).join('\n'), /Connection failed/);
  assert.ok(!lines(error).join('\n').includes('\x00'));
});
