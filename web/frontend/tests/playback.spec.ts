import { expect, test } from "@playwright/test";
import { installYouTubeDouble, setVideoTime } from "./youtube";

test.beforeEach(async ({ page }) => { await installYouTubeDouble(page); });

test("nearby hits stay separate and play continuously; distant hits still advance", async ({ page }) => {
  let videoLoads = 0;
  page.on("request", request => { if (request.url().startsWith("https://www.youtube.com/embed/")) videoLoads++; });
  await page.goto("/?q=luikautus&autoplay=1");
  const first = page.locator(".result-rail-card").getByRole("button", { name: /^09:32/ });
  const second = page.locator(".result-rail-card").getByRole("button", { name: /^09:37/ });
  const distant = page.locator(".result-rail-card").getByRole("button", { name: /^10:20/ });
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toBeVisible();
  await setVideoTime(page, 577.1);
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await setVideoTime(page, 582.5);
  await expect(second).toHaveAttribute("aria-pressed", "true");
  expect(videoLoads).toBe(1);
  await setVideoTime(page, 587.2);
  await expect(distant).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=617(?:&|$)/);
  expect(videoLoads).toBe(2);
});

test("subtitles track words, pauses and seeks without changing the video", async ({ page }) => {
  await page.goto("/?result=testvid0001&t=30&autoplay=0");
  await expect(page.locator(".stage-video")).toBeVisible();
  await setVideoTime(page, 30.45);
  const spoken = page.locator(".video-subtitle__word--spoken");
  await expect(spoken).toHaveText("on");
  await setVideoTime(page, 30.45, 2);
  await page.clock.install();
  await page.clock.fastForward(15_000);
  await expect(spoken).toHaveText("on");
  await setVideoTime(page, 31.25, 2);
  await expect(spoken).toHaveText("aamukahvi");
  await setVideoTime(page, 60.05, 2);
  await expect(spoken).toHaveText("Kolmas");
  await setVideoTime(page, 30.05, 2);
  await expect(spoken).toHaveText("Nyt");
  await page.getByRole("button", { name: "Tekstitys päällä" }).click();
  await expect(page.getByLabel("Videon tekstitys")).toHaveCount(0);
  await page.getByRole("button", { name: "Tekstitys pois" }).click();
  await expect(spoken).toHaveText("Nyt");
});

test("slow player and buffering have subtle loading feedback with reduced motion", async ({ page }) => {
  await installYouTubeDouble(page, 1500);
  await page.goto("/?result=testvid0001&t=30&autoplay=0");
  const loading = page.getByRole("status").filter({ hasText: "Ladataan videota" });
  await expect(loading).toBeVisible();
  await expect(page.locator(".stage-video")).toBeVisible();
  await expect(page.locator(".video-loading__spinner")).toHaveCSS("animation-name", "none");
  await expect(loading).toHaveCount(0);
  await setVideoTime(page, 30, 3);
  await expect(loading).toBeVisible();
  await setVideoTime(page, 30, 1);
  await expect(loading).toHaveCount(0);
});

