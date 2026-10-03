import assert from "node:assert/strict";
import { after, test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configureTestDatabase, createFixture } from "./support.js";

configureTestDatabase();
const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db.js");
const app = await createApp();
const fixture = await createFixture();
after(async () => { await app.close(); await pool.end(); await fixture.cleanup(); });

test("imported transcripts with underscore video IDs are searchable", async () => {
  await fixture.import();
  const response = await app.inject("/api/search?q=aamukahvi");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().results.map((result: { videoId: string }) => result.videoId).sort(), ["test_id0002", "testvid0001"]);
});

test("a shared timestamp survives changed transcript imports", async () => {
  const before = (await app.inject("/api/search?q=aamukahvi")).json();
  const video = before.results.find((result: { videoId: string }) => result.videoId === "testvid0001");
  const selected = video.snippets[1];
  assert.equal(selected.startSeconds, 30);
  fixture.videos[0]!.name = "Aamukahvi ja päivitetyt suunnitelmat";
  await writeFile(fixture.videosPath, JSON.stringify({ videos: fixture.videos }));
  await fixture.import();
  const shared = await app.inject(`/api/videos/testvid0001?snippet=${selected.chunkId}&t=30`);
  assert.equal(shared.statusCode, 200);
  assert.equal(shared.json().results[0].snippets[0].startSeconds, 30);
});

test("a running search process sees committed imports without a shared filesystem", async () => {
  const before = (await app.inject("/api/search?q=aamukahvi")).json();
  assert.ok(before.results.length > 0);
  fixture.videos[0]!.name = "Tuore otsikko välimuistin läpi";
  await writeFile(fixture.videosPath, JSON.stringify({ videos: fixture.videos }));
  await fixture.import();
  const afterImport = (await app.inject("/api/search?q=aamukahvi")).json();
  assert.equal(afterImport.results.find((result: { videoId: string }) => result.videoId === "testvid0001").title, "Tuore otsikko välimuistin läpi");
});

test("a failed import preserves the invalid video's data while exposing earlier committed changes", async () => {
  fixture.videos[0]!.name = "Ennen virhettä tallentunut otsikko";
  await writeFile(fixture.videosPath, JSON.stringify({ videos: fixture.videos }));
  await writeFile(join(fixture.outputDir, "1700000000_20231114_test_id0002_fixture.json"), JSON.stringify({ words: [{ word: "virhe", start: 8, end: 2 }] }));
  await assert.rejects(fixture.import());
  const response = (await app.inject("/api/search?q=aamukahvi")).json();
  assert.equal(response.results.find((result: { videoId: string }) => result.videoId === "testvid0001").title, "Ennen virhettä tallentunut otsikko");
  assert.ok(response.results.some((result: { videoId: string }) => result.videoId === "test_id0002"));
});

test("invalid or excessive search input is rejected before searching", async () => {
  for (const q of ["a", "!!!", "x".repeat(201)]) {
    assert.equal((await app.inject(`/api/search?q=${encodeURIComponent(q)}`)).statusCode, 400);
  }
  for (const query of ["snippet=9223372036854775808", "snippet=-1", "snippet=abc", "t=-1", "t=Infinity"]) {
    assert.equal((await app.inject(`/api/videos/testvid0001?${query}`)).statusCode, 400);
  }
});

test("unchanged imports preserve chunk IDs and removed videos leave cached search results", async () => {
  const clean = await createFixture();
  try {
    await clean.import();
    const before = (await app.inject("/api/search?q=aamukahvi&limit=2")).json();
    await clean.import();
    const unchanged = (await app.inject("/api/search?q=aamukahvi&limit=2")).json();
    assert.deepEqual(unchanged.results, before.results);
    assert.equal((await app.inject("/api/search?q=aamukahvi&limit=1")).json().resultCount, 1);
    clean.videos.splice(1, 1);
    await writeFile(clean.videosPath, JSON.stringify({ videos: clean.videos }));
    await clean.import();
    assert.equal((await app.inject("/api/search?q=aamukahvi&limit=2")).json().resultCount, 1);
    assert.equal((await app.inject("/api/videos/test_id0002")).statusCode, 404);
    const analytics = (await app.inject("/api/analytics")).json();
    assert.equal(analytics.summary.totalVideos, 2);
    assert.equal(analytics.summary.ambientVideos, 1);
    assert.equal(analytics.summary.readyVideos, 1);
  } finally { await clean.cleanup(); }
});
