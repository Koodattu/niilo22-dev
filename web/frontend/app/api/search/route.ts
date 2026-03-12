import { NextRequest, NextResponse } from "next/server";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function GET(request: NextRequest) {
  const queryString = request.nextUrl.searchParams.toString();
  const targetUrl = `${backendUrl}/api/search${queryString ? `?${queryString}` : ""}`;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = await response.text();

    return new NextResponse(payload, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: "Backend search service is unavailable.",
      },
      {
        status: 502,
      },
    );
  }
}
