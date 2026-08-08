export type SourceFormat =
  | "decimal_degrees"
  | "labeled_decimal"
  | "directional_decimal"
  | "degrees_minutes_seconds"
  | "google_maps_url";

export type LocationParseResult =
  | {
      success: true;
      latitude: number;
      longitude: number;
      sourceFormat: SourceFormat;
    }
  | { success: false; error: string };

export interface NormalizedMessage {
  sender: string;
  subject: string;
  body: string;
  receivedAt: string;
  messageId?: string;
}

export type MessageParseResult =
  | { success: true; message: NormalizedMessage }
  | { success: false; error: string };

export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  sourceFormat: SourceFormat;
  fingerprint: string;
  messageId?: string;
}

export interface PhoneLocations {
  phoneHash: string;
  lastLocation: LocationPoint;
  history: LocationPoint[];
}

export type LocationsData = Record<string, PhoneLocations>;

export interface StoreUpdateResult {
  duplicate: boolean;
  historyLength: number;
}

export interface LocationStore {
  updateLocation(
    phoneHash: string,
    location: LocationPoint,
  ): Promise<StoreUpdateResult>;
}

export interface LocationParser {
  parse(text: string): Promise<LocationParseResult>;
}

export interface MessageParser {
  parse(payload: unknown, messageId?: string): MessageParseResult;
}

export interface PhoneHasher {
  hash(phoneNumber: string): string;
}
