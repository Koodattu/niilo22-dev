import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";

let backend: Server;
let frontend: ChildProcess;
let frontendUrl: string;
test.beforeAll(async () => {
  // Dedicated local HTTP server represents an unavailable/malformed upstream.
  backend = createServer((request, response) => {
    if (request.url?.includes("q=hang")) return;
    if (request.url?.startsWith("/api/videos/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("invalid json");
      return;
    }
    response.writeHead(503, { "content-type": "application/json" });
    response.end('{"error":"test upstream unavailable"}');
  });
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  process.env.BACKEND_URL = `http://127.0.0.1:${address.port}`;
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const frontendAddress = probe.address();
  if (!frontendAddress || typeof frontendAddress === "string") throw new Error("Missing frontend port");
  await new Promise<void>(resolve => probe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${frontendAddress.port}`;
  frontend = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(frontendAddress.port)], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore", windowsHide: true,
  });
  await expect.poll(async () => {
    try { return (await fetch(`${frontendUrl}/api/search?q=ready`)).status; } catch { return 0; }
  }).toBe(503);
});
test.afterAll(async () => {
  backend.closeAllConnections();
  frontend?.kill();
  await new Promise<void>(resolve => backend.close(() => resolve()));
});

test("search proxy bounds a stalled upstream request", async () => {
  const { GET } = await import("../app/api/search/route");
  const response = await Promise.race([
    GET(new NextRequest("http://localhost/api/search?q=hang")),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Proxy still waiting after 12 seconds")), 12_000)),
  ]);
  expect(response.status).toBe(504);
});

test("analytics failure renders recovery instead of crashing the page", async ({ page }) => {
  await page.goto(`${frontendUrl}/analytics`);
  await expect(page.getByRole("heading", { name: "Tilastoja ei voitu ladata" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Yritä uudelleen" })).toHaveAttribute("href", "/analytics");
  await expect(page.getByRole("link", { name: "Takaisin hakuun" })).toHaveAttribute("href", "/");
  await page.screenshot({ path: "../../work/goal-improvement/evidence/analytics-error.png" });
});

test("malformed shared preview data falls back without breaking page metadata", async () => {
  const { getSharedVideoPreviewData } = await import("../app/share-metadata");
  expect(await getSharedVideoPreviewData("testvid0001")).toBeNull();
});
