import type { MessageParser, MessageParseResult } from "../types.js";
import { normalizePhoneNumber } from "../phone.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function get(payload: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => object(value)?.[key], payload);
}

function firstString(payload: JsonObject, paths: string[]): string {
  for (const path of paths) {
    const value = get(payload, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value.filter((item): item is string => typeof item === "string").join("\n").trim();
      if (joined) return joined;
    }
  }
  return "";
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function extractForwardedSender(body: string): string[] {
  return Array.from(
    body.matchAll(/^(?:from|sender|reply-to)\s*:\s*(.+)$/gim),
    (match) => match[1],
  );
}

function isoDate(value: string): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

export class EmailWebhookMessageParser implements MessageParser {
  parse(payload: unknown, deliveryId?: string): MessageParseResult {
    const data = object(payload);
    if (!data) return { success: false, error: "Webhook payload must be a JSON object" };

    const subject = firstString(data, ["subject", "Subject", "email.subject"]);
    let body = firstString(data, [
      "message",
      "body",
      "text",
      "textPlain",
      "TextBody",
      "email.message",
      "email.body",
      "content",
    ]);
    if (!body) {
      const html = firstString(data, ["html", "htmlBody", "HtmlBody", "email.html"]);
      if (html) body = stripHtml(html);
    }
    if (!body) return { success: false, error: "Webhook payload has no message body" };

    const explicitSenders = [
      firstString(data, [
        "sender",
        "phone",
        "fromPhone",
        "from",
        "From",
        "envelope.from",
        "email.from",
        "headers.from",
        "replyTo",
        "ReplyTo",
      ]),
      ...extractForwardedSender(body),
      subject,
    ].filter(Boolean);

    let sender: string | null = null;
    for (const candidate of explicitSenders) {
      sender = normalizePhoneNumber(candidate);
      if (sender) break;
    }
    if (!sender) {
      return {
        success: false,
        error: "No sender phone number found in webhook metadata or forwarded headers",
      };
    }

    const receivedAt = isoDate(
      firstString(data, ["receivedAt", "timestamp", "date", "Date", "email.date"]),
    );
    const messageId =
      deliveryId ||
      firstString(data, ["messageId", "message_id", "MessageID", "id", "email.messageId"]) ||
      undefined;

    return {
      success: true,
      message: { sender, subject, body, receivedAt, messageId },
    };
  }
}

export const emailWebhookMessageParser = new EmailWebhookMessageParser();
