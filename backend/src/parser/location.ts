import type {
  LocationParser,
  LocationParseResult,
  SourceFormat,
} from "../types.js";

type Coordinates = [number, number];
type ShortUrlResolver = (url: string) => Promise<string | null>;

function rounded(value: number): number {
  return Number(value.toFixed(7));
}

function result(
  latitude: number,
  longitude: number,
  sourceFormat: SourceFormat,
): LocationParseResult {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { success: false, error: "Invalid GPS coordinates" };
  }
  if (latitude < -90 || latitude > 90) {
    return { success: false, error: "Latitude must be between -90 and 90" };
  }
  if (longitude < -180 || longitude > 180) {
    return { success: false, error: "Longitude must be between -180 and 180" };
  }
  return {
    success: true,
    latitude: rounded(latitude),
    longitude: rounded(longitude),
    sourceFormat,
  };
}

function pair(match: RegExpMatchArray): Coordinates {
  return [Number(match.groups?.lat ?? match[1]), Number(match.groups?.lng ?? match[2])];
}

function directionValue(value: number, direction: string): number {
  return /[SW]/i.test(direction) ? -Math.abs(value) : Math.abs(value);
}

function dmsToDecimal(degrees: number, minutes: number, seconds: number): number {
  return degrees + minutes / 60 + seconds / 3600;
}

async function defaultShortUrlResolver(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "satellite-hike-tracker/0.1" },
    });
    return response.url || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export class GpsLocationParser implements LocationParser {
  constructor(private readonly resolveShortUrl: ShortUrlResolver = defaultShortUrlResolver) {}

  async parse(text: string): Promise<LocationParseResult> {
    if (typeof text !== "string" || !text.trim()) {
      return { success: false, error: "No GPS coordinates found" };
    }

    const mapsUrl = text.match(/https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl)[^\s<>]*/i)?.[0];
    if (mapsUrl) {
      const urlResult = await this.parseGoogleMapsUrl(mapsUrl);
      if (urlResult.success) return urlResult;
      if (/maps\.app\.goo\.gl/i.test(mapsUrl)) return urlResult;
    }

    const labeled = text.match(
      /lat(?:itude)?\s*[:=]\s*(?<lat>[+-]?\d{1,3}(?:\.\d+)?)\D+?(?:lng|lon|long|longitude)\s*[:=]\s*(?<lng>[+-]?\d{1,3}(?:\.\d+)?)/i,
    );
    if (labeled) {
      const [latitude, longitude] = pair(labeled);
      return result(latitude, longitude, "labeled_decimal");
    }

    const dms = text.match(
      /(?<latDeg>\d{1,2})\s*[°º]\s*(?<latMin>\d{1,2})\s*['′]\s*(?<latSec>\d{1,2}(?:\.\d+)?)\s*["″]?\s*(?<latDir>[NS])[,\s]+(?<lngDeg>\d{1,3})\s*[°º]\s*(?<lngMin>\d{1,2})\s*['′]\s*(?<lngSec>\d{1,2}(?:\.\d+)?)\s*["″]?\s*(?<lngDir>[EW])/i,
    );
    if (dms?.groups) {
      const latitude = directionValue(
        dmsToDecimal(Number(dms.groups.latDeg), Number(dms.groups.latMin), Number(dms.groups.latSec)),
        dms.groups.latDir,
      );
      const longitude = directionValue(
        dmsToDecimal(Number(dms.groups.lngDeg), Number(dms.groups.lngMin), Number(dms.groups.lngSec)),
        dms.groups.lngDir,
      );
      return result(latitude, longitude, "degrees_minutes_seconds");
    }

    const prefixDirectional = text.match(
      /(?<latDir>[NS])\s*(?<lat>\d{1,2}(?:\.\d+)?)[,\s]+(?<lngDir>[EW])\s*(?<lng>\d{1,3}(?:\.\d+)?)/i,
    );
    if (prefixDirectional?.groups) {
      return result(
        directionValue(Number(prefixDirectional.groups.lat), prefixDirectional.groups.latDir),
        directionValue(Number(prefixDirectional.groups.lng), prefixDirectional.groups.lngDir),
        "directional_decimal",
      );
    }

    const suffixDirectional = text.match(
      /(?<lat>\d{1,2}(?:\.\d+)?)\s*°?\s*(?<latDir>[NS])[,\s]+(?<lng>\d{1,3}(?:\.\d+)?)\s*°?\s*(?<lngDir>[EW])/i,
    );
    if (suffixDirectional?.groups) {
      return result(
        directionValue(Number(suffixDirectional.groups.lat), suffixDirectional.groups.latDir),
        directionValue(Number(suffixDirectional.groups.lng), suffixDirectional.groups.lngDir),
        "directional_decimal",
      );
    }

    const decimal = text.match(
      /(?:^|[^\d.])(?<lat>[+-]?\d{1,3}(?:\.\d+)?)\s*,\s*(?<lng>[+-]?\d{1,3}(?:\.\d+)?)(?![\d.])/,
    );
    if (decimal) {
      const [latitude, longitude] = pair(decimal);
      return result(latitude, longitude, "decimal_degrees");
    }

    return { success: false, error: "No GPS coordinates found" };
  }

  private async parseGoogleMapsUrl(rawUrl: string): Promise<LocationParseResult> {
    let candidate = rawUrl.replace(/[).,;]+$/, "");
    if (/maps\.app\.goo\.gl/i.test(candidate)) {
      const resolved = await this.resolveShortUrl(candidate);
      if (!resolved) {
        return { success: false, error: "Shortened Google Maps URL could not be resolved" };
      }
      candidate = resolved;
    }

    try {
      const url = new URL(candidate);
      const query = url.searchParams.get("q") ?? url.searchParams.get("query");
      const queryMatch = query?.match(/(?<lat>[+-]?\d{1,3}(?:\.\d+)?),\s*(?<lng>[+-]?\d{1,3}(?:\.\d+)?)/);
      const pathMatch = decodeURIComponent(url.pathname).match(
        /@(?<lat>[+-]?\d{1,3}(?:\.\d+)?),(?<lng>[+-]?\d{1,3}(?:\.\d+)?)/,
      );
      const match = queryMatch ?? pathMatch;
      if (match) {
        const [latitude, longitude] = pair(match);
        return result(latitude, longitude, "google_maps_url");
      }
    } catch {
      return { success: false, error: "Invalid Google Maps URL" };
    }

    return { success: false, error: "No GPS coordinates found in Google Maps URL" };
  }
}

export const gpsLocationParser = new GpsLocationParser();
