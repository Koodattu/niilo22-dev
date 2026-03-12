import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { config } from "../config.js";
import { searchVideos } from "../lib/search.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Query is required"),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export async function registerSearchRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/search", async (request, reply) => {
    const parsedQuery = searchQuerySchema.safeParse(request.query ?? {});

    if (!parsedQuery.success) {
      reply.code(400);
      return {
        error: "Invalid search query",
        details: parsedQuery.error.flatten(),
      };
    }

    const response = await searchVideos(parsedQuery.data.q, parsedQuery.data.limit ?? config.searchResultLimit, config.snippetLimitPerVideo);

    return response;
  });
}