test("autoplay can be toggled between nearby hits without a reload or unwanted advance", async ({ page }) => {
  await page.goto("/?q=luikautus&autoplay=1");
  await setVideoTime(page, 575);
  const source = await page.locator(".stage-video").getAttribute("src");
  await page.getByRole("button", { name: "Autoplay päällä" }).click();
  await setVideoTime(page, 582.2);
  await expect(page.locator(".result-rail-card").getByRole("button", { name: /^09:32/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Autoplay pois" }).click();
  await expect(page.locator(".result-rail-card").getByRole("button", { name: /^09:37/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".stage-video")).toHaveAttribute("src", source!);
  await setVideoTime(page, 573, 2);
  await expect(page.locator(".result-rail-card").getByRole("button", { name: /^09:32/ })).toHaveAttribute("aria-pressed", "true");
  await setVideoTime(page, 587.2, 3);
  await expect(page.locator(".result-rail-card").getByRole("button", { name: /^10:20/ })).toHaveAttribute("aria-pressed", "false");
  await setVideoTime(page, 587.2, 1);
  await expect(page.locator(".result-rail-card").getByRole("button", { name: /^10:20/ })).toHaveAttribute("aria-pressed", "true");
});

test("transcript failure is recoverable and silence has no stale subtitles", async ({ page }) => {
  await page.route("**/api/videos/*/transcript?*", route => route.fulfill({ status: 502, body: "unavailable" }));
  await page.goto("/?result=testvid0001&t=30&autoplay=0");
  await expect(page.getByText("Tekstitystä ei voitu ladata.", { exact: false })).toBeVisible();
  await page.unroute("**/api/videos/*/transcript?*");
  await page.getByRole("button", { name: "Yritä uudelleen" }).click();
  await setVideoTime(page, 30.45);
  await expect(page.locator(".video-subtitle__word--spoken")).toHaveText("on");
  await setVideoTime(page, 45, 2);
  await expect(page.getByLabel("Videon tekstitys")).toBeEmpty();
  await page.goto("/?result=testvid0003&autoplay=0");
  await expect(page.getByLabel("Videon tekstitys")).toBeEmpty();
});

test("enabling autoplay after a clip finishes advances to the next distant hit", async ({ page }) => {
  await page.goto("/?q=aamukahvi&autoplay=0");
  await page.locator(".result-rail-card").first().getByRole("button", { name: /^00:00/ }).click();
  await setVideoTime(page, 10.2);
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=0(?:&|$)/);
  await page.getByRole("button", { name: "Autoplay pois" }).click();
  await expect(page.locator(".stage-video")).toHaveAttribute("src", /start=27(?:&|$)/);
});

test("subtitles overlay the video above its controls and loading is centered inside it", async ({ page }) => {
  await page.goto("/?q=luikautus&autoplay=1");
  await setVideoTime(page, 577.45);
  await expect(page.locator(".video-subtitle__word--spoken")).toHaveText("luikautus");
  await expect(page.frameLocator(".stage-video").getByText("Synteettinen testivideo")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const frame = await page.locator(".stage-video").boundingBox();
    const caption = await page.getByLabel("Videon tekstitys").boundingBox();
    const player = await page.locator(".video-player").boundingBox();
    expect(frame!.height).toBeGreaterThanOrEqual(200);
    expect(caption!.y).toBeGreaterThan(frame!.y);
    expect(caption!.y + caption!.height).toBeLessThanOrEqual(frame!.y + frame!.height - 44);
    expect(caption!.x).toBeGreaterThanOrEqual(frame!.x);
    expect(caption!.x + caption!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
    expect(Math.abs(player!.height - frame!.height)).toBeLessThan(1);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches("iframe.stage-video"), {
      x: caption!.x + caption!.width / 2, y: caption!.y + caption!.height / 2,
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width !== 320) await page.screenshot({ path: `../../work/player-overlays/evidence/${width === 1440 ? "desktop" : "mobile"}-subtitles.png`, fullPage: true });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const scaledFrame = await page.locator(".stage-video").boundingBox();
  const scaledCaption = await page.getByLabel("Videon tekstitys").boundingBox();
  expect(scaledCaption!.y).toBeGreaterThanOrEqual(scaledFrame!.y);
  expect(scaledCaption!.y + scaledCaption!.height).toBeLessThanOrEqual(scaledFrame!.y + scaledFrame!.height - 44);
  await page.locator(".video-player").screenshot({ path: "../../work/player-overlays/evidence/mobile-subtitles-scaled.png" });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.locator(".video-player").scrollIntoViewIfNeeded();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setVideoTime(page, 577.45, 3);
  await expect(page.locator(".video-loading__spinner")).toHaveCSS("animation-name", "search-button-spin");
  const frame = await page.locator(".stage-video").boundingBox();
  const spinner = await page.locator(".video-loading__spinner").boundingBox();
  expect(Math.abs(spinner!.x + spinner!.width / 2 - frame!.x - frame!.width / 2)).toBeLessThan(2);
  expect(Math.abs(spinner!.y + spinner!.height / 2 - frame!.y - frame!.height / 2)).toBeLessThan(40);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches("iframe.stage-video"), {
    x: spinner!.x + spinner!.width / 2, y: spinner!.y + spinner!.height / 2,
  })).toBe(true);
  await page.screenshot({ path: "../../work/player-overlays/evidence/mobile-loading.png", fullPage: true });
});
