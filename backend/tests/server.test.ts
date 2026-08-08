import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server.js";
import { hashPhoneNumber } from "../src/hashing.js";
import { gpsLocationParser } from "../src/parser/location.js";
import { emailWebhookMessageParser } from "../src/parser/message.js";
import { LocationProcessingService } from "../src/service.js";
import type { LocationPoint, LocationStore } from "../src/types.js";

class MemoryStore implements LocationStore {
  async updateLocation(_phoneHash: string, _point: LocationPoint) {
    return { duplicate: false, historyLength: 1 };
  }
}

function app() {
  return createApp(
    new LocationProcessingService(
      emailWebhookMessageParser,
      gpsLocationParser,
      { hash: hashPhoneNumber },
      new MemoryStore(),
      { info: vi.fn(), error: vi.fn() },
    ),
  );
}

afterEach(() => {
  delete process.env.TEST_TOKEN;
  delete process.env.WEBHOOK_SECRET;
  process.env.NODE_ENV = "test";
});

describe("HTTP API", () => {
  it("reports health", async () => {
    await request(app()).get("/health").expect(200, { status: "ok" });
  });

  it("processes the development test endpoint", async () => {
    const response = await request(app())
      .post("/test-location")
      .send({ phone: "+16045551234", message: "49.2827,-123.1207", messageId: "api-1" })
      .expect(200);
    expect(response.body).toMatchObject({ status: "ok", historyLength: 1 });
  });

  it("maps missing GPS data to 422", async () => {
    await request(app())
      .post("/webhook")
      .send({ from: "+16045551234", message: "hello" })
      .expect(422, { error: "No GPS coordinates found" });
  });

  it("rejects an invalid webhook secret", async () => {
    process.env.WEBHOOK_SECRET = "expected";
    await request(app())
      .post("/webhook")
      .set("X-Webhook-Secret", "wrong")
      .send({ from: "+16045551234", message: "49.2827,-123.1207" })
      .expect(401, { error: "Unauthorized" });
  });

  it("disables the production test endpoint when TEST_TOKEN is absent", async () => {
    process.env.NODE_ENV = "production";
    await request(app())
      .post("/test-location")
      .send({ phone: "+16045551234", message: "49.2827,-123.1207" })
      .expect(401, { error: "Unauthorized" });
  });
});
