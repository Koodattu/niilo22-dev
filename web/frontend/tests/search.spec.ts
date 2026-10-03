import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installYouTubeDouble } from "./youtube";

test.beforeEach(async ({ page }) => {
  await installYouTubeDouble(page);
});

test("keyboard selects the requested timestamp", async ({ page }) => {
  await page.goto("/?q=aamukahvi&autoplay=0");
  const snippet = page.locator(".result-rail-card").first().getByRole("button", { name: /^00:30/ });
  await expect(snippet).toBeVisible();
  await snippet.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
});

test("reloading a selected result retains its timestamp", async ({ page }) => {
  await page.goto("/?q=aamukahvi&autoplay=0");
  await page.locator(".result-rail-card").first().getByRole("button", { name: /^00:30/ }).click();
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
  await page.reload();
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
});

test("autoplay waits for player completion instead of elapsed wall time", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?q=aamukahvi&autoplay=1");
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=0(?:&|$)/);
  await page.clock.fastForward(15_000);
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=0(?:&|$)/);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-player-state", { detail: 2 })));
  await page.clock.fastForward(15_000);
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=0(?:&|$)/);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-player-state", { detail: 0 })));
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
  await page.getByRole("button", { name: "Autoplay päällä" }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-player-state", { detail: 0 })));
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
});

test("unavailable player API keeps native playback and external recovery", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", route => route.abort());
  await page.goto("/?q=aamukahvi&autoplay=0");
  await expect(page.getByRole("status").filter({ hasText: "Videota ei voitu toistaa tässä" })).toBeVisible();
  await expect(page.frameLocator(".stage-video").getByText("Synteettinen testivideo")).toBeVisible();
  await expect(page.getByRole("link", { name: "Avaa YouTubessa" })).toHaveAttribute("href", /youtube\.com\/watch\?v=/);
});

test("shared metadata and preview image preserve the selected moment", async ({ page, request }) => {
  await page.goto("/?result=testvid0001&t=30&autoplay=0");
  await expect(page).toHaveTitle(/Aamukahvi ja päivän suunnitelmat @ 00:30/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /[?&]t=30(?:&|$)/);
  const response = await request.get("/api/og?result=testvid0001&t=30");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  await writeFile("../../work/goal-improvement/evidence/shared-preview.png", await response.body());
});

test("search failure keeps the query and offers recovery without claiming no matches", async ({ page }) => {
  await page.goto("/");
  await page.route("**/api/search?*", route => route.fulfill({ status: 502, body: "unavailable" }));
  await page.locator("#search-query").fill("aamukahvi");
  await page.getByRole("button", { name: "Hae", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Haku ei onnistunut");
  await expect(page.locator("#search-query")).toHaveValue("aamukahvi");
  await expect(page.getByRole("heading", { name: "Ei osumia." })).toHaveCount(0);
  await page.unroute("**/api/search?*");
  await page.getByRole("button", { name: "Yritä uudelleen" }).click();
  await expect(page.locator(".result-rail-card")).toHaveCount(2);
});

test("mobile starts with a labelled search control above the player", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Etsi videoiden puheesta" });
  await expect(input).toBeVisible();
  const inputBounds = await input.boundingBox();
  const playerBounds = await page.locator(".stage-panel").boundingBox();
  expect(inputBounds!.y).toBeLessThan(playerBounds!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("new searches preserve back and forward navigation", async ({ page }) => {
  await page.goto("/?autoplay=0");
  const input = page.getByRole("searchbox", { name: "Etsi videoiden puheesta" });
  await input.fill("aamukahvi");
  await input.press("Enter");
  await expect(page.locator(".result-rail-card")).toHaveCount(2);
  await input.fill("eioleolemassa");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Ei osumia." })).toBeVisible();
  await page.goBack();
  await expect(input).toHaveValue("aamukahvi");
  await expect(page.locator(".result-rail-card")).toHaveCount(2);
  await page.goForward();
  await expect(input).toHaveValue("eioleolemassa");
  await expect(page.getByRole("heading", { name: "Ei osumia." })).toBeVisible();
});

test("a superseded request cannot replace a newer result", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started: () => void = () => {};
  const waiting = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/search?q=aamukahvi", async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto("/?autoplay=0");
  const input = page.getByRole("searchbox");
  await input.fill("aamukahvi");
  await input.press("Enter");
  await waiting;
  await expect(page.getByRole("status").filter({ hasText: "Haetaan osumia" })).toBeVisible();
  await input.fill("eioleolemassa");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Ei osumia." })).toBeVisible();
  release();
  await expect(page.locator(".result-rail-card")).toHaveCount(0);
  await expect(page).toHaveURL(/q=eioleolemassa/);
});

test("shared timestamp, clipboard link and silent video are usable", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?result=testvid0001&t=30&autoplay=0");
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
  await page.getByRole("button", { name: "Jaa tämä luikautus" }).click();
  await expect(page.getByRole("button", { name: "Linkki kopioitu" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).searchParams.get("t")).toBe("30");
  await page.goto(copied.replace("autoplay=1", "autoplay=0"));
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
  await page.getByRole("searchbox").fill("aamukahvi");
  await page.getByRole("button", { name: "Hae", exact: true }).click();
  await expect(page.locator(".result-rail-card")).toHaveCount(2);
  expect(new URL(page.url()).searchParams.has("t")).toBe(false);
  await page.goto("/?result=testvid0003&autoplay=0");
  await expect(page.locator(".stage-video")).toBeVisible();
  await expect(page.getByRole("link", { name: "Avaa YouTubessa" })).toBeVisible();
  await expect(page.getByText("Videolle ei ole puhetekstiosumia.", { exact: false })).toBeVisible();
});

test("missing shared video and invalid query show distinct recovery states", async ({ page }) => {
  await page.goto("/?result=notfound001&autoplay=0");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Jaettua luikautusta ei löytynyt");
  await expect(page.getByRole("heading", { name: "Ei osumia." })).toHaveCount(0);
  await page.getByRole("searchbox").fill("a");
  await page.getByRole("button", { name: "Hae", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("vähintään kaksi");
});

test("desktop and mobile visual evidence", async ({ page }) => {
  await page.goto("/?q=aamukahvi&autoplay=0");
  await expect(page.locator(".result-rail-card")).toHaveCount(2);
  await expect(page.frameLocator(".stage-video").getByText("Synteettinen testivideo")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "../../work/goal-improvement/evidence/after-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: "../../work/goal-improvement/evidence/after-mobile.png", fullPage: true });
});

test("responsive selection, text scaling and analytics remain usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.url().startsWith("http://127.0.0.1:33117/api/") && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  for (const [width, height] of [[320, 740], [768, 1024], [1280, 600]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/?q=aamukahvi&autoplay=0");
    const snippet = page.locator(".result-rail-card").first().getByRole("button", { name: /^00:30/ });
    await snippet.click();
    await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
    await expect(page.frameLocator(".stage-video").getByText("Synteettinen testivideo")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator(".stage-panel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../../work/goal-improvement/evidence/selected-${width}.png` });
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.screenshot({ path: "../../work/goal-improvement/evidence/text-scaling.png" });
  await page.getByRole("link", { name: "Arkiston tilastot" }).click();
  await expect(page.getByRole("heading", { name: "Tilastot", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Yleisimmät haut" })).toBeVisible();
  await page.screenshot({ path: "../../work/goal-improvement/evidence/analytics.png" });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.locator("main").evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "../../work/goal-improvement/evidence/analytics-320.png" });
  await page.getByRole("link", { name: "Takaisin hakuun" }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  expect(errors).toEqual([]);
});
