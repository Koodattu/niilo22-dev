import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { backendRoot } from "./support.js";

test("compiled and source startup resolve the same default data and migration paths", async () => {
  const env = { ...process.env };
  for (const key of ["VIDEOS_JSON_PATH", "OUTPUT_DIR", "MIGRATION_PATH"]) delete env[key];
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", "import { config } from './dist/src/config.js'; console.log(JSON.stringify([config.videosJsonPath, config.outputDir, config.migrationPath]))"], { cwd: backendRoot, env });
  assert.deepEqual(JSON.parse(stdout), [resolve(backendRoot, "../../videos.json"), resolve(backendRoot, "../../output"), resolve(backendRoot, "../db/migrations")]);
});
