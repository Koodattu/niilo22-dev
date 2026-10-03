import type { NextRequest } from "next/server";
import { proxyGet } from "../../../proxy";

export async function GET(request: NextRequest, context: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await context.params;
  return proxyGet(request, `/api/videos/${encodeURIComponent(videoId)}/transcript`);
}
