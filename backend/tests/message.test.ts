import { describe, expect, it } from "vitest";
import { EmailWebhookMessageParser } from "../src/parser/message.js";

const parser = new EmailWebhookMessageParser();

describe("EmailWebhookMessageParser", () => {
  it("parses the documented email-webhook.com payload and delivery ID", () => {
    const result = parser.parse(
      {
        from: "+1 (604) 555-1234",
        subject: "Google Voice message",
        message: "49.2827,-123.1207",
        date: "2026-08-07T20:15:00Z",
      },
      "delivery-123",
    );
    expect(result).toEqual({
      success: true,
      message: {
        sender: "+16045551234",
        subject: "Google Voice message",
        body: "49.2827,-123.1207",
        receivedAt: "2026-08-07T20:15:00.000Z",
        messageId: "delivery-123",
      },
    });
  });

  it("finds a phone number in Gmail forwarded headers", () => {
    const result = parser.parse({
      from: "my.account@gmail.com",
      subject: "Fwd: New text message",
      message: "Forwarded message\nFrom: +1 604 555 1234\n\nLocation: 49.2827,-123.1207",
    });
    expect(result.success && result.message.sender).toBe("+16045551234");
  });

  it("accepts alternative nested payload fields", () => {
    const result = parser.parse({
      email: {
        from: "+16045551234",
        subject: "Location",
        body: "49.2827,-123.1207",
        date: "2026-08-07T20:15:00Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("converts an HTML-only body to text", () => {
    const result = parser.parse({
      from: "+16045551234",
      html: "<p>Location:<br>49.2827,-123.1207</p>",
    });
    expect(result.success && result.message.body).toContain("49.2827,-123.1207");
  });

  it.each([
    [null, "Webhook payload must be a JSON object"],
    [{ from: "+16045551234" }, "Webhook payload has no message body"],
    [{ from: "someone@example.com", message: "49.2827,-123.1207" }, "No sender phone number found in webhook metadata or forwarded headers"],
  ])("rejects malformed payload %#", (payload, error) => {
    expect(parser.parse(payload)).toEqual({ success: false, error });
  });
});
