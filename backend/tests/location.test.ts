import { describe, expect, it, vi } from "vitest";
import { GpsLocationParser } from "../src/parser/location.js";

const parser = new GpsLocationParser();

describe("GpsLocationParser", () => {
  it.each([
    ["49.2827,-123.1207", 49.2827, -123.1207, "decimal_degrees"],
    ["49.2827, -123.1207", 49.2827, -123.1207, "decimal_degrees"],
    ["Location: 49.2827, -123.1207", 49.2827, -123.1207, "decimal_degrees"],
    ["Lat: 49.2827\nLng: -123.1207", 49.2827, -123.1207, "labeled_decimal"],
    ["Latitude: 49.2827\nLongitude: -123.1207", 49.2827, -123.1207, "labeled_decimal"],
    ["N 49.2827 W 123.1207", 49.2827, -123.1207, "directional_decimal"],
    ["S 33.8688 E 151.2093", -33.8688, 151.2093, "directional_decimal"],
    ["49.2827 N 123.1207 W", 49.2827, -123.1207, "directional_decimal"],
    ["https://maps.google.com/?q=49.2827,-123.1207", 49.2827, -123.1207, "google_maps_url"],
    ["https://www.google.com/maps?q=49.2827,-123.1207", 49.2827, -123.1207, "google_maps_url"],
    ["https://www.google.com/maps/@49.2827,-123.1207,14z", 49.2827, -123.1207, "google_maps_url"],
  ])("parses %s", async (input, latitude, longitude, sourceFormat) => {
    await expect(parser.parse(input)).resolves.toEqual({
      success: true,
      latitude,
      longitude,
      sourceFormat,
    });
  });

  it("parses degrees/minutes/seconds", async () => {
    const parsed = await parser.parse(`49°16'57.7"N 123°07'14.5"W`);
    expect(parsed).toEqual({
      success: true,
      latitude: 49.2826944,
      longitude: -123.1206944,
      sourceFormat: "degrees_minutes_seconds",
    });
  });

  it("resolves a shortened Google Maps URL", async () => {
    const resolver = vi.fn().mockResolvedValue("https://www.google.com/maps?q=49.2827,-123.1207");
    const shortParser = new GpsLocationParser(resolver);
    const parsed = await shortParser.parse("https://maps.app.goo.gl/example");
    expect(resolver).toHaveBeenCalledOnce();
    expect(parsed).toMatchObject({ success: true, latitude: 49.2827, longitude: -123.1207 });
  });

  it("reports shortened URL resolution failure", async () => {
    const shortParser = new GpsLocationParser(vi.fn().mockResolvedValue(null));
    await expect(shortParser.parse("https://maps.app.goo.gl/example")).resolves.toEqual({
      success: false,
      error: "Shortened Google Maps URL could not be resolved",
    });
  });

  it.each([
    ["91,20", "Latitude must be between -90 and 90"],
    ["50,181", "Longitude must be between -180 and 180"],
    ["-91.2,20", "Latitude must be between -90 and 90"],
    ["hello world", "No GPS coordinates found"],
    ["", "No GPS coordinates found"],
  ])("rejects %s", async (input, error) => {
    await expect(parser.parse(input)).resolves.toEqual({ success: false, error });
  });
});
