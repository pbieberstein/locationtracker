import path from "node:path";
import type { LocationStore } from "./types.js";
import { GitHubStorage } from "./storage/github.js";
import { JsonFileLocationStore } from "./storage/local.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function createLocationStore(): LocationStore {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repository = process.env.GITHUB_REPOSITORY;
  const historyLimit = positiveInteger(process.env.HISTORY_LIMIT, 1_000);

  if (token || owner || repository) {
    if (!token || !owner || !repository) {
      throw new Error(
        "GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPOSITORY must all be set together",
      );
    }
    return new GitHubStorage({
      token,
      owner,
      repository,
      branch: process.env.GITHUB_BRANCH ?? "main",
      historyLimit,
    });
  }

  const filePath = path.resolve(
    process.cwd(),
    process.env.DATA_FILE_PATH ?? "../data/locations.json",
  );
  return new JsonFileLocationStore(filePath, historyLimit);
}
