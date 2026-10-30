import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runImportCommand } from "./command.ts";

export default function sessionContextImportExtension(pi: ExtensionAPI): void {
  pi.registerCommand("import-session", {
    description: "Import reviewed context from another Pi session (LLM state by default; --fast, --deep, --refresh)",
    handler: async (args: string | undefined, ctx: ExtensionCommandContext) => {
      await runImportCommand(pi, args, ctx);
    },
  });
}
