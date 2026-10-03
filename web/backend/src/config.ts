import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));
// Source runs from src/, compiled startup from dist/src/.
const backendRoot = resolve(sourceDir, basename(dirname(sourceDir)) === "dist" ? "../.." : "..");
const webRoot = resolve(backendRoot, "..");
const repoRoot = resolve(webRoot, "..");

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: numberFromEnv(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://niilo22:niilo22@localhost:5432/niilo22",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  videosJsonPath: process.env.VIDEOS_JSON_PATH ?? resolve(repoRoot, "videos.json"),
  outputDir: process.env.OUTPUT_DIR ?? resolve(repoRoot, "output"),
  migrationPath: process.env.MIGRATION_PATH ?? resolve(webRoot, "db", "migrations"),
  searchResultLimit: numberFromEnv(process.env.SEARCH_RESULT_LIMIT, 20),
  snippetLimitPerVideo: numberFromEnv(process.env.SNIPPET_LIMIT_PER_VIDEO, 4),
  searchCacheMaxEntries: numberFromEnv(process.env.SEARCH_CACHE_MAX_ENTRIES, 250),
};

export function getCorsOrigins(): true | string[] {
  if (config.corsOrigin === "*") {
    return true;
  }

  return config.corsOrigin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
