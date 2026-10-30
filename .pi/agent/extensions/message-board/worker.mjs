import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIMITS, readJson, STARTUP_ERROR_TYPES, workerInstructions } from './protocol.mjs';

const SCOPE_DIAGNOSTICS_MAX = 32;
let startupPhase = 'configuration';
let output = process.stdout.write.bind(process.stdout);
try {
  const configuration = readJson(process.argv[2]);
  process.umask(configuration.umask);
  startupPhase = 'sdk_loading';
  const packageRoot = configuration.packageRoot;
  const load = path => import(pathToFileURL(join(packageRoot, path)).href);
  const { takeOverStdout, writeRawStdout } = await load('dist/core/output-guard.js');
  output = writeRawStdout;
  takeOverStdout();
  const sdk = await load('dist/index.js');
  const { builtInExtensions } = await load('dist/extensions/index.js');
  const { runRpcMode } = await load('dist/modes/rpc/rpc-mode.js');
  const { ProjectTrustStore } = await load('dist/core/trust-manager.js');
  const { resolveProjectTrusted } = await load('dist/core/project-trust.js');
  const { createProjectTrustContext } = await load('dist/cli/project-trust.js');
  const { applyHttpProxySettings, configureHttpDispatcher } = await load('dist/core/http-dispatcher.js');
  const trust = new ProjectTrustStore(configuration.agentDir);
  const createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    startupPhase = 'resources';
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted: false });
    applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
    configureHttpDispatcher();
    sdk.initTheme(settingsManager.getTheme() ?? 'dark', false);
    const services = await sdk.createAgentSessionServices({
      cwd, agentDir, settingsManager,
      modelRuntimeSignal: AbortSignal.timeout(LIMITS.request_ms),
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async ({ extensionsResult }) => resolveProjectTrusted({
          cwd, trustStore: trust, defaultProjectTrust: settingsManager.getDefaultProjectTrust(), extensionsResult,
          projectTrustContext: createProjectTrustContext({ cwd, mode: 'rpc', settingsManager, hasUI: false }),
        }),
      },
      resourceLoaderOptions: {
        extensionFactories: builtInExtensions,
        additionalExtensionPaths: [configuration.extensionPath, ...(configuration.ticketBinding ? [configuration.ticketExtensionPath] : [])],
        appendSystemPromptOverride: base => [...base, workerInstructions(configuration)],
        skillsOverride: base => ({ ...base, skills: base.skills.filter(skill => skill.name !== 'subagent') }),
      },
    });
    if (!settingsManager.isProjectTrusted()) throw new Error('Worker project is not trusted. Trust it explicitly in Pi before delegating; the board never auto-trusts repositories.');
    const failures = services.resourceLoader.getExtensions().errors;
    if (failures.some(failure => failure.path === configuration.extensionPath)) throw new Error('Worker reporting extension could not load');
    if (configuration.ticketBinding && failures.some(failure => failure.path === configuration.ticketExtensionPath)) throw new Error('Worker ticket extension could not load');
    if (services.diagnostics.length || failures.length) {
      process.stderr.write('Normal Pi resources reported startup diagnostics; inspect configured packages and project trust.\n');
    }
    startupPhase = 'model_selection';
    const selected = sdk.resolveCliModel({
      cliProvider: configuration.provider, cliModel: configuration.model,
      cliThinking: configuration.thinking, modelRuntime: services.modelRuntime,
    });
    if (selected.error) throw new Error('Configured worker model could not be selected');
    startupPhase = 'model_scope';
    const patterns = settingsManager.getEnabledModels() ?? [];
    let scopedModels;
    if (patterns.length) {
      if (typeof sdk.resolveModelScopeWithDiagnostics !== 'function') throw new Error('Installed Pi SDK lacks model scope resolution');
      const resolution = await sdk.resolveModelScopeWithDiagnostics(patterns, services.modelRuntime, { signal: AbortSignal.timeout(LIMITS.request_ms) });
      scopedModels = resolution.scopedModels;
      // Diagnostic messages/patterns may contain private configuration; retain only known warning codes.
      for (const diagnostic of resolution.diagnostics.slice(0, SCOPE_DIAGNOSTICS_MAX)) {
        const code = ['no-match', 'invalid-thinking-level', 'ambiguous'].includes(diagnostic.code) ? diagnostic.code : 'unknown';
        process.stderr.write('Worker model scope warning: ' + code + '\n');
      }
      if (resolution.diagnostics.length > SCOPE_DIAGNOSTICS_MAX) process.stderr.write('Additional worker model scope warnings omitted.\n');
    }
    startupPhase = 'session_creation';
    const thinkingLevel = selected.thinkingLevel ?? configuration.thinking;
    const result = await sdk.createAgentSessionFromServices({
      services, sessionManager, sessionStartEvent,
      ...(selected.model ? { model: selected.model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(scopedModels ? { scopedModels } : {}),
    });
    return { ...result, services, diagnostics: services.diagnostics };
  };
  const runtime = await sdk.createAgentSessionRuntime(createRuntime, {
    cwd: configuration.cwd, agentDir: configuration.agentDir,
    sessionManager: sdk.SessionManager.create(configuration.cwd, configuration.sessionDir),
  });
  startupPhase = 'rpc_start';
  await runRpcMode(runtime);
} catch (error) {
  const safeReasons = new Set([
    'Worker project is not trusted. Trust it explicitly in Pi before delegating; the board never auto-trusts repositories.',
    'Worker reporting extension could not load',
    'Worker ticket extension could not load',
    'Configured worker model could not be selected',
    'Installed Pi SDK lacks model scope resolution',
  ]);
  const reason = error instanceof Error && safeReasons.has(error.message) ? error.message : 'Worker initialization failed; verify installed Pi compatibility and project configuration.';
  const errorType = error instanceof Error && STARTUP_ERROR_TYPES.includes(error.name) ? error.name : 'UnknownError';
  process.stderr.write(`Worker initialization failed [phase=${startupPhase}; type=${errorType}]: ${reason}\n`);
  output(JSON.stringify({ type: 'response', command: 'startup', success: false, error: reason, startupPhase, errorType }) + '\n');
  process.exitCode = 1;
}
