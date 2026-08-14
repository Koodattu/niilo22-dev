import { readdir, readFile } from "node:fs/promises";
import { sep } from "node:path";
import { createHash } from "node:crypto";

import type { PoolClient } from "pg";

import { config } from "../src/config.js";
import { pool, withTransaction } from "../src/db.js";
import { refreshAnalyticsSnapshot } from "../src/lib/analytics.js";
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

interface ImportedVideoRow {
  youtube_id: string;
  source_signature: string | null;
}

const IMPORT_JOB_NAME = "full-import";
const VIDEO_SOURCE_SIGNATURE_VERSION = "1";

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
      const filePath = Buffer.concat([outputDirPrefix, entry.name]);

      transcriptIndex.set(youtubeId, {
        filePath,
        displayName: entry.name.toString("utf8"),
      });
    }
  }

  return transcriptIndex;
}

function buildVideoSourceSignature(video: VideoItem, transcriptLocation: TranscriptLocation | undefined, transcriptRaw: string | null): string {
  const hash = createHash("sha256");
  hash.update(VIDEO_SOURCE_SIGNATURE_VERSION);
  hash.update("\n");
  hash.update(
    JSON.stringify({
      id: video.id,
      name: video.name,
      publishedAt: video.publishedAt,
      downloaded: video.downloaded ?? false,
      transcriptFileName: transcriptLocation?.displayName ?? null,
    }),
  );
  hash.update("\n");
  hash.update(transcriptRaw ?? "missing");

  return hash.digest("hex");
}

async function readImportedVideoSignatures(): Promise<Map<string, string | null>> {
  const { rows } = await pool.query<ImportedVideoRow>(`SELECT youtube_id, source_signature FROM videos`);
  return new Map(rows.map((row) => [row.youtube_id, row.source_signature]));
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

async function upsertVideo(
  client: PoolClient,
  video: VideoItem,
  transcriptWordCount: number,
  transcriptStatus: string,
  localFileName: string | null,
  sourceSignature: string,
): Promise<void> {
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
        transcript_status,
        source_signature
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (youtube_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        normalized_title = EXCLUDED.normalized_title,
        published_at = EXCLUDED.published_at,
        downloaded = EXCLUDED.downloaded,
        local_file_name = EXCLUDED.local_file_name,
        transcript_word_count = EXCLUDED.transcript_word_count,
        transcript_status = EXCLUDED.transcript_status,
        source_signature = EXCLUDED.source_signature,
        updated_at = NOW()
    `,
    [video.id, video.name, normalizeSearchText(video.name), video.publishedAt, video.downloaded ?? false, localFileName, transcriptWordCount, transcriptStatus, sourceSignature],
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
  const importedVideoSignatures = await readImportedVideoSignatures();
  const currentVideoIds = new Set(videosFile.videos.map((video) => video.id));
  const datasetHash = createHash("sha256");

  console.log(`Checking ${videosFile.videos.length} videos for changes`);

  let processed = 0;
  let skipped = 0;
  let totalChunks = 0;
  let checked = 0;

  for (const video of videosFile.videos) {
    const transcriptLocation = transcriptIndex.get(video.id);
    const transcriptRaw = transcriptLocation ? await readFile(transcriptLocation.filePath, "utf8") : null;
    const sourceSignature = buildVideoSourceSignature(video, transcriptLocation, transcriptRaw);

    datasetHash.update(video.id);
    datasetHash.update("\0");
    datasetHash.update(sourceSignature);
    datasetHash.update("\n");
    checked += 1;

    if (importedVideoSignatures.get(video.id) === sourceSignature) {
      skipped += 1;

      if (checked % 500 === 0 || checked === videosFile.videos.length) {
        console.log(`Checked ${checked}/${videosFile.videos.length} videos: ${processed} changed, ${skipped} unchanged`);
      }

      continue;
    }

    const transcript = transcriptRaw === null ? null : (JSON.parse(transcriptRaw) as TranscriptFile);
    const words = transcript?.words ?? [];
    const chunks = createTranscriptChunks(words);
    const transcriptStatus = transcriptLocation ? (words.length > 0 ? "ready" : "ambient") : "missing";
    const localFileName = transcript?.file_name ?? transcriptLocation?.displayName ?? null;

    await withTransaction(async (client) => {
      await upsertVideo(client, video, words.length, transcriptStatus, localFileName, sourceSignature);
      await replaceChunks(client, video.id, chunks);
    });

    processed += 1;
    totalChunks += chunks.length;

    if (checked % 500 === 0 || checked === videosFile.videos.length) {
      console.log(`Checked ${checked}/${videosFile.videos.length} videos: ${processed} changed, ${skipped} unchanged`);
    }
  }

  const removedVideoIds = [...importedVideoSignatures.keys()].filter((videoId) => !currentVideoIds.has(videoId));

  if (removedVideoIds.length > 0) {
    await pool.query("DELETE FROM videos WHERE youtube_id = ANY($1::text[])", [removedVideoIds]);
  }

  const sourceSignature = datasetHash.digest("hex");
  await writeImportState(sourceSignature, videosFile.videos.length, transcriptIndex.size);

  if (processed > 0 || removedVideoIds.length > 0) {
    await writeSearchDataVersion();
  }

  console.log("Refreshing analytics snapshot");
  const analyticsRefreshed = await refreshAnalyticsSnapshot(sourceSignature);
  console.log(analyticsRefreshed ? "Analytics snapshot refreshed" : "Analytics snapshot is already current");
  console.log(`Import complete: ${processed} changed, ${skipped} unchanged, ${removedVideoIds.length} removed, ${totalChunks} transcript chunks written`);
}

try {
  await importAllVideos();
} catch (error) {
  console.error("Import failed", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
