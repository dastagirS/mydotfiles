import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { mkdtemp, rm, writeFile, symlink, open } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { loadTelegramConfiguration, sendTelegramMessage, sendTelegramNotification } from "./telegram.ts";
import { prepareAttachments } from "./attachments.ts";

const packageRoot = process.env.PI_PACKAGE_ROOT ?? join(homedir(), ".local/lib/node_modules/@earendil-works/pi-coding-agent");
const require = createRequire(join(packageRoot, "package.json"));
const { createJiti } = await import(require.resolve("jiti"));
const jiti = createJiti(import.meta.url, {
  alias: {
    typebox: require.resolve("typebox"),
    "@earendil-works/pi-coding-agent": join(packageRoot, "dist/index.js"),
    "@earendil-works/pi-tui": join(packageRoot, "node_modules/@earendil-works/pi-tui/dist/index.js"),
  },
});
const { visibleWidth } = await jiti.import("@earendil-works/pi-tui");
const { initTheme } = await jiti.import("@earendil-works/pi-coding-agent");
initTheme("dark", false);
const register = await jiti.import("./index.ts", { default: true });
const token = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_test";
const configuration = { token, channel: "-100123456789" };
const originalFetch = globalThis.fetch;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const originalChannel = process.env.TELEGRAM_CHAT_ID;
const originalAgentDirectory = process.env.PI_CODING_AGENT_DIR;
let directory;
let agentDirectory;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "pi-god-tests-"));
  agentDirectory = await mkdtemp(join(directory, "agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  await writeFile(join(agentDirectory, ".env"), `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_CHAT_ID=${configuration.channel}\n`, { mode: 0o600 });
  await writeFile(join(directory, ".env"), "TELEGRAM_BOT_TOKEN=777777:ABCDEFGHIJKLMNOPQRSTUVWXYZ_project\nTELEGRAM_CHAT_ID=777777\n", { mode: 0o600 });
  for (const name of ["allowed.txt", "report.html", "screenshot.png", "demo.mp4"]) {
    await writeFile(join(directory, name), "public task deliverable");
  }
});
afterEach(() => {
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  globalThis.fetch = originalFetch;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
  if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
  if (originalChannel !== undefined) process.env.TELEGRAM_CHAT_ID = originalChannel;
  if (originalAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDirectory;
});

function harness() {
  const hooks = new Map();
  const tools = new Map();
  const commands = new Map();
  const entries = [];
  const warnings = [];
  let active = ["read", "bash"];
  const api = {
    registerTool: (tool) => tools.set(tool.name, tool),
    getActiveTools: () => [...active],
    setActiveTools: (names) => { active = names; },
    on: (event, handler) => hooks.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
  };
  const context = {
    mode: "tui", cwd: directory,
    sessionManager: { getBranch: () => entries },
    ui: { notify: (message) => warnings.push(message) },
  };
  register(api);
  assert.equal(tools.get("telegram_notify").exposure, "hidden");
  assert.deepEqual(active, ["read", "bash"]);
  return { hooks, tools, commands, entries, warnings, context, active: () => active };
}

async function setToggle(instance, enabled) {
  instance.entries.push({ type: "custom", customType: "god-settings", data: { version: 1, telegramNotify: enabled } });
  await instance.hooks.get("session_start")({}, instance.context);
  assert.equal(instance.tools.get("telegram_notify").exposure, enabled ? "model-only" : "hidden");
  assert.equal(instance.active().includes("telegram_notify"), enabled);
}

async function invoke(instance, message = "Built the feature. Tests passed.") {
  assert.ok(instance.tools.has("telegram_notify"));
  const result = await instance.tools.get("telegram_notify").execute("test", { message }, new AbortController().signal, undefined, instance.context);
  assert.equal(result.content[0].text, "Telegram completion update sent.");
  return result;
}

test("agent .env is authoritative; exported credentials and project files are ignored", async () => {
  assert.deepEqual(await loadTelegramConfiguration(agentDirectory), configuration);
  process.env.TELEGRAM_BOT_TOKEN = "999999:ABCDEFGHIJKLMNOPQRSTUVWXYZ_other";
  process.env.TELEGRAM_CHAT_ID = "999999";
  assert.deepEqual(await loadTelegramConfiguration(agentDirectory), configuration);
  await assert.rejects(loadTelegramConfiguration(join(directory, "missing")), /Configure/);
  const instance = harness();
  await setToggle(instance, true);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(JSON.parse(options.body).chat_id, configuration.channel);
    return new Response('{"ok":true}');
  };
  await invoke(instance);
  instance.context.cwd = join(directory, "unrelated-project");
  await instance.hooks.get("before_agent_start")({}, instance.context);
  await invoke(instance);
  assert.equal(calls, 2);
});

