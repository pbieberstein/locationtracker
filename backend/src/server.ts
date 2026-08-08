import express, { type NextFunction, type Request, type Response } from "express";
import { createLocationStore } from "./config.js";
import { sha256PhoneHasher } from "./hashing.js";
import { gpsLocationParser } from "./parser/location.js";
import { emailWebhookMessageParser } from "./parser/message.js";
import { LocationProcessingService, ProcessingError } from "./service.js";

function log(level: "info" | "error", message: string, details?: Record<string, unknown>): void {
  const record = { level, message, ...(details ?? {}), time: new Date().toISOString() };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else console.log(output);
}

const logger = {
  info: (message: string, details?: Record<string, unknown>) => log("info", message, details),
  error: (message: string, details?: Record<string, unknown>) => log("error", message, details),
};

function authorized(request: Request, secret: string | undefined, header: string): boolean {
  if (!secret) return true;
  const headerValue = request.get(header);
  const bearer = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerValue === secret || bearer === secret;
}

export function createApp(
  service = new LocationProcessingService(
    emailWebhookMessageParser,
    gpsLocationParser,
    sha256PhoneHasher,
    createLocationStore(),
    logger,
  ),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => response.json({ status: "ok" }));

  app.post("/webhook", async (request, response, next) => {
    if (!authorized(request, process.env.WEBHOOK_SECRET, "x-webhook-secret")) {
      return response.status(401).json({ error: "Unauthorized" });
    }

    const deliveryId = request.get("x-email-webhook-id") ?? undefined;
    logger.info("Incoming webhook", { deliveryId });
    const diagnosticMode = process.env.DIAGNOSTIC_MODE ?? "off";
    if (diagnosticMode === "raw") {
      logger.info("DIAGNOSTIC raw payload — disable after first inspection", {
        payload: request.body,
        headers: {
          contentType: request.get("content-type"),
          userAgent: request.get("user-agent"),
          deliveryId,
        },
      });
    } else if (diagnosticMode === "metadata") {
      logger.info("Diagnostic payload metadata", {
        keys:
          request.body && typeof request.body === "object"
            ? Object.keys(request.body as Record<string, unknown>)
            : [],
        deliveryId,
      });
    }

    try {
      const result = await service.process(request.body, deliveryId);
      return response.status(200).json({ status: result.duplicate ? "duplicate" : "ok", ...result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/test-location", async (request, response, next) => {
    const allowedWithoutToken = process.env.NODE_ENV !== "production" && !process.env.TEST_TOKEN;
    if (
      !allowedWithoutToken &&
      (!process.env.TEST_TOKEN || !authorized(request, process.env.TEST_TOKEN, "x-test-token"))
    ) {
      return response.status(401).json({ error: "Unauthorized" });
    }

    const { phone, message, timestamp, messageId } = request.body ?? {};
    if (typeof phone !== "string" || typeof message !== "string") {
      return response.status(400).json({ error: "phone and message must be strings" });
    }

    try {
      const result = await service.process({
        phone,
        message,
        receivedAt: typeof timestamp === "string" ? timestamp : new Date().toISOString(),
        messageId: typeof messageId === "string" ? messageId : undefined,
      });
      return response.status(200).json({ status: result.duplicate ? "duplicate" : "ok", ...result });
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => response.status(404).json({ error: "Not found" }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      return response.status(400).json({ error: "Malformed JSON request body" });
    }
    if (error instanceof ProcessingError) {
      return response.status(error.status).json({ error: error.message });
    }
    logger.error("Request failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return response.status(500).json({ error: "Internal server error" });
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  createApp().listen(port, "0.0.0.0", () => logger.info("Server listening", { port }));
}
