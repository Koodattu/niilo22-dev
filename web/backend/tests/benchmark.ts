import { performance } from "node:perf_hooks";
import { configureTestDatabase } from "./support.js";

configureTestDatabase();
if (process.argv.includes("--cold")) process.env.SEARCH_CACHE_MAX_ENTRIES = "0";
const { pool } = await import("../src/db.js");
const { searchVideos } = await import("../src/lib/search.js");
try {
  // Bounded synthetic workload, with IDs reserved for this benchmark.
  await pool.query(`
    INSERT INTO videos (youtube_id, title, normalized_title, published_at)
    SELECT 'bench' || lpad(n::text, 6, '0'), 'Synteettinen mittausvideo', 'mittausvideo', '2024-01-01'::timestamptz
    FROM generate_series(1, 400) AS n ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO transcript_chunks (video_id, chunk_index, start_ms, end_ms, text, normalized_text)
    SELECT 'bench' || lpad(v::text, 6, '0'), c, c * 15000, c * 15000 + 10000,
      CASE WHEN c % 10 = 0 THEN 'mittauskahvi maistuu hyvältä' ELSE 'tänään kävelemme rauhassa ulkona' END,
      CASE WHEN c % 10 = 0 THEN 'mittauskahvi maistuu hyvältä' ELSE 'tänään kävelemme rauhassa ulkona' END
    FROM generate_series(1, 400) AS v CROSS JOIN generate_series(0, 59) AS c
    ON CONFLICT (video_id, chunk_index) DO NOTHING
  `);
  await pool.query("ANALYZE transcript_chunks");
  const initial = await searchVideos("mittauskahvi");
  const durations: number[] = [];
  for (let index = 0; index < 30; index++) {
    const start = performance.now();
    const result = await searchVideos("mittauskahvi");
    if (result.resultCount !== 20) throw new Error("Benchmark did not return the expected 20 videos");
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  console.log(JSON.stringify({ workload: "400 videos / 24,000 chunks / 2,400 matching chunks; PostgreSQL 17.10, 2 CPUs, 512 MiB; 30 sequential searches", cache: process.argv.includes("--cold") ? "disabled (warm database)" : "warm after one cold request", initialMs: initial.tookMs, medianMs: durations[15], p95Ms: durations[28] }, null, 2));
} finally { await pool.end(); }
