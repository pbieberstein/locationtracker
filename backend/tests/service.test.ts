import { describe, expect, it, vi } from "vitest";
import { hashPhoneNumber } from "../src/hashing.js";
import { gpsLocationParser } from "../src/parser/location.js";
import { emailWebhookMessageParser } from "../src/parser/message.js";
import { LocationProcessingService, ProcessingError } from "../src/service.js";
import type { LocationPoint, LocationStore } from "../src/types.js";

class MemoryStore implements LocationStore {
  points: LocationPoint[] = [];

  async updateLocation(_phoneHash: string, point: LocationPoint) {
    const duplicate = this.points.some((candidate) => candidate.fingerprint === point.fingerprint);
    if (!duplicate) this.points.push(point);
    return { duplicate, historyLength: this.points.length };
  }
}

describe("LocationProcessingService", () => {
  it("runs normalization, parsing, hashing, and storage", async () => {
    const store = new MemoryStore();
    const service = new LocationProcessingService(
      emailWebhookMessageParser,
      gpsLocationParser,
      { hash: hashPhoneNumber },
      store,
      { info: vi.fn(), error: vi.fn() },
    );
    const payload = {
      phone: "(604) 555-1234",
      message: "My location is 49.2827,-123.1207",
      receivedAt: "2026-08-07T20:15:00Z",
      messageId: "message-1",
    };

    const first = await service.process(payload);
    const second = await service.process(payload);
    expect(first).toMatchObject({
      phoneHash: hashPhoneNumber("+16045551234"),
      duplicate: false,
      historyLength: 1,
      location: { latitude: 49.2827, longitude: -123.1207 },
    });
    expect(second.duplicate).toBe(true);
    expect(store.points).toHaveLength(1);
  });

  it("returns a 422 processing error for messages without coordinates", async () => {
    const service = new LocationProcessingService(
      emailWebhookMessageParser,
      gpsLocationParser,
      { hash: hashPhoneNumber },
      new MemoryStore(),
      { info: vi.fn(), error: vi.fn() },
    );
    await expect(service.process({ phone: "+16045551234", message: "hello" })).rejects.toEqual(
      expect.objectContaining<Partial<ProcessingError>>({ status: 422 }),
    );
  });
});
