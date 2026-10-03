import type { NextRequest } from "next/server";
import { proxyGet } from "../proxy";

export async function GET(request: NextRequest) {
  return proxyGet(request, "/api/search");
}
