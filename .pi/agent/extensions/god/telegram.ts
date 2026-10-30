import { open } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { prepareAttachments, type TelegramAttachment } from "./attachments.ts";

export const MESSAGE_LENGTH_MAX = 4096;
const ENV_BYTES_MAX = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_BYTES_MAX = 16 * 1024;
const UPLOAD_TIMEOUT_MS = 60_000;
const NOTIFICATION_TIMEOUT_MS = 120_000;

export interface TelegramConfiguration {
  token: string;
  channel: string;
}

export async function loadTelegramConfiguration(directory: string): Promise<TelegramConfiguration> {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("Telegram configuration directory is required.");
  }
  let environment: Record<string, string>;
  let file;
  try {
    file = await open(join(directory, ".env"), "r");
    const buffer = Buffer.alloc(ENV_BYTES_MAX + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > ENV_BYTES_MAX) throw new Error("Environment file exceeds size limit.");
    environment = parseEnv(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    throw new Error("Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Pi's agent-directory .env (normally ~/.pi/agent/.env).");
  } finally {
    await file?.close();
  }
  const token = environment.TELEGRAM_BOT_TOKEN;
  const channel = environment.TELEGRAM_CHAT_ID;
  if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) || token.length > 256) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing or invalid.");
  }
  if (!channel || !/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(channel)) {
    throw new Error("TELEGRAM_CHAT_ID is missing or invalid.");
  }
  return { token, channel };
}

export async function sendTelegramMessage(
  configuration: TelegramConfiguration,
  message: string,
  signal: AbortSignal,
): Promise<void> {
  if (typeof message !== "string" || !message.trim() || message.length > MESSAGE_LENGTH_MAX) {
    throw new Error("Telegram message must contain 1–4096 characters.");
  }
  if (!configuration.token || !configuration.channel || !(signal instanceof AbortSignal)) {
    throw new Error("Telegram configuration and cancellation signal are required.");
  }
  if (message.includes(configuration.token) || /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/.test(message)) {
    throw new Error("Telegram message contains a bot credential; sending refused.");
  }
  await requestTelegram(
    configuration.token,
    "sendMessage",
    JSON.stringify({ chat_id: configuration.channel, text: message, protect_content: true }),
    REQUEST_TIMEOUT_MS,
    signal,
  );
}

async function requestTelegram(
  token: string,
  method: "sendMessage" | "sendPhoto" | "sendVideo" | "sendDocument",
  body: string | FormData,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (!token || !["sendMessage", "sendPhoto", "sendVideo", "sendDocument"].includes(method) ||
    timeoutMs < 1 || timeoutMs > UPLOAD_TIMEOUT_MS || !(signal instanceof AbortSignal)) {
    throw new Error("Invalid Telegram request parameters.");
  }
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      redirect: "error",
      ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Telegram rejected the request.");
    }
    if (!response.body) throw new Error("Telegram returned no response.");
    const reader = response.body.getReader();
    const buffer = new Uint8Array(RESPONSE_BYTES_MAX);
    let size = 0;
    try {
      for (let index = 0; index < RESPONSE_BYTES_MAX; index += 1) {
        const part = await reader.read();
        if (part.done) {
          const result: unknown = JSON.parse(new TextDecoder().decode(buffer.subarray(0, size)));
          if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) {
            throw new Error("Telegram did not confirm delivery.");
          }
          return;
        }
        if (size + part.value.length > RESPONSE_BYTES_MAX) throw new Error("Telegram response exceeds size limit.");
        buffer.set(part.value, size);
        size += part.value.length;
      }
      throw new Error("Telegram response exceeds work limit.");
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  } catch {
    // Telegram embeds the token in request URLs; never propagate network errors or API bodies.
    throw new Error("Telegram delivery failed or was cancelled; no retry made. Delivery may be uncertain.");
  }
}

export interface TelegramDelivery {
  complete: boolean;
  summarySent: boolean;
  attachmentsSent: number;
  attachmentCount: number;
}

export async function sendTelegramNotification(
  configuration: TelegramConfiguration,
  message: string,
  attachments: TelegramAttachment[],
  directory: string,
  signal: AbortSignal,
): Promise<TelegramDelivery> {
  if (typeof message !== "string" || !message.trim() || message.length > MESSAGE_LENGTH_MAX ||
    message.includes(configuration.token) || /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/.test(message)) {
    throw new Error("Telegram summary is empty, too long, or contains a bot credential.");
  }
  if (!(signal instanceof AbortSignal) || !configuration.token || !configuration.channel) {
    throw new Error("Telegram configuration and cancellation signal are required.");
  }
  const notificationSignal = AbortSignal.any([signal, AbortSignal.timeout(NOTIFICATION_TIMEOUT_MS)]);
  const prepared = await prepareAttachments(attachments, directory, notificationSignal);
  const delivery: TelegramDelivery = {
    complete: false, summarySent: false, attachmentsSent: 0, attachmentCount: prepared.length,
  };
  try {
    await sendTelegramMessage(configuration, message, notificationSignal);
    delivery.summarySent = true;
    for (let index = 0; index < prepared.length; index += 1) {
      notificationSignal.throwIfAborted();
      const attachment = prepared[index];
      const field = attachment.type === "image" ? "photo" : attachment.type === "video" ? "video" : "document";
      const method = attachment.type === "image" ? "sendPhoto" : attachment.type === "video" ? "sendVideo" : "sendDocument";
      const body = new FormData();
      body.set("chat_id", configuration.channel);
      body.set("protect_content", "true");
      body.set(field, new Blob([attachment.bytes]), attachment.name);
      await requestTelegram(configuration.token, method, body, UPLOAD_TIMEOUT_MS, notificationSignal);
      delivery.attachmentsSent += 1;
    }
    delivery.complete = true;
  } catch {
    // Stop the batch: retrying an unconfirmed upload can duplicate files already received.
  }
  return delivery;
}