test("bounded environment file and messages", async () => {
  const oversized = join(directory, "oversized");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(oversized);
  await writeFile(join(oversized, ".env"), "x".repeat(65_537));
  await assert.rejects(loadTelegramConfiguration(oversized), /Configure/);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"ok":true}'); };
  for (const message of ["", " ", "x".repeat(4097), `secret ${token}`]) {
    await assert.rejects(sendTelegramMessage(configuration, message, new AbortController().signal));
  }
  assert.equal(calls, 0);
});

test("Telegram request uses only configured target and plain text", async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { chat_id: configuration.channel, text: "Done.", protect_content: true });
    return new Response('{"ok":true,"result":{"message_id":1}}');
  };
  await sendTelegramMessage(configuration, "Done.", new AbortController().signal);
  assert.equal(calls, 1);
});

test("network, API, invalid and oversized responses are sanitized without retries", async () => {
  const scenarios = [
    async () => { throw new Error(`secret url /bot${token}`); },
    async () => new Response(token, { status: 429 }),
    async () => new Response('{"ok":false}'),
    async () => new Response("invalid json"),
    async () => new Response("x".repeat(16_385)),
  ];
  for (const scenario of scenarios) {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return scenario(); };
    await assert.rejects(sendTelegramMessage(configuration, "Done.", new AbortController().signal), (error) => {
      assert.ok(!error.message.includes(token));
      assert.match(error.message, /no retry/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("new sessions default off, resume restores, tree changes do not leak state", async () => {
  const instance = harness();
  await instance.hooks.get("session_start")({}, instance.context);
  await assert.rejects(invoke(instance), /disabled/);
  await setToggle(instance, true);
  assert.deepEqual(instance.active(), ["read", "bash", "telegram_notify"]);
  assert.match(instance.tools.get("telegram_notify").promptGuidelines[0], /After completing/);
  instance.entries.length = 0;
  await instance.hooks.get("session_start")({ reason: "new" }, instance.context);
  assert.deepEqual(instance.active(), ["read", "bash"]);
  await assert.rejects(invoke(instance), /disabled/);
  await setToggle(instance, true);
  instance.entries.push({ type: "custom", customType: "god-settings", data: { telegramNotify: false } });
  await instance.hooks.get("session_tree")({}, instance.context);
  assert.equal(instance.tools.get("telegram_notify").exposure, "hidden");
});

test("one attempt per prompt; failure warns without exposing credentials", async () => {
  const instance = harness();
  await setToggle(instance, true);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"ok":true}'); };
  await invoke(instance);
  await assert.rejects(invoke(instance), /already attempted/);
  assert.equal(calls, 1);
  await instance.hooks.get("before_agent_start")({}, instance.context);
  globalThis.fetch = async () => { calls += 1; throw new Error(token); };
  await assert.rejects(invoke(instance), /not confirmed/);
  await assert.rejects(invoke(instance), /already attempted/);
  assert.equal(calls, 2);
  assert.equal(instance.warnings.length, 1);
  assert.ok(!instance.warnings[0].includes(token));
});

test("tool configuration failures report safe reasons, send nothing, and block retries", async () => {
  const scenarios = [
    { token: undefined, channel: undefined, expected: /Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/ },
    { token: "invalid-private-token", channel: configuration.channel, expected: /TELEGRAM_BOT_TOKEN is missing or invalid/ },
    { token: "", channel: configuration.channel, expected: /TELEGRAM_BOT_TOKEN is missing or invalid/ },
    { token, channel: undefined, expected: /TELEGRAM_CHAT_ID is missing or invalid/ },
    { token, channel: "invalid-private-chat", expected: /TELEGRAM_CHAT_ID is missing or invalid/ },
  ];
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Network must not be reached"); };
  for (const scenario of scenarios) {
    process.env.TELEGRAM_BOT_TOKEN = token;
    process.env.TELEGRAM_CHAT_ID = configuration.channel;
    process.env.PI_CODING_AGENT_DIR = await mkdtemp(join(directory, "invalid-agent-"));
    if (scenario.token !== undefined) {
      await writeFile(join(process.env.PI_CODING_AGENT_DIR, ".env"),
        `TELEGRAM_BOT_TOKEN=${scenario.token}\n` +
        (scenario.channel === undefined ? "" : `TELEGRAM_CHAT_ID=${scenario.channel}\n`), { mode: 0o600 });
    }
    const instance = harness();
    await setToggle(instance, true);
    await assert.rejects(invoke(instance), (error) => {
      assert.match(error.message, scenario.expected);
      assert.match(error.message, /Nothing sent/);
      assert.ok(!error.message.includes("delivery may be uncertain"));
      assert.equal(instance.warnings[0], error.message);
      assert.ok(!error.message.includes(token));
      assert.ok(!error.message.includes("invalid-private"));
      assert.ok(!error.message.includes(instance.context.cwd));
      return true;
    });
    await assert.rejects(invoke(instance), /already attempted/);
    assert.equal(instance.warnings.length, 1);
    assert.equal(calls, 0);
  }
});

test("tool pre-send validation failures are not reported as uncertain delivery", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Network must not be reached"); };
  for (const parameters of [
    { message: `private ${token}` },
    { message: "Done.", attachments: [{ path: ".env", type: "document" }] },
    { message: "Done.", attachments: [{ path: "missing-private-file", type: "document" }] },
  ]) {
    const instance = harness();
    await setToggle(instance, true);
    await assert.rejects(instance.tools.get("telegram_notify").execute(
      "test", parameters, new AbortController().signal, undefined, instance.context,
    ), (error) => {
      assert.match(error.message, /before sending/);
      assert.match(error.message, /Nothing sent/);
      assert.ok(!error.message.includes(token));
      assert.ok(!error.message.includes("missing-private-file"));
      assert.ok(!error.message.includes("uncertain"));
      assert.equal(instance.warnings[0], error.message);
      return true;
    });
    await assert.rejects(invoke(instance), /already attempted/);
    assert.equal(instance.warnings.length, 1);
    assert.equal(calls, 0);
  }
});

test("disabling during an in-flight request aborts it; stale tool calls remain blocked", async () => {
  const instance = harness();
  await setToggle(instance, true);
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    assert.ok(options.signal instanceof AbortSignal);
    options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    began();
  });
  const pending = invoke(instance);
  const rejected = assert.rejects(pending, /not confirmed/);
  await started;
  await setToggle(instance, false);
  await rejected;
  await assert.rejects(invoke(instance), /disabled/);
  assert.equal(instance.tools.get("telegram_notify").exposure, "hidden");
});

test("/god requires TUI; real modal renders and toggles immediately", async () => {
  const instance = harness();
  instance.context.mode = "rpc";
  await instance.commands.get("god").handler("", instance.context);
  assert.match(instance.warnings[0], /interactive TUI/);
  instance.context.mode = "tui";
  instance.context.ui.custom = async (factory, options) => {
    assert.equal(options.overlay, true);
    const component = factory({ requestRender() {} }, { fg: (_color, text) => text, bold: (text) => text }, {}, () => {});
    const lines = component.render(70);
    assert.ok(lines.join("\n").includes("Telegram notify"));
    for (const line of lines) {
      assert.ok(line.startsWith("\x1b[48;2;0;0;0m"));
      assert.ok(line.endsWith("\x1b[49m"));
      assert.equal(visibleWidth(line), 70, "black background must fill the modal width");
      assert.ok(!/\x1b\[(?:0|49)?m(?!\x1b\[48;2;0;0;0m)/.test(line.slice(0, -5)), "inner resets must restore black background");
    }
    component.handleInput("\r");
    assert.equal(instance.entries.at(-1).data.telegramNotify, true);
    assert.equal(instance.tools.get("telegram_notify").exposure, "model-only");
    component.handleInput("\r");
    assert.equal(instance.entries.at(-1).data.telegramNotify, false);
    assert.equal(instance.tools.get("telegram_notify").exposure, "hidden");
  };
  await instance.commands.get("god").handler("", instance.context);
  assert.deepEqual(instance.active(), ["read", "bash"]);
  assert.equal(instance.warnings.length, 1, "modal callback errors must not be silently swallowed by the test");
  assert.equal(instance.entries.length, 2);
});

test("multiple images, videos and documents use multipart uploads after the summary", async () => {
  const attachments = [
    { path: "screenshot.png", type: "image" },
    { path: "demo.mp4", type: "video" },
    { path: "report.html", type: "document" },
  ];
  for (const attachment of attachments) await writeFile(join(directory, attachment.path), `artifact ${attachment.type}`);
  const methods = [];
  globalThis.fetch = async (url, options) => {
    const method = url.split("/").at(-1);
    methods.push(method);
    if (method === "sendMessage") {
      assert.equal(JSON.parse(options.body).text, "Built the feature.");
    } else {
      assert.ok(options.body instanceof FormData);
      assert.equal(options.headers, undefined, "fetch must generate the multipart boundary");
      const field = method === "sendPhoto" ? "photo" : method === "sendVideo" ? "video" : "document";
      const file = options.body.get(field);
      assert.equal(options.body.get("chat_id"), configuration.channel);
      assert.equal(options.body.get("protect_content"), "true");
      assert.ok(file instanceof File);
      assert.ok(file.size > 0);
      assert.ok((await file.text()).startsWith("artifact"));
    }
    return new Response('{"ok":true}');
  };
  const result = await sendTelegramNotification(configuration, "Built the feature.", attachments, directory, new AbortController().signal);
  assert.deepEqual(methods, ["sendMessage", "sendPhoto", "sendVideo", "sendDocument"]);
  assert.deepEqual(result, { complete: true, summarySent: true, attachmentsSent: 3, attachmentCount: 3 });
});

test("all files are prevalidated; env variants and aliases produce zero network requests", async () => {
  await writeFile(join(directory, ".env.local"), "secret");
  await symlink(join(directory, ".env.local"), join(directory, "innocent.txt"));
  await writeFile(join(directory, "allowed.txt"), "public report");
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"ok":true}'); };
  for (const path of [".env", ".env.local", "innocent.txt", "missing.txt"]) {
    const attachments = [{ path: "allowed.txt", type: "document" }, { path, type: "document" }];
    await assert.rejects(sendTelegramNotification(configuration, "Done.", attachments, directory, new AbortController().signal));
    assert.equal(calls, 0);
  }
  assert.equal(calls, 0, "even the summary must wait for all attachment validation");
});

test("attachment limits reject oversized images, too many files, invalid types and directories", async () => {
  const path = join(directory, "large.bin");
  const file = await open(path, "w");
  try { await file.truncate(10_000_001); } finally { await file.close(); }
  const signal = new AbortController().signal;
  await assert.rejects(prepareAttachments([{ path, type: "image" }], directory, signal));
  await assert.rejects(prepareAttachments(Array.from({ length: 11 }, () => ({ path, type: "document" })), directory, signal));
  await assert.rejects(prepareAttachments([{ path, type: "unknown" }], directory, signal));
  await assert.rejects(prepareAttachments([{ path: directory, type: "document" }], directory, signal));
  await assert.rejects(prepareAttachments([{ path: "", type: "document" }], directory, signal));
  await assert.rejects(prepareAttachments([{ path: "x".repeat(4097), type: "document" }], directory, signal));
});

test("aggregate upload size is bounded before sending", async () => {
  for (const name of ["large-first.bin", "large-second.bin"]) {
    const file = await open(join(directory, name), "w");
    try { await file.truncate(25_000_001); } finally { await file.close(); }
  }
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"ok":true}'); };
  const attachments = ["large-first.bin", "large-second.bin"].map((path) => ({ path, type: "document" }));
  await assert.rejects(sendTelegramNotification(configuration, "Done.", attachments, directory, new AbortController().signal));
  assert.equal(calls, 0);
});

test("partial delivery reports confirmed counts, stops remaining files, and never retries", async () => {
  const attachments = ["allowed.txt", "report.html", "screenshot.png"].map((path) => ({ path, type: "document" }));
  const methods = [];
  globalThis.fetch = async (url) => {
    methods.push(url.split("/").at(-1));
    if (methods.length === 3) throw new Error(token);
    return new Response('{"ok":true}');
  };
  const result = await sendTelegramNotification(configuration, "Done.", attachments, directory, new AbortController().signal);
  assert.deepEqual(result, { complete: false, summarySent: true, attachmentsSent: 1, attachmentCount: 3 });
  assert.deepEqual(methods, ["sendMessage", "sendDocument", "sendDocument"]);
  assert.ok(!JSON.stringify(result).includes(token));
});

test("tool retains its name and exposes optional attachments and safe partial-delivery feedback", async () => {
  const instance = harness();
  await setToggle(instance, true);
  const tool = instance.tools.get("telegram_notify");
  assert.equal(tool.name, "telegram_notify");
  assert.ok(tool.parameters.properties.attachments);
  assert.equal(tool.parameters.properties.attachments.maxItems, 10);
  assert.deepEqual(tool.parameters.required, ["message"]);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response('{"ok":true}') : new Response(token, { status: 400 });
  };
  await assert.rejects(tool.execute("test", {
    message: "Done.", attachments: [{ path: "allowed.txt", type: "document" }],
  }, new AbortController().signal, undefined, instance.context), /summary confirmed; 0\/1 attachments confirmed/);
  assert.equal(calls, 2);
  assert.equal(instance.warnings.length, 1);
  assert.ok(!instance.warnings[0].includes(token));
  await assert.rejects(invoke(instance), /already attempted/);
});

test("cancellation after the summary stops all uploads and reports partial delivery", async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    controller.abort();
    return new Response('{"ok":true}');
  };
  const result = await sendTelegramNotification(configuration, "Done.", [{ path: "allowed.txt", type: "document" }], directory, controller.signal);
  assert.equal(calls, 1);
  assert.deepEqual(result, { complete: false, summarySent: true, attachmentsSent: 0, attachmentCount: 1 });
});

test("uploads use the bytes validated before the summary, not later file replacements", async () => {
  const path = join(directory, "stable.txt");
  await writeFile(path, "original deliverable");
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) await writeFile(path, "replacement after validation");
    else assert.equal(await options.body.get("document").text(), "original deliverable");
    return new Response('{"ok":true}');
  };
  const result = await sendTelegramNotification(configuration, "Done.", [{ path, type: "document" }], directory, new AbortController().signal);
  assert.equal(result.complete, true);
  assert.equal(calls, 2);
});
