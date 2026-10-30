import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const packageRoot = process.env.PI_PACKAGE_ROOT ?? join(homedir(), '.local/lib/node_modules/@earendil-works/pi-coding-agent');
const tuiPath = join(packageRoot, 'node_modules/@earendil-works/pi-tui/dist/index.js');
const { createJiti } = await import(pathToFileURL(join(packageRoot, 'node_modules/jiti/lib/jiti.mjs')).href);
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-tui': tuiPath } });
const { AgentDashboard, AgentPanel, AgentRoster } = await jiti.import(new URL('./panel.ts', import.meta.url).pathname);
const { Container, TuiMainScreen, TuiAltScreen, stripTerminalSequences, visibleWidth } = await import(pathToFileURL(tuiPath).href);
const themeModule = await import(pathToFileURL(join(packageRoot, 'dist/modes/interactive/theme/theme.js')).href);
const { InteractiveMode } = await import(pathToFileURL(join(packageRoot, 'dist/modes/interactive/interactive-mode.js')).href);
themeModule.initTheme('dark');
const view = { attached: true, connected: true, deliveryEnabled: false, stalled: false, pending: 1, agents: [{ ordinal: 1, state: 'working' }, { ordinal: 3, state: 'blocked' }] };

async function waitFor(check) {
  const attemptsMax = 100;
  const delayMs = 20;
  for (let index = 0; index < attemptsMax; index++) {
    if (check()) return;
    await delay(delayMs);
  }
  assert.fail('Native TUI condition timed out');
}
function terminalFixture(TuiConstructor = TuiMainScreen) {
  const terminal = {
    columns: 100, rows: 30, kittyProtocolActive: false, writes: [],
    start(input) { this.input = input; }, stop() {},
    write(data) { this.writes.push(data); if (this.writes.length > 1000) assert.fail('Unexpected render loop'); },
    drainInput: async () => {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  const tui = new TuiConstructor(terminal);
  const keys = [];
  const editor = { focused: false, render: () => ['Editor input remains here'], invalidate() {}, handleInput(input) { keys.push(input); } };
  const above = new Container();
  const below = new Container();
  tui.addChild(above);
  tui.addChild(editor);
  tui.addChild(below);
  tui.addChild({ render: () => ['Native tokens/context/cost footer', 'My PA connected'], invalidate() {} });
  tui.setFocus(editor);
  tui.start();
  return { terminal, tui, keys, above, below };
}
function contextFixture(fixture) {
  const notices = [];
  const host = { ui: fixture.tui,
    editor: { getText: () => 'unsent input', setText() { assert.fail('Roster must not replace the editor'); } },
    extensionWidgetsAbove: new Map(), extensionWidgetsBelow: new Map(),
    widgetContainerAbove: fixture.above, widgetContainerBelow: fixture.below,
    renderWidgets: InteractiveMode.prototype.renderWidgets,
    renderWidgetContainer: InteractiveMode.prototype.renderWidgetContainer,
  };
  const ctx = { hasUI: true, ui: {
    custom: InteractiveMode.prototype.showExtensionCustom.bind(host),
    setWidget: InteractiveMode.prototype.setExtensionWidget.bind(host),
    notify: (...args) => notices.push(args),
  } };
  return { ctx, host, notices };
}
const plain = (component, width = 100) => component.render(width).map(stripTerminalSequences);
const saturated = { ...view, agents: Array.from({ length: 32 }, (_, index) => ({ ordinal: index + 1, state: index < 28 ? 'ready' : index < 30 ? 'working' : 'blocked' })) };

for (const TuiConstructor of [TuiMainScreen, TuiAltScreen]) test(`actual Pi ${TuiConstructor.name} widget bridge docks one row; roster is explicit, bounded and preserves editor/dialog focus`, { timeout: 10000 }, async () => {
  const fixture = terminalFixture(TuiConstructor);
  const { terminal, tui, keys, above } = fixture;
  const { ctx, notices } = contextFixture(fixture);
  const dashboard = new AgentDashboard();
  const showOverlay = tui.showOverlay.bind(tui);
  let handle;
  tui.showOverlay = (component, options) => { handle = showOverlay(component, options); return handle; };
  let dialog;
  let opened;
  try {
    dashboard.update(ctx, saturated);
    tui.renderNow(true);
    assert.equal(tui.hasOverlay(), false, 'The default rail must never float over chat');
    assert.equal(plain(above).filter(line => line.includes('agents /')).length, 1);
    assert.match(plain(above).join('\n'), /paused/);
    terminal.input('x');
    assert.deepEqual(keys, ['x']);
    assert.match(plain(tui).join('\n'), /Native tokens\/context\/cost footer\nMy PA connected/);
    opened = dashboard.showRoster();
    await waitFor(() => tui.hasOverlay());
    tui.renderNow(true);
    assert.equal(handle.isFocused(), true, 'Only an explicitly opened roster takes keyboard focus');
    assert.ok(terminal.writes.some(write => stripTerminalSequences(write).includes('agent31')), 'The native compositor must actually paint the attention-first roster');
    terminal.input('\x1b[F');
    tui.renderNow(true);
    assert.ok(terminal.writes.some(write => stripTerminalSequences(write).includes('agent28')), 'The native compositor must paint the final agent after scrolling');
    dashboard.update(ctx, { ...saturated, deliveryEnabled: true });
    assert.match(plain(above).join('\n'), /live/);
    terminal.columns = 38;
    terminal.rows = 8;
    tui.renderNow(true);
    assert.ok(plain(above, 38).every(line => visibleWidth(line) <= 38));
    terminal.input('\x1b');
    await opened;
    assert.equal(tui.hasOverlay(), false);
    terminal.input('y');
    assert.deepEqual(keys, ['x', 'y'], 'Closing details restores normal input');
    terminal.columns = 100;
    terminal.rows = 30;
    opened = dashboard.showRoster();
    await waitFor(() => tui.hasOverlay());
    const answers = [];
    dialog = showOverlay({ focused: false, render: () => ['Native confirmation'], invalidate() {}, handleInput(input) { answers.push(input); } }, { width: 25 });
    dashboard.dispose();
    await opened;
    terminal.input('z');
    assert.deepEqual(answers, ['z'], 'Disposing this dashboard must not close/unfocus another dialog');
    assert.equal(plain(above).filter(line => line.includes('agents /')).length, 0);
    assert.deepEqual(notices, []);
  } finally { dashboard.dispose(); dialog?.hide(); tui.stop(); }
});

test('summary retains off/paused/live/offline, warns on stalls, and never exceeds one bounded row', () => {
  const { tui } = terminalFixture();
  const panel = new AgentPanel(tui, themeModule.theme, view);
  try {
    for (const [patch, expected] of [
      [{ attached: false }, /off/], [{ agents: [], pending: 0 }, /paused.*idle/],
      [{ deliveryEnabled: true }, /live/], [{ connected: false }, /offline/],
      [{ stalled: true }, /paused ! stalled/], [{ agents: undefined, pending: 10000 }, /10000 reports/],
      [{ agents: undefined, pending: 0 }, /activity unknown/],
      [{ agents: [{ ordinal: 1, state: 'error' }] }, /× 1/],
      [{ agents: [{ ordinal: 1, state: 'interrupted' }] }, /\? 1/],
      [{ agents: [{ ordinal: 1, state: 'stopped' }] }, /− 1/],
    ]) { panel.update({ ...view, ...patch }); assert.match(plain(panel)[0], expected); }
    panel.update(saturated);
    for (let width = 1; width <= 120; width++) {
      const lines = panel.render(width);
      assert.equal(lines.length, 1);
      assert.ok(visibleWidth(lines[0]) <= width, `Summary overflowed width ${width}`);
    }
    panel.update({ ...view, connected: false });
    assert.ok(!plain(panel)[0].includes('! 1'), 'Disconnected counts must not masquerade as fresh worker state');
  } finally { panel.dispose(); tui.stop(); }
});

test('native loader stops when blocked, offline or disposed; disposal leaves no render timer', { timeout: 10000 }, async () => {
  const { tui } = terminalFixture();
  let requests = 0;
  const requestRender = tui.requestRender.bind(tui);
  tui.requestRender = () => { requests++; requestRender(); };
  const panel = new AgentPanel(tui, themeModule.theme, view);
  const rendered = () => plain(panel).join('\n');
  try {
    let initial = rendered();
    await waitFor(() => rendered() !== initial);
    for (const patch of [{ agents: [{ ordinal: 1, state: 'blocked' }] }, { connected: false }]) {
      panel.update({ ...view, ...patch });
      initial = rendered();
      await delay(180);
      assert.equal(rendered(), initial);
    }
    panel.update(view);
    panel.dispose();
    assert.deepEqual(panel.render(100), []);
    const disposedRequests = requests;
    await delay(180);
    assert.equal(requests, disposedRequests, 'A disposed native loader must not keep scheduling UI work');
  } finally { panel.dispose(); tui.stop(); }
});

test('roster shows six stable agent identities, prioritizes attention, scrolls all 32 rows and clamps after updates/resizes', () => {
  const { terminal, tui } = terminalFixture();
  let closed = 0;
  const roster = new AgentRoster(tui, themeModule.theme, saturated, () => closed++);
  try {
    let lines = plain(roster, 64);
    assert.equal(lines.length, 10);
    assert.match(lines[2], /! agent31/);
    assert.match(lines[3], /! agent32/);
    assert.match(lines[4], /agent29.*working/);
    assert.match(lines[7], /agent2.*result waiting/);
    assert.match(lines[8], /1–6\/32/);
    roster.handleInput('\x1b[F');
    lines = plain(roster, 64);
    assert.match(lines[7], /agent28/);
    assert.match(lines[8], /27–32\/32/);
    roster.handleInput('\x1b[H');
    roster.handleInput('\x1b[6~');
    assert.match(plain(roster, 64)[8], /7–12\/32/);
    roster.handleInput('\x1b[5~');
    roster.handleInput('\x1b[B');
    assert.match(plain(roster, 64)[8], /2–7\/32/);
    roster.handleInput('\x1b[A');
    assert.match(plain(roster, 64)[8], /1–6\/32/);
    roster.handleInput('\x1b[F');
    roster.update({ ...view, agents: [{ ordinal: 3, state: 'error' }] });
    assert.match(plain(roster, 64)[2], /× agent3.*failed/);
    assert.match(plain(roster, 64)[3], /1–1\/1/);
    roster.update(saturated);
    for (let rows = 1; rows <= 30; rows++) {
      terminal.rows = rows;
      for (let width = 1; width <= 80; width++) {
        lines = roster.render(width);
        assert.ok(lines.length <= Math.min(10, rows));
        assert.ok(lines.every(line => visibleWidth(line) <= width));
      }
    }
    roster.handleInput('\x1b');
    assert.equal(closed, 1);
  } finally { roster.dispose(); tui.stop(); }
});

test('dashboard handles absent UI, a delayed factory after disposal, rejected details, and duplicate opens without leaking widgets', async () => {
  const fixture = terminalFixture();
  const { ctx } = contextFixture(fixture);
  const dashboard = new AgentDashboard();
  try {
    dashboard.update({ hasUI: false }, view);
    assert.equal(fixture.tui.hasOverlay(), false);
    dashboard.update(ctx, view);
    let factory;
    const delayed = { ...ctx, ui: { ...ctx.ui, custom: callback => new Promise(resolve => { factory = () => callback(fixture.tui, themeModule.theme, {}, resolve); }) } };
    dashboard.update(delayed, view);
    const pending = dashboard.showRoster();
    assert.ok(factory);
    await dashboard.showRoster();
    dashboard.dispose();
    assert.deepEqual(factory().render(100), []);
    await pending;
    let notices = 0;
    const unavailable = { ...ctx, ui: { ...ctx.ui, custom: async () => { throw new Error('Private native UI failure'); }, notify: () => notices++ } };
    dashboard.update(unavailable, view);
    await dashboard.showRoster();
    assert.equal(notices, 1);
  } finally { dashboard.dispose(); fixture.tui.stop(); }
});
test('saturated board uses one summary row and retains the paused indicator while idle', () => {
  const { tui } = terminalFixture();
  const panel = new AgentPanel(tui, themeModule.theme, { ...view, deliveryEnabled: false,
    agents: Array.from({ length: 32 }, (_, index) => ({ ordinal: index + 1, state: index < 2 ? 'working' : index < 4 ? 'blocked' : 'ready' })) });
  try {
    const lines = panel.render(100).map(stripTerminalSequences);
    assert.equal(lines.length, 1, 'Agent count must never increase summary height');
    assert.match(lines[0], /agents\s*\/\s*paused/);
    assert.match(lines[0], /! 2/);
    assert.match(lines[0], /✓ 28/);
    assert.ok(!lines[0].includes('agent1'));
    panel.update({ ...view, deliveryEnabled: false, pending: 0, agents: [] });
    assert.match(stripTerminalSequences(panel.render(100)[0]), /paused.*idle/);
  } finally { panel.dispose(); tui.stop(); }
});

test('a failed widget mount disposes its loader and warns once instead of retrying on every state push', async () => {
  const { tui } = terminalFixture();
  const dashboard = new AgentDashboard();
  const notices = [];
  let mounts = 0;
  let component;
  const ctx = { hasUI: true, ui: {
    setWidget(_key, factory) {
      if (!factory) return;
      mounts++;
      component = factory(tui, themeModule.theme);
      throw new Error('PRIVATE_UI_ERROR');
    },
    notify: message => notices.push(message),
  } };
  try {
    dashboard.update(ctx, view);
    dashboard.update(ctx, saturated);
    assert.equal(mounts, 1);
    assert.deepEqual(component.render(100), []);
    assert.equal(notices.length, 1);
    assert.ok(!notices[0].includes('PRIVATE_UI_ERROR'));
  } finally { dashboard.dispose(); tui.stop(); }
});

test('native transcript renderer hides board-update blocks but preserves visible custom messages and older entries', () => {
  const chat = new Container();
  const host = { chatContainer: chat, session: { extensionRunner: { getMessageRenderer: () => undefined } },
    getMarkdownThemeWithSettings: themeModule.getMarkdownTheme, outputPad: 1, toolOutputExpanded: false };
  const message = { role: 'custom', customType: 'board-updates', content: 'INTERNAL_BOARD_PAYLOAD', display: false, timestamp: Date.now() };
  InteractiveMode.prototype.addMessageToChat.call(host, message);
  assert.equal(chat.children.length, 0, 'Hidden reports must not create even an empty transcript block');
  InteractiveMode.prototype.addMessageToChat.call(host, { ...message, customType: 'other-extension', content: 'OTHER_EXTENSION_VISIBLE', display: true });
  assert.match(plain(chat).join('\n'), /OTHER_EXTENSION_VISIBLE/);
  assert.ok(!plain(chat).join('\n').includes('INTERNAL_BOARD_PAYLOAD'));
  InteractiveMode.prototype.addMessageToChat.call(host, { ...message, display: true });
  assert.match(plain(chat).join('\n'), /INTERNAL_BOARD_PAYLOAD/, 'Previously visible saved entries are not retroactively rewritten');
});
