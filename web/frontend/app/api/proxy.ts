import { NextRequest, NextResponse } from "next/server";

// Both browser endpoints preserve upstream statuses and bound stalled requests.
export async function proxyGet(request: NextRequest, path: string) {
  const target = new URL(path, process.env.BACKEND_URL ?? "http://localhost:4000");
  target.search = request.nextUrl.search;
  try {
    const response = await fetch(target, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({ error: timedOut ? "Backend request timed out." : "Backend service is unavailable." }, { status: timedOut ? 504 : 502 });
  }
}
