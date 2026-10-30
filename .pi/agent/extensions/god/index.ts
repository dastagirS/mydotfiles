import { Type } from "typebox";
import { getAgentDir, getSettingsListTheme, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, visibleWidth } from "@earendil-works/pi-tui";
import { loadTelegramConfiguration, MESSAGE_LENGTH_MAX, sendTelegramNotification } from "./telegram.ts";
import { ATTACHMENT_COUNT_MAX, ATTACHMENT_PATH_LENGTH_MAX } from "./attachments.ts";

const TOOL_NAME = "telegram_notify";
const STATE_ENTRY = "god-settings";
const SETTINGS_HEIGHT = 5;
const MODAL_BACKGROUND = "\u001b[48;2;0;0;0m";
const BACKGROUND_RESET = "\u001b[49m";
const BRANCH_ENTRY_COUNT_MAX = 100_000;
const CONFIGURATION_ERRORS_SAFE = new Set([
  "Telegram configuration directory is required.",
  "Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Pi's agent-directory .env (normally ~/.pi/agent/.env).",
  "TELEGRAM_BOT_TOKEN is missing or invalid.",
  "TELEGRAM_CHAT_ID is missing or invalid.",
]);
const COMPLETION_INSTRUCTION =
  "Telegram notifications are enabled for this session. After completing the user's task, " +
  "call telegram_notify once before your final response with a short plain-text update: " +
  "what was built or changed, outcome, verification, and any blockers. " +
  "Optionally attach up to 10 task deliverables using attachments with local path and type image, video, or document. " +
  "Never attach .env or .env.* files, including links to them. " +
  "Never include credentials, secrets, raw code, private personal data, or sensitive tool output. " +
  "Do not notify for intermediate progress or clarification questions. " +
  "If delivery fails, report it locally and do not retry.";

