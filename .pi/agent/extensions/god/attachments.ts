import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

export const ATTACHMENT_COUNT_MAX = 10;
export const ATTACHMENT_BYTES_TOTAL_MAX = 50_000_000;
const IMAGE_BYTES_MAX = 10_000_000;
export const ATTACHMENT_PATH_LENGTH_MAX = 4096;
const READ_CHUNK_BYTES = 1_000_000;
const READ_ITERATIONS_MAX = 256;

export interface TelegramAttachment {
  path: string;
  type: "image" | "video" | "document";
}

export interface PreparedAttachment {
  name: string;
  type: TelegramAttachment["type"];
  bytes: Uint8Array<ArrayBuffer>;
}

export async function prepareAttachments(
  attachments: TelegramAttachment[],
  directory: string,
  signal: AbortSignal,
): Promise<PreparedAttachment[]> {
  if (!Array.isArray(attachments) || attachments.length > ATTACHMENT_COUNT_MAX) {
    throw new Error("Telegram accepts at most 10 attachments per notification.");
  }
  if (!directory || !(signal instanceof AbortSignal)) {
    throw new Error("Attachment directory and cancellation signal are required.");
  }
  const prepared: PreparedAttachment[] = [];
  let totalBytes = 0;
  for (let index = 0; index < attachments.length; index += 1) {
    signal.throwIfAborted();
    const attachment = attachments[index];
    if (!attachment || typeof attachment.path !== "string" || !attachment.path.trim() ||
      attachment.path.length > ATTACHMENT_PATH_LENGTH_MAX || attachment.path.includes("\0") ||
      !["image", "video", "document"].includes(attachment.type)) {
      throw new Error("Each attachment needs a local path and image, video, or document type.");
    }
    const path = resolve(directory, attachment.path);
    // Check both names: a harmless-looking symlink must not upload an environment file.
    if (path.split(sep).some((part) => /^\.env(?:\.|$)/i.test(part))) {
      throw new Error("Environment-file attachments are forbidden.");
    }
    let file;
    try {
      const target = await realpath(path);
      if (target.split(sep).some((part) => /^\.env(?:\.|$)/i.test(part))) {
        throw new Error("Environment-file attachments are forbidden.");
      }
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const information = await file.stat();
      const bytesMax = attachment.type === "image" ? IMAGE_BYTES_MAX : ATTACHMENT_BYTES_TOTAL_MAX;
      if (!information.isFile() || information.size < 1 || information.size > bytesMax ||
        totalBytes + information.size > ATTACHMENT_BYTES_TOTAL_MAX) {
        throw new Error("Attachment must be a nonempty regular file within upload limits.");
      }
      const bytes = new Uint8Array(information.size);
      let size = 0;
      for (let readIndex = 0; readIndex < READ_ITERATIONS_MAX && size < bytes.length; readIndex += 1) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(bytes, size, Math.min(READ_CHUNK_BYTES, bytes.length - size), size);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      const overflow = new Uint8Array(1);
      const tail = await file.read(overflow, 0, overflow.length, size);
      if (size !== bytes.length || tail.bytesRead !== 0) {
        throw new Error("Attachment changed while reading; upload refused.");
      }
      totalBytes += bytes.length;
      prepared.push({ name: basename(target), type: attachment.type, bytes });
    } catch {
      throw new Error("Attachment rejected: inaccessible, environment file, non-regular file, changed file, or upload limit exceeded.");
    } finally {
      await file?.close();
    }
  }
  signal.throwIfAborted();
  return prepared;
}
