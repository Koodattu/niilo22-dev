import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { loadAnalytics } from "../lib/analytics.js";

const analyticsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export async function registerAnalyticsRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/analytics", async (request, reply) => {
    const parsedQuery = analyticsQuerySchema.safeParse(request.query ?? {});

    if (!parsedQuery.success) {
      reply.code(400);
      return {
        error: "Invalid analytics query",
        details: parsedQuery.error.flatten(),
      };
    }

    return loadAnalytics(parsedQuery.data.limit ?? 12);
  });
}
