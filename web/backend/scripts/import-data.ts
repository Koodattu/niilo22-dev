import { readdir, readFile, stat } from "node:fs/promises";
import { sep } from "node:path";
import { createHash } from "node:crypto";

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

interface VideosFilePayload {
  raw: string;
  parsed: VideosFile;
}

interface TranscriptFile {
  file_name?: string;
  youtube_id?: string;
  words?: TranscriptWord[];
}

interface TranscriptLocation {
  filePath: Buffer;
  displayName: string;
  size: number;
  modifiedAtMs: number;
}

interface ImportStateRow {
  source_signature: string;
  video_count: number | string;
  transcript_file_count: number | string;
}

const IMPORT_JOB_NAME = "full-import";

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

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function readVideosFile(): Promise<VideosFilePayload> {
  const raw = await readFile(config.videosJsonPath, "utf8");
  return {
    raw,
    parsed: JSON.parse(raw) as VideosFile,
  };
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
      const filePath = Buffer.concat([outputDirPrefix, entry.name]);
      const fileStats = await stat(filePath);

      transcriptIndex.set(youtubeId, {
        filePath,
        displayName: entry.name.toString("utf8"),
        size: fileStats.size,
        modifiedAtMs: fileStats.mtimeMs,
      });
    }
  }

  return transcriptIndex;
}

function buildImportSourceSignature(videosFileRaw: string, transcriptIndex: Map<string, TranscriptLocation>): string {
  const hash = createHash("sha256");
  hash.update(videosFileRaw);

  for (const [youtubeId, transcriptLocation] of [...transcriptIndex.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    hash.update("\n");
    hash.update(youtubeId);
    hash.update("|");
    hash.update(transcriptLocation.displayName);
    hash.update("|");
    hash.update(String(transcriptLocation.size));
    hash.update("|");
    hash.update(String(Math.round(transcriptLocation.modifiedAtMs)));
  }

  return hash.digest("hex");
}

async function readImportState(): Promise<ImportStateRow | null> {
  const { rows } = await pool.query<ImportStateRow>(
    `
      SELECT source_signature, video_count, transcript_file_count
      FROM import_state
      WHERE job_name = $1
      LIMIT 1
    `,
    [IMPORT_JOB_NAME],
  );

  return rows[0] ?? null;
}

async function countImportedVideos(): Promise<number> {
  const { rows } = await pool.query<{ video_count: number | string }>(`SELECT COUNT(*) AS video_count FROM videos`);
  return toNumber(rows[0]?.video_count);
}

async function writeImportState(sourceSignature: string, videoCount: number, transcriptFileCount: number): Promise<void> {
  await pool.query(
    `
      INSERT INTO import_state (
        job_name,
        source_signature,
        video_count,
        transcript_file_count,
        completed_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (job_name) DO UPDATE
      SET source_signature = EXCLUDED.source_signature,
          video_count = EXCLUDED.video_count,
          transcript_file_count = EXCLUDED.transcript_file_count,
          completed_at = EXCLUDED.completed_at
    `,
    [IMPORT_JOB_NAME, sourceSignature, videoCount, transcriptFileCount],
  );
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
  const videosFilePayload = await readVideosFile();
  const videosFile = videosFilePayload.parsed;
  const transcriptIndex = await buildTranscriptIndex();
  const sourceSignature = buildImportSourceSignature(videosFilePayload.raw, transcriptIndex);
  const existingImportState = await readImportState();
  const existingVideoCount = await countImportedVideos();

  if (
    existingImportState?.source_signature === sourceSignature &&
    existingVideoCount === videosFile.videos.length &&
    toNumber(existingImportState.video_count) === videosFile.videos.length &&
    toNumber(existingImportState.transcript_file_count) === transcriptIndex.size
  ) {
    console.log(`Skipping import: ${existingVideoCount} videos already imported for source signature ${sourceSignature}`);
    return;
  }

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

  await writeImportState(sourceSignature, videosFile.videos.length, transcriptIndex.size);
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
