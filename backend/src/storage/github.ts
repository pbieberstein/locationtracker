import type {
  LocationPoint,
  LocationsData,
  LocationStore,
  StoreUpdateResult,
} from "../types.js";
import { applyLocationUpdate, validateLocationsData } from "./common.js";

interface GitHubStorageOptions {
  token: string;
  owner: string;
  repository: string;
  branch?: string;
  filePath?: string;
  historyLimit?: number;
  fetchImplementation?: typeof fetch;
}

interface GitHubFile {
  data: LocationsData;
  sha?: string;
}

export class GitHubStorage implements LocationStore {
  private readonly branch: string;
  private readonly filePath: string;
  private readonly historyLimit: number;
  private readonly request: typeof fetch;

  constructor(private readonly options: GitHubStorageOptions) {
    this.branch = options.branch ?? "main";
    this.filePath = options.filePath ?? "data/locations.json";
    this.historyLimit = options.historyLimit ?? 1_000;
    this.request = options.fetchImplementation ?? fetch;
  }

  async getLocations(): Promise<GitHubFile> {
    const response = await this.request(
      `${this.apiUrl()}?ref=${encodeURIComponent(this.branch)}`,
      { headers: this.headers() },
    );
    if (response.status === 404) return { data: {} };
    if (!response.ok) throw await this.githubError(response, "read locations.json");

    const payload = (await response.json()) as { content?: string; sha?: string };
    if (!payload.content) throw new Error("GitHub response did not include file content");
    try {
      const content = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
      return { data: validateLocationsData(JSON.parse(content)), sha: payload.sha };
    } catch (error) {
      throw new Error("GitHub locations.json contains malformed JSON", { cause: error });
    }
  }

  async updateLocations(data: LocationsData, sha?: string): Promise<void> {
    const body: Record<string, unknown> = {
      message: "Update hiker location",
      content: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8").toString("base64"),
      branch: this.branch,
    };
    if (sha) body.sha = sha;

    const response = await this.request(this.apiUrl(), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await this.githubError(response, "update locations.json");
  }

  async updateLocation(
    phoneHash: string,
    location: LocationPoint,
  ): Promise<StoreUpdateResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const current = await this.getLocations();
      const update = applyLocationUpdate(
        current.data,
        phoneHash,
        location,
        this.historyLimit,
      );
      if (update.duplicate) return update;

      try {
        await this.updateLocations(current.data, current.sha);
        return update;
      } catch (error) {
        lastError = error;
        const status = (error as Error & { status?: number }).status;
        if (status !== 409 && status !== 422) throw error;
      }
    }
    throw new Error("GitHub file changed repeatedly; update failed after 3 attempts", {
      cause: lastError,
    });
  }

  private apiUrl(): string {
    const { owner, repository } = this.options;
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${this.filePath.split("/").map(encodeURIComponent).join("/")}`;
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.options.token}`,
      "Content-Type": "application/json",
      "User-Agent": "satellite-hike-tracker/0.1",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async githubError(response: Response, action: string): Promise<Error> {
    let detail = response.statusText;
    try {
      const payload = (await response.json()) as { message?: string };
      detail = payload.message ?? detail;
    } catch {
      // GitHub occasionally returns an empty/non-JSON error response.
    }
    const error = new Error(`Could not ${action}: GitHub ${response.status} ${detail}`) as Error & {
      status: number;
    };
    error.status = response.status;
    return error;
  }
}
