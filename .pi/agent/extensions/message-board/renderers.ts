import { Text, stripTerminalSequences, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import type { ToolRenderers } from '@earendil-works/pi-coding-agent';
import { LIMITS } from './protocol.mjs';

const DISPLAY_CHARS_MAX = LIMITS.response_bytes * 2;
const CONTENT_BLOCKS_MAX = 128;
const JOB_ID_CHARS = 8;
const ACTIONS = new Set(['init', 'delegate', 'instruct', 'respond', 'ack', 'status', 'retry', 'reconnect', 'cancel', 'stop']);
const KINDS = new Set(['progress', 'needs_decision', 'result', 'failed']);
const FALLBACK = 'Result received · expand for details';

function compactLine(text: string): Component {
  return { render: width => width > 0 ? [truncateToWidth(text, width)] : [], invalidate() {} };
}
function displayJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2) ?? '{}';
    return text.length > DISPLAY_CHARS_MAX ? text.slice(0, DISPLAY_CHARS_MAX) + '\n… (display limit; original retained)' : text;
  } catch { return 'Arguments unavailable: not serializable'; }
}
function resultText(content: { type: string; text?: string }[]): string {
  let text = '';
  let truncated = content.length > CONTENT_BLOCKS_MAX;
  for (const block of content.slice(0, CONTENT_BLOCKS_MAX)) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    const remaining = DISPLAY_CHARS_MAX - text.length;
    if (block.text.length + 1 > remaining) {
      text += block.text.slice(0, Math.max(0, remaining));
      truncated = true;
      break;
    }
    text += (text ? '\n' : '') + block.text;
  }
  const sanitized = stripTerminalSequences(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  return (sanitized || 'No textual result') + (truncated ? '\n… (display limit; original retained)' : '');
}
function actionOf(args: unknown, toolName: 'subagent' | 'board_post'): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  return (args as Record<string, unknown>)[toolName === 'subagent' ? 'action' : 'kind'];
}
function summary(action: unknown, details: Record<string, unknown>): string {
  if (action === 'status') {
    if (!Array.isArray(details.jobs) || details.jobs.length > LIMITS.jobs) return FALLBACK;
    let working = 0;
    let cancelled = 0;
    let failed = 0;
    let interrupted = 0;
    for (const job of details.jobs) {
      if (!job || typeof job !== 'object') return FALLBACK;
      if (['starting', 'working', 'cancelling'].includes(job.state)) working++;
      if (job.state === 'cancelled') cancelled++;
      if (job.state === 'error' || job.stage === 'failed' || job.stage === 'startup_failed') failed++;
      if (job.state === 'interrupted') interrupted++;
    }
    const pending = Number.isSafeInteger(details.pending) && Number(details.pending) >= 0 && Number(details.pending) <= LIMITS.events ? details.pending : '?';
    const warnings = `${failed ? `${failed} failed · ` : ''}${interrupted ? `${interrupted} interrupted · ` : ''}`;
    return `${details.jobs.length} jobs · ${warnings}${working} working · ${cancelled} cancelled · ${pending} reports pending`;
  }
  if (action === 'init' && details.initialized === true) return 'Board initialized · delivery paused';
  if (action === 'reconnect' && details.reconnected === true) return 'Board reconnected';
  if (action === 'stop' && details.stopping === true) return 'Board stop requested';
  if (action === 'retry' && details.retryEnabled === true) return 'Delivery retry enabled';
  if (action === 'cancel' && typeof details.cancellationRequested === 'string') return 'Cancellation requested';
  if (action === 'ack' && Array.isArray(details.acknowledged) && details.acknowledged.length <= LIMITS.batch && details.acknowledged.every(id => typeof id === 'string')) {
    return `Acknowledged ${details.acknowledged.length} ${details.acknowledged.length === 1 ? 'report' : 'reports'}`;
  }
  if (action === 'respond') {
    if (typeof details.alreadyAnswered === 'string') return 'Decision already answered';
    if (details.accepted === true) return 'Response accepted';
  }
  if ((action === 'delegate' || action === 'instruct') && details.accepted === true && typeof details.jobId === 'string') {
    const identity = /^[a-f0-9-]{36}$/.test(details.jobId) ? ` · ${details.jobId.slice(0, JOB_ID_CHARS)}` : '';
    return `${action === 'delegate' ? 'Worker' : 'Assignment'} accepted${identity}${details.duplicate === true ? ' · existing task' : ''}`;
  }
  return FALLBACK;
}

export function boardToolRenderers(toolName: 'subagent' | 'board_post'): ToolRenderers {
  return {
    renderCall(args, theme, context) {
      const action = actionOf(args, toolName);
      const known = typeof action === 'string' && (toolName === 'subagent' ? ACTIONS : KINDS).has(action);
      const heading = theme.fg('toolTitle', theme.bold(toolName)) + theme.fg('muted', ` · ${known ? action : '…'}`);
      return context.expanded ? new Text(heading + '\n' + displayJson(args), 0, 0) : compactLine(heading);
    },
    renderResult(result, options, theme, context) {
      if (options.expanded) return new Text(theme.fg(context.isError ? 'error' : 'toolOutput', resultText(result.content)), 0, 0);
      if (context.isError) return compactLine(theme.fg('error', 'Error: ' + resultText(result.content).replace(/\s+/g, ' ')));
      if (options.isPartial) return compactLine(theme.fg('muted', 'Working…'));
      const details = result.details && typeof result.details === 'object' && !Array.isArray(result.details) ? result.details as Record<string, unknown> : {};
      let text = FALLBACK;
      if (toolName === 'board_post') {
        if (details.delivery === 'durably_queued' && typeof details.id === 'string') text = `Report queued${details.duplicate === true ? ' · already stored' : ''}`;
      } else text = summary(actionOf(context.args, toolName), details);
      return compactLine(theme.fg('muted', text));
    },
  };
}
