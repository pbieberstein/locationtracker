import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPhoneNumber } from "../src/hashing.js";
import { normalizePhoneNumber } from "../src/phone.js";

describe("normalizePhoneNumber", () => {
  it.each([
    "604-555-1234",
    "(604) 555-1234",
    "+1 604 555 1234",
    "+16045551234",
    "SMS +16045551234 <16045551234@example.com>",
  ])("normalizes %s", (input) => {
    expect(normalizePhoneNumber(input, "CA")).toBe("+16045551234");
  });

  it("rejects invalid phone numbers", () => {
    expect(normalizePhoneNumber("not a phone number", "CA")).toBeNull();
  });
});

describe("hashPhoneNumber", () => {
  it("returns deterministic SHA-256", () => {
    const expected = createHash("sha256").update("+16045551234").digest("hex");
    expect(hashPhoneNumber("+16045551234")).toBe(expected);
    expect(hashPhoneNumber("+16045551234")).toHaveLength(64);
  });
});
