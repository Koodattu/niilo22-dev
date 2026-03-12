import { readFile } from "node:fs/promises";

import { config } from "../config.js";
import { pool } from "../db.js";

export async function ensureSchema(): Promise<void> {
  const migrationSql = await readFile(config.migrationPath, "utf8");
  await pool.query(migrationSql);
}
