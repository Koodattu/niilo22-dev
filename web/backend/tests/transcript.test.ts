import assert from "node:assert/strict";
import { after, test } from "node:test";
import { configureTestDatabase, createFixture } from "./support.js";

configureTestDatabase();
const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db.js");
const fixture = await createFixture();
await fixture.import();
const app = await createApp();
after(async () => { await app.close(); await pool.end(); await fixture.cleanup(); });

test("transcript ranges return word timings across chunks, including surrounding speech", async () => {
  const response = await app.inject("/api/videos/testvid0001/transcript?start=3.8&end=31.2");
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    videoId: "testvid0001",
    startMs: 3800,
    endMs: 31200,
    words: fixture.words
      .map(({ word, start, end }) => ({ word, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) }))
      .filter(word => word.endMs > 3800 && word.startMs < 31200),
  });
  assert.ok(response.json().words.some((word: { word: string }) => word.word === "päivä."));
});

test("empty speech and missing videos are distinct; transcript ranges are bounded", async () => {
  for (const videoId of ["testvid0003", "test_id0002"]) {
    const response = await app.inject(`/api/videos/${videoId}/transcript?start=10&end=20`);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().words, []);
  }
  assert.equal((await app.inject("/api/videos/notfound001/transcript?start=0&end=60")).statusCode, 404);
  for (const range of ["", "start=-1&end=10", "start=10&end=10", "start=20&end=10", "start=0&end=121", "start=Infinity&end=10", "start=2147480&end=2147484"]) {
    assert.equal((await app.inject(`/api/videos/testvid0001/transcript?${range}`)).statusCode, 400, range);
  }
});