export default function godExtension(pi: ExtensionAPI): void {
  let enabled = false;
  let attempted = false;
  let generation = 0;
  let request: AbortController | undefined;

  const parameters = Type.Object({
    message: Type.String({ minLength: 1, maxLength: MESSAGE_LENGTH_MAX }),
    attachments: Type.Optional(Type.Array(Type.Object({
      path: Type.String({ minLength: 1, maxLength: ATTACHMENT_PATH_LENGTH_MAX, description: "Local file path, relative to Pi's working directory or absolute" }),
      type: Type.Union([Type.Literal("image"), Type.Literal("video"), Type.Literal("document")]),
    }, { additionalProperties: false }), { maxItems: ATTACHMENT_COUNT_MAX })),
  }, { additionalProperties: false });
  const tool: ToolDefinition<typeof parameters> = {
      name: TOOL_NAME,
      label: "Telegram Notify",
      description: "Send a brief, non-sensitive completion summary and optionally up to 10 local image/video/document attachments to the configured Telegram channel. Environment files are forbidden. Uploads are sequential, without retries.",
      promptGuidelines: [COMPLETION_INSTRUCTION],
      exposure: "hidden",
      defaultActive: false,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
      parameters,
      async execute(_identifier, parameters, signal, _onUpdate, ctx) {
        if (!enabled) throw new Error("Telegram notifications are disabled for this session.");
        if (attempted) throw new Error("Telegram notification already attempted for this task; do not retry.");
        if (signal?.aborted) throw new Error("Telegram notification cancelled before sending.");
        attempted = true;
        const operationGeneration = generation;
        const controller = new AbortController();
        request = controller;
        let warning = "Telegram notification rejected or cancelled before sending: summary or attachment validation did not complete. Nothing sent. No retry made.";
        try {
          const configuration = await loadTelegramConfiguration(getAgentDir()).catch((error: unknown) => {
            // Only fixed loader messages are safe; filesystem errors can expose local paths.
            const reason = error instanceof Error && CONFIGURATION_ERRORS_SAFE.has(error.message)
              ? error.message
              : "Could not load Telegram configuration.";
            warning = `Telegram configuration failed: ${reason} Nothing sent. No retry made.`;
            throw new Error(warning);
          });
          if (!enabled || operationGeneration !== generation || controller.signal.aborted) {
            throw new Error("Telegram notification cancelled before sending.");
          }
          const delivery = await sendTelegramNotification(
            configuration,
            parameters.message,
            parameters.attachments ?? [],
            ctx.cwd,
            signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
          );
          if (!delivery.complete) {
            warning = `Telegram delivery stopped: summary ${delivery.summarySent ? "confirmed" : "not confirmed"}; ${delivery.attachmentsSent}/${delivery.attachmentCount} attachments confirmed. No retry made; the last request may have arrived.`;
            throw new Error(warning);
          }
          const text = delivery.attachmentCount === 0
            ? "Telegram completion update sent."
            : `Telegram completion update and ${delivery.attachmentsSent} attachments sent.`;
          return { content: [{ type: "text", text }], details: delivery };
        } catch {
          ctx.ui.notify(warning, "warning");
          throw new Error(warning);
        } finally {
          if (request === controller) request = undefined;
        }
      },
  };
  pi.registerTool(tool);

  function applyExposure(): void {
    const otherTools = pi.getActiveTools().filter((name) => name !== TOOL_NAME);
    pi.registerTool({ ...tool, exposure: enabled ? "model-only" : "hidden" });
    pi.setActiveTools(enabled ? [...otherTools, TOOL_NAME] : otherTools);
  }

  function restore(ctx: ExtensionContext): void {
    request?.abort();
    generation += 1;
    enabled = false;
    attempted = false;
    const branch = ctx.sessionManager.getBranch();
    if (branch.length > BRANCH_ENTRY_COUNT_MAX) {
      ctx.ui.notify("Session is too large to restore /god settings; Telegram disabled.", "warning");
    } else {
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        const entry = branch[index];
        if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
        const data: unknown = entry.data;
        if (data && typeof data === "object" && "telegramNotify" in data) {
          enabled = data.telegramNotify === true;
        }
        break;
      }
    }
    applyExposure();
  }

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("before_agent_start", () => {
    request?.abort();
    generation += 1;
    attempted = false;
    applyExposure();
  });
  pi.on("session_shutdown", () => {
    enabled = false;
    generation += 1;
    request?.abort();
  });

  pi.registerCommand("god", {
    description: "Toggle session-scoped features, including Telegram completion notifications",
    handler: async (_arguments, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/god requires Pi's interactive TUI.", "warning");
        return;
      }
      try {
        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          const container = new Container();
          container.addChild(new Text(theme.fg("accent", theme.bold("God — session settings")), 1, 1));
          const settings = new SettingsList(
            [{ id: "telegram-notify", label: "Telegram notify", currentValue: enabled ? "[x]" : "[ ]", values: ["[ ]", "[x]"] }],
            SETTINGS_HEIGHT,
            getSettingsListTheme(),
            (_id, value) => {
              const nextEnabled = value === "[x]";
              try {
                pi.appendEntry(STATE_ENTRY, { version: 1, telegramNotify: nextEnabled });
                enabled = nextEnabled;
                generation += 1;
                if (!enabled) request?.abort();
                applyExposure();
              } catch {
                enabled = false;
                request?.abort();
                applyExposure();
                ctx.ui.notify("Could not save /god settings; Telegram disabled.", "error");
                done();
              }
            },
            () => done(),
          );
          container.addChild(settings);
          container.addChild(new Text("Enter: toggle · Escape: close · changes apply immediately", 1, 1));
          return {
            render: (width) => container.render(width).map((line) =>
              MODAL_BACKGROUND +
              line.replace(/\u001b\[(?:0|49)?m/g, (reset) => reset + MODAL_BACKGROUND) +
              " ".repeat(Math.max(0, width - visibleWidth(line))) + BACKGROUND_RESET,
            ),
            invalidate: () => container.invalidate(),
            handleInput: (data) => {
              settings.handleInput(data);
              tui.requestRender();
            },
          };
        }, { overlay: true, overlayOptions: { width: "80%", maxHeight: "60%" } });
      } catch {
        ctx.ui.notify("Could not open /god settings.", "error");
      }
    },
  });
}
