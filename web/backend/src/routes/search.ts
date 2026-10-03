import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { config } from "../config.js";
import { recordSearchQuery } from "../lib/analytics.js";
import { loadSharedVideo, searchVideos } from "../lib/search.js";
import { normalizeSearchText } from "../lib/normalize.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200).refine((value) => normalizeSearchText(value).replace(/\s/g, "").length >= 2, "Query needs at least two letters or digits"),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

const sharedVideoParamsSchema = z.object({
  videoId: z.string().trim().min(1, "Video id is required"),
});

const sharedVideoQuerySchema = z.object({
  snippet: z.string().refine((value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n, "Invalid snippet id").optional(),
  t: z.coerce.number().min(0).max(2_147_483).optional(),
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

    void recordSearchQuery(parsedQuery.data.q, response.resultCount, response.tookMs).catch((error: unknown) => {
      app.log.warn({ error }, "Failed to record search query analytics");
    });

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

    const response = await loadSharedVideo(parsedParams.data.videoId, parsedQuery.data.snippet ?? null, parsedQuery.data.t ?? null);

    if (!response) {
      reply.code(404);
      return {
        error: "Video not found",
      };
    }

    return response;
  });
}
