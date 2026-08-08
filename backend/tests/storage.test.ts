import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonFileLocationStore } from "../src/storage/local.js";
import type { LocationPoint } from "../src/types.js";

function point(id: number): LocationPoint {
  return {
    latitude: 49 + id / 100,
    longitude: -123,
    timestamp: `2026-08-07T20:${String(id).padStart(2, "0")}:00Z`,
    sourceFormat: "decimal_degrees",
    fingerprint: `point-${id}`,
  };
}

describe("JsonFileLocationStore", () => {
  it("creates entries, ignores duplicates, and limits history", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hike-tracker-"));
    const file = path.join(directory, "locations.json");
    const store = new JsonFileLocationStore(file, 2);

    await store.updateLocation("hash", point(1));
    await store.updateLocation("hash", point(2));
    await store.updateLocation("hash", point(2));
    await store.updateLocation("hash", point(3));

    const data = JSON.parse(await readFile(file, "utf8"));
    expect(data.hash.history.map((item: LocationPoint) => item.fingerprint)).toEqual(["point-2", "point-3"]);
    expect(data.hash.lastLocation.fingerprint).toBe("point-3");
  });
});
