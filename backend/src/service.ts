import { createHash } from "node:crypto";
import type {
  LocationParser,
  LocationPoint,
  LocationStore,
  MessageParser,
  PhoneHasher,
} from "./types.js";
import { maskPhoneNumber } from "./phone.js";

export class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface ProcessingResult {
  phoneHash: string;
  location: { latitude: number; longitude: number; timestamp: string };
  duplicate: boolean;
  historyLength: number;
}

interface Logger {
  info(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export class LocationProcessingService {
  constructor(
    private readonly messages: MessageParser,
    private readonly locations: LocationParser,
    private readonly hasher: PhoneHasher,
    private readonly store: LocationStore,
    private readonly logger: Logger = console,
  ) {}

  async process(payload: unknown, deliveryId?: string): Promise<ProcessingResult> {
    const parsedMessage = this.messages.parse(payload, deliveryId);
    if (!parsedMessage.success) throw new ProcessingError(parsedMessage.error, 400);
    const message = parsedMessage.message;
    this.logger.info("Sender detected", { sender: maskPhoneNumber(message.sender) });

    const parsedLocation = await this.locations.parse(message.body);
    if (!parsedLocation.success) throw new ProcessingError(parsedLocation.error, 422);

    this.logger.info("GPS detected", {
      latitude: parsedLocation.latitude,
      longitude: parsedLocation.longitude,
      sourceFormat: parsedLocation.sourceFormat,
    });
    const phoneHash = this.hasher.hash(message.sender);
    this.logger.info("Phone hash created", { phoneHash: `${phoneHash.slice(0, 10)}…` });

    const fingerprint = createHash("sha256")
      .update(
        [
          phoneHash,
          parsedLocation.latitude,
          parsedLocation.longitude,
          message.messageId ?? `${message.receivedAt}|${message.subject}|${message.body.trim()}`,
        ].join("|"),
      )
      .digest("hex");

    const point: LocationPoint = {
      latitude: parsedLocation.latitude,
      longitude: parsedLocation.longitude,
      timestamp: message.receivedAt,
      sourceFormat: parsedLocation.sourceFormat,
      fingerprint,
      ...(message.messageId ? { messageId: message.messageId } : {}),
    };

    this.logger.info("Updating location store");
    const update = await this.store.updateLocation(phoneHash, point);
    this.logger.info(update.duplicate ? "Duplicate location ignored" : "Location store updated", {
      historyLength: update.historyLength,
    });

    return {
      phoneHash,
      location: {
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: point.timestamp,
      },
      ...update,
    };
  }
}
