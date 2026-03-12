import { readdir, readFile } from "node:fs/promises";
import { sep } from "node:path";

import type { PoolClient } from "pg";

import { config } from "../src/config.js";
import { pool, withTransaction } from "../src/db.js";
import { ensureSchema } from "../src/lib/ensure-schema.js";
import { createTranscriptChunks, type TranscriptWord } from "../src/lib/chunk-transcript.js";
import { normalizeSearchText } from "../src/lib/normalize.js";
import { writeSearchDataVersion } from "../src/lib/search-data-version.js";

interface VideoItem {
  id: string;
  name: string;
  publishedAt: string;
  downloaded?: boolean;
}

interface VideosFile {
  lastUpdated: string;
  videos: VideoItem[];
}

interface TranscriptFile {
  file_name?: string;
  youtube_id?: string;
  words?: TranscriptWord[];
}

interface TranscriptLocation {
  filePath: Buffer;
  displayName: string;
}

function extractYoutubeId(filename: Buffer | string): string | null {
  const filenameBuffer = typeof filename === "string" ? Buffer.from(filename) : filename;
  const jsonSuffix = Buffer.from(".json");

  if (filenameBuffer.length <= jsonSuffix.length || !filenameBuffer.subarray(filenameBuffer.length - jsonSuffix.length).equals(jsonSuffix)) {
    return null;
  }

  const baseName = filenameBuffer.subarray(0, filenameBuffer.length - jsonSuffix.length);
  const parts: Buffer[] = [];
  let sliceStart = 0;

  for (let index = 0; index < baseName.length; index += 1) {
    if (baseName[index] !== 0x5f) {
      continue;
    }

    if (index > sliceStart) {
      parts.push(baseName.subarray(sliceStart, index));
    }

    sliceStart = index + 1;
  }

  if (sliceStart < baseName.length) {
    parts.push(baseName.subarray(sliceStart));
  }

  if (parts.length < 3) {
    return null;
  }

  return parts[2]?.toString("utf8") ?? null;
}

async function readVideosFile(): Promise<VideosFile> {
  const raw = await readFile(config.videosJsonPath, "utf8");
  return JSON.parse(raw) as VideosFile;
}

async function buildTranscriptIndex(): Promise<Map<string, TranscriptLocation>> {
  const entries = await readdir(config.outputDir, { encoding: "buffer", withFileTypes: true });
  const transcriptIndex = new Map<string, TranscriptLocation>();
  const outputDirPrefix = Buffer.from(`${config.outputDir}${sep}`);

  for (const entry of entries) {
    if (!entry.isFile() || !Buffer.isBuffer(entry.name) || !entry.name.subarray(Math.max(0, entry.name.length - 5)).equals(Buffer.from(".json"))) {
      continue;
    }

    const youtubeId = extractYoutubeId(entry.name);
    if (youtubeId) {
      transcriptIndex.set(youtubeId, {
        filePath: Buffer.concat([outputDirPrefix, entry.name]),
        displayName: entry.name.toString("utf8"),
      });
    }
  }

  return transcriptIndex;
}

async function readTranscript(path: Buffer): Promise<TranscriptFile> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as TranscriptFile;
}

async function upsertVideo(client: PoolClient, video: VideoItem, transcriptWordCount: number, transcriptStatus: string, localFileName: string | null): Promise<void> {
  await client.query(
    `
      INSERT INTO videos (
        youtube_id,
        title,
        normalized_title,
        published_at,
        downloaded,
        local_file_name,
        transcript_word_count,
        transcript_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (youtube_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        normalized_title = EXCLUDED.normalized_title,
        published_at = EXCLUDED.published_at,
        downloaded = EXCLUDED.downloaded,
        local_file_name = EXCLUDED.local_file_name,
        transcript_word_count = EXCLUDED.transcript_word_count,
        transcript_status = EXCLUDED.transcript_status,
        updated_at = NOW()
    `,
    [video.id, video.name, normalizeSearchText(video.name), video.publishedAt, video.downloaded ?? false, localFileName, transcriptWordCount, transcriptStatus],
  );
}

async function replaceChunks(client: PoolClient, videoId: string, chunks: ReturnType<typeof createTranscriptChunks>): Promise<void> {
  await client.query("DELETE FROM transcript_chunks WHERE video_id = $1", [videoId]);

  if (chunks.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const placeholders = chunks.map((chunk, index) => {
    const offset = index * 7;
    values.push(videoId, chunk.chunkIndex, chunk.startMs, chunk.endMs, chunk.text, chunk.normalizedText, JSON.stringify(chunk.wordsJson));

    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::jsonb)`;
  });

  await client.query(
    `
      INSERT INTO transcript_chunks (
        video_id,
        chunk_index,
        start_ms,
        end_ms,
        text,
        normalized_text,
        words_json
      ) VALUES ${placeholders.join(",")}
    `,
    values,
  );
}

async function importAllVideos(): Promise<void> {
  await ensureSchema();
  const videosFile = await readVideosFile();
  const transcriptIndex = await buildTranscriptIndex();

  console.log(`Preparing import for ${videosFile.videos.length} videos`);

  let processed = 0;
  let totalChunks = 0;

  for (const video of videosFile.videos) {
    const transcriptLocation = transcriptIndex.get(video.id);
    const transcript = transcriptLocation ? await readTranscript(transcriptLocation.filePath) : null;
    const words = transcript?.words ?? [];
    const chunks = createTranscriptChunks(words);
    const transcriptStatus = transcriptLocation ? (words.length > 0 ? "ready" : "ambient") : "missing";
    const localFileName = transcript?.file_name ?? transcriptLocation?.displayName ?? null;

    await withTransaction(async (client) => {
      await upsertVideo(client, video, words.length, transcriptStatus, localFileName);
      await replaceChunks(client, video.id, chunks);
    });

    processed += 1;
    totalChunks += chunks.length;

    if (processed % 100 === 0 || processed === videosFile.videos.length) {
      console.log(`Imported ${processed}/${videosFile.videos.length} videos, ${totalChunks} chunks so far`);
    }
  }

  await writeSearchDataVersion();
  console.log(`Import complete: ${processed} videos, ${totalChunks} transcript chunks`);
}

try {
  await importAllVideos();
} catch (error) {
  console.error("Import failed", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
