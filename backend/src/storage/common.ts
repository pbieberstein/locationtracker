import type {
  LocationPoint,
  LocationsData,
  StoreUpdateResult,
} from "../types.js";

export function validateLocationsData(value: unknown): LocationsData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("locations.json must contain a JSON object");
  }
  return value as LocationsData;
}

export function applyLocationUpdate(
  data: LocationsData,
  phoneHash: string,
  location: LocationPoint,
  historyLimit: number,
): StoreUpdateResult {
  const existing = data[phoneHash];
  if (existing?.history.some((point) => point.fingerprint === location.fingerprint)) {
    return { duplicate: true, historyLength: existing.history.length };
  }

  const history = [...(existing?.history ?? []), location].slice(-historyLimit);
  data[phoneHash] = {
    phoneHash,
    lastLocation: location,
    history,
  };
  return { duplicate: false, historyLength: history.length };
}
