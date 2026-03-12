import cors from "@fastify/cors";
import fastify, { type FastifyInstance } from "fastify";

import { getCorsOrigins } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerSearchRoute } from "./routes/search.js";

export async function createApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: getCorsOrigins(),
  });

  await registerHealthRoute(app);
  await registerSearchRoute(app);

  return app;
}
