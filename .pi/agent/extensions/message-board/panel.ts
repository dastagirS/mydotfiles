import { Key, Loader, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from '@earendil-works/pi-tui';
import type { ExtensionContext, Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { LIMITS } from './protocol.mjs';

const ROSTER_ROWS_MAX = 6;
const ROSTER_CHROME_ROWS = 4;
const ROSTER_WIDTH = 64;
const ROSTER_WIDTH_MIN = 24;
const WIDGET_KEY = 'message-board';

type AgentIndicator = { ordinal: number; state: string };
export type AgentView = {
  attached: boolean;
  connected: boolean;
  deliveryEnabled: boolean;
  stalled: boolean;
  pending: number | undefined;
  agents: AgentIndicator[] | undefined;
};
const STATES: Record<string, { icon: string; label: string; color: ThemeColor; priority: number }> = {
  error: { icon: '×', label: 'failed', color: 'error', priority: 0 },
  interrupted: { icon: '?', label: 'control interrupted', color: 'warning', priority: 1 },
  blocked: { icon: '!', label: 'needs a decision', color: 'warning', priority: 2 },
  working: { icon: '⠋', label: 'working', color: 'accent', priority: 3 },
  ready: { icon: '✓', label: 'result waiting', color: 'success', priority: 4 },
  stopped: { icon: '−', label: 'stopped; reports retained', color: 'muted', priority: 5 },
  idle: { icon: '·', label: 'idle; reports retained', color: 'muted', priority: 6 },
};

export class AgentPanel implements Component {
  private loader: Loader | undefined;
  protected frame = '⠋';
  protected disposed = false;

  constructor(protected tui: TUI, protected theme: Theme, protected view: AgentView) {
    this.update(view);
  }
  update(view: AgentView): void {
    if (this.disposed) return;
    this.view = view;
    const spinning = view.attached && view.connected && view.agents?.slice(0, LIMITS.jobs).some(agent => agent.state === 'working');
    if (spinning && !this.loader) this.loader = new Loader(this.tui, frame => { this.frame = frame; return frame; }, text => text, '');
    if (!spinning && this.loader) { this.loader.stop(); this.loader = undefined; }
    this.tui.requestRender();
  }
  protected mode(): string {
    if (!this.view.attached) return this.theme.fg('muted', 'off');
    const delivery = this.view.deliveryEnabled ? this.theme.fg('success', 'live') : this.theme.fg('warning', 'paused');
    return this.view.connected ? delivery : delivery + this.theme.fg('error', ' · offline');
  }
  render(width: number): string[] {
    if (this.disposed || width <= 0) return [];
    let header = this.theme.fg('muted', 'agents / ') + this.mode();
    if (this.view.attached && this.view.stalled) header += this.theme.fg('warning', ' ! stalled');
    const counts = new Map<string, number>();
    for (const agent of (this.view.agents ?? []).slice(0, LIMITS.jobs)) counts.set(agent.state, (counts.get(agent.state) ?? 0) + 1);
    const metrics: string[] = [];
    if (this.view.attached && this.view.connected) {
      for (const state of ['error', 'interrupted', 'blocked', 'working', 'ready', 'stopped', 'idle']) {
        const count = counts.get(state);
        if (count) metrics.push(this.theme.fg(STATES[state].color, `${state === 'working' ? this.frame : STATES[state].icon} ${count}`));
      }
    }
    if (!metrics.length && this.view.attached) {
      let label = 'idle';
      if (!this.view.connected || this.view.agents === undefined) label = 'activity unknown';
      if (this.view.pending) label = `${this.view.pending} reports`;
      metrics.push(this.theme.fg('muted', label));
    }
    let right = metrics.join('  ');
    const available = Math.max(0, width - visibleWidth(header) - 2);
    if (visibleWidth(right) > available) {
      // Never silently drop a later error/count on narrow terminals.
      right = truncateToWidth(right, available);
    }
    header = truncateToWidth(header, width);
    return [header + ' '.repeat(Math.max(0, width - visibleWidth(header) - visibleWidth(right))) + right];
  }
  invalidate(): void {}
  dispose(): void {
    this.disposed = true;
    this.loader?.stop();
    this.loader = undefined;
  }
}

export class AgentRoster extends AgentPanel {
  private offset = 0;
  constructor(tui: TUI, theme: Theme, view: AgentView, private close: () => void) { super(tui, theme, view); }
  private rowsVisible(): number { return Math.max(1, Math.min(ROSTER_ROWS_MAX, this.tui.terminal.rows - ROSTER_CHROME_ROWS)); }
  handleInput(input: string): void {
    if (matchesKey(input, Key.escape) || input === 'q') { this.close(); return; }
    const count = Math.min(LIMITS.jobs, this.view.agents?.length ?? 0);
    const last = Math.max(0, count - this.rowsVisible());
    if (matchesKey(input, Key.down)) this.offset = Math.min(last, this.offset + 1);
    else if (matchesKey(input, Key.up)) this.offset = Math.max(0, this.offset - 1);
    else if (matchesKey(input, Key.pageDown)) this.offset = Math.min(last, this.offset + this.rowsVisible());
    else if (matchesKey(input, Key.pageUp)) this.offset = Math.max(0, this.offset - this.rowsVisible());
    else if (matchesKey(input, Key.home)) this.offset = 0;
    else if (matchesKey(input, Key.end)) this.offset = last;
    this.tui.requestRender();
  }
  render(width: number): string[] {
    if (this.disposed || width <= 0) return [];
    if (width < ROSTER_WIDTH_MIN || this.tui.terminal.rows <= ROSTER_CHROME_ROWS) return super.render(width);
    const inside = width - 2;
    const row = (text: string) => this.theme.fg('borderMuted', '│') + truncateToWidth(text, inside, '…', true) + this.theme.fg('borderMuted', '│');
    const border = (left: string, right: string) => this.theme.fg('borderMuted', left + '─'.repeat(inside) + right);
    const agents = (this.view.agents ?? []).slice(0, LIMITS.jobs).sort((source, target) => STATES[source.state].priority - STATES[target.state].priority || source.ordinal - target.ordinal);
    this.offset = Math.min(this.offset, Math.max(0, agents.length - this.rowsVisible()));
    const countLabel = this.view.agents === undefined ? '' : ` ${agents.length}`;
    const lines = [border('┌', '┐'), row(` Agents${countLabel} / ${this.mode()}${!this.view.connected && agents.length ? ' · last known' : ''}`)];
    if (!agents.length) {
      const label = this.view.agents === undefined && this.view.attached
        ? ` ${this.view.pending ?? '?'} reports; agent metadata unavailable` : ' No agents to display';
      lines.push(row(label));
    }
    for (const agent of agents.slice(this.offset, this.offset + this.rowsVisible())) {
      const state = STATES[agent.state];
      const icon = agent.state === 'working' && this.view.connected ? this.frame : state.icon;
      const name = ` ${this.theme.fg(state.color, icon)} agent${agent.ordinal}`;
      const label = this.theme.fg(this.view.connected ? state.color : 'muted', state.label);
      const gap = Math.max(1, inside - visibleWidth(name) - visibleWidth(label) - 1);
      lines.push(row(name + ' '.repeat(gap) + label + ' '));
    }
    const end = Math.min(agents.length, this.offset + this.rowsVisible());
    lines.push(row(` ${agents.length ? `${this.offset + 1}–${end}/${agents.length}` : '0/0'} · ↑↓ scroll · Esc close`), border('└', '┘'));
    return lines;
  }
}

export class AgentDashboard {
  private context: ExtensionContext | undefined;
  private view: AgentView | undefined;
  private panel: AgentPanel | undefined;
  private roster: AgentRoster | undefined;
  private finish: (() => void) | undefined;
  private opening = false;
  private mountAttempted = false;
  private generation = 0;

  update(ctx: ExtensionContext, view: AgentView): void {
    if (!ctx.hasUI) { this.dispose(); return; }
    if (this.context && this.context.ui !== ctx.ui) this.dispose();
    this.context = ctx;
    this.view = view;
    if (!this.mountAttempted) {
      this.mountAttempted = true;
      try {
        ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
          this.panel = new AgentPanel(tui, theme, this.view ?? view);
          return this.panel;
        }, { placement: 'aboveEditor' });
      } catch {
        this.panel?.dispose();
        this.panel = undefined;
        ctx.ui.notify('Agent rail unavailable; /board status still works.', 'warning');
      }
    }
    this.panel?.update(view);
    this.roster?.update(view);
  }
  async showRoster(): Promise<void> {
    const ctx = this.context;
    if (!ctx?.hasUI || !this.view) return;
    if (this.opening) return;
    this.opening = true;
    const generation = this.generation;
    try {
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        if (generation !== this.generation || !this.view) { done(); return { render: () => [], invalidate() {} }; }
        this.finish = done;
        this.roster = new AgentRoster(tui, theme, this.view, done);
        return this.roster;
      }, { overlay: true, overlayOptions: { anchor: 'center', width: ROSTER_WIDTH, maxHeight: '100%', margin: 0 } });
    } catch {
      if (generation === this.generation) ctx.ui.notify('Agent roster unavailable; /board status still works.', 'warning');
    } finally {
      if (generation === this.generation) {
        this.roster?.dispose();
        this.roster = undefined;
        this.finish = undefined;
        this.opening = false;
      }
    }
  }
  dispose(): void {
    this.generation += 1;
    this.panel?.dispose();
    this.roster?.dispose();
    this.panel = undefined;
    this.roster = undefined;
    const finish = this.finish;
    this.finish = undefined;
    this.opening = false;
    if (this.mountAttempted) {
      try { this.context?.ui.setWidget(WIDGET_KEY, undefined); }
      catch { this.context?.ui.notify('Agent rail cleanup failed; reload the parent UI when ready.', 'warning'); }
    }
    this.mountAttempted = false;
    this.context = undefined;
    this.view = undefined;
    finish?.();
  }
}
