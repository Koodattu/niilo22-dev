import { query } from "../db.js";
import type { ChunkWord } from "./chunk-transcript.js";

export async function loadTranscriptRange(videoId: string, startMs: number, endMs: number) {
  const { rows } = await query<{ words_json: ChunkWord[] | null }>(`
    SELECT c.words_json
    FROM videos v
    LEFT JOIN transcript_chunks c ON c.video_id = v.youtube_id
      AND c.start_ms < $3 AND c.end_ms > $2
    WHERE v.youtube_id = $1
    ORDER BY c.start_ms, c.chunk_index
  `, [videoId, startMs, endMs]);

  if (rows.length === 0) return null;
  const words = rows.flatMap(row => row.words_json ?? [])
    .filter(word => word.startMs < endMs && word.endMs > startMs)
    .sort((left, right) => left.startMs - right.startMs);
  return { videoId, startMs, endMs, words };
}
