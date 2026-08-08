import { createHash } from "node:crypto";
import type { PhoneHasher } from "./types.js";

/**
 * TODO(production): Unsalted SHA-256 is intentionally deterministic for this
 * public MVP, but it is vulnerable to enumeration. Replace it with private,
 * unguessable share IDs and authenticated access before real-world use.
 */
export function hashPhoneNumber(phoneNumber: string): string {
  return createHash("sha256").update(phoneNumber, "utf8").digest("hex");
}

export const sha256PhoneHasher: PhoneHasher = { hash: hashPhoneNumber };
