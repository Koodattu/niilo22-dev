import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { config } from "../config.js";
import { recordSearchQuery } from "../lib/analytics.js";
import { loadSharedVideo, searchVideos } from "../lib/search.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Query is required"),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

const sharedVideoParamsSchema = z.object({
  videoId: z.string().trim().min(1, "Video id is required"),
});

const sharedVideoQuerySchema = z.object({
  snippet: z.coerce.number().int().positive().optional(),
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

    try {
      await recordSearchQuery(parsedQuery.data.q);
    } catch (error) {
      app.log.warn({ error }, "Failed to record search query analytics");
    }

    return response;
  });

  app.get("/api/videos/:videoId", async (request, reply) => {
    const parsedParams = sharedVideoParamsSchema.safeParse(request.params ?? {});
    const parsedQuery = sharedVideoQuerySchema.safeParse(request.query ?? {});

    if (!parsedParams.success || !parsedQuery.success) {
      reply.code(400);
      return {
        error: "Invalid video request",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          query: parsedQuery.success ? undefined : parsedQuery.error.flatten(),
        },
      };
    }

    const response = await loadSharedVideo(parsedParams.data.videoId, parsedQuery.data.snippet ?? null);

    if (!response) {
      reply.code(404);
      return {
        error: "Video not found",
      };
    }

    return response;
  });
}
