import type { PoolClient } from "pg";
import { query } from "../db.js";

export async function readSearchDataVersion(): Promise<string> {
  const { rows } = await query<{ revision: string }>("SELECT revision FROM search_data_revision WHERE singleton = TRUE");
  if (!rows[0]) throw new Error("Search data revision is missing; apply database migrations.");
  return rows[0].revision;
}

export async function writeSearchDataVersion(client: PoolClient): Promise<void> {
  await client.query("UPDATE search_data_revision SET revision = revision + 1 WHERE singleton = TRUE");
}
