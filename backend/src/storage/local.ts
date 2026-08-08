import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  LocationPoint,
  LocationsData,
  LocationStore,
  StoreUpdateResult,
} from "../types.js";
import { applyLocationUpdate, validateLocationsData } from "./common.js";

export class JsonFileLocationStore implements LocationStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly historyLimit = 1_000,
  ) {}

  updateLocation(phoneHash: string, location: LocationPoint): Promise<StoreUpdateResult> {
    const operation = this.queue.then(() => this.performUpdate(phoneHash, location));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async performUpdate(
    phoneHash: string,
    location: LocationPoint,
  ): Promise<StoreUpdateResult> {
    const data = await this.getLocations();
    const update = applyLocationUpdate(data, phoneHash, location, this.historyLimit);
    if (update.duplicate) return update;

    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
    return update;
  }

  async getLocations(): Promise<LocationsData> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return validateLocationsData(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      if (error instanceof SyntaxError) {
        throw new Error(`Malformed JSON in ${this.filePath}`, { cause: error });
      }
      throw error;
    }
  }
}
