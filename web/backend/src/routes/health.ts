import type { FastifyInstance } from "fastify";

import { query } from "../db.js";

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    const result = await query<{ now: string }>("SELECT NOW()::text AS now");
    return {
      ok: true,
      databaseTime: result.rows[0]?.now ?? null,
    };
  });
}
