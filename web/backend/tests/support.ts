import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const backendRoot = fileURLToPath(new URL("../", import.meta.url));

export function configureTestDatabase(): void {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("Set TEST_DATABASE_URL to a dedicated disposable local database ending in _test.");
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
    throw new Error("Tests require a localhost database ending in _test; existing application databases are not allowed.");
  }
  process.env.DATABASE_URL = value;
  process.env.MIGRATION_PATH = resolve(backendRoot, "../db/migrations");
  process.env.LOG_LEVEL = "silent";
}

export async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "niilo22-goal-test-"));
  const outputDir = join(directory, "output");
  const videosPath = join(directory, "videos.json");
  await mkdir(outputDir);
  const videos = [
    { id: "testvid0001", name: "Aamukahvi ja päivän suunnitelmat", publishedAt: "2024-01-12T09:00:00Z" },
    { id: "test_id0002", name: "Pyöräretki ja kahvitauko", publishedAt: "2024-06-15T12:00:00Z" },
    { id: "testvid0003", name: "Hiljainen maisema", publishedAt: "2024-08-01T12:00:00Z" },
  ];
  const lines = [
    "Aamukahvi maistuu tänään hyvältä ja tästä lähtee taas uusi mukava päivä.",
    "Nyt on toinen aamukahvi vuorossa ja kohta lähdetään ulos kävelylle yhdessä.",
    "Kolmas aamukahvi odottaa kun palaamme takaisin kotiin tämän pitkän kävelyn jälkeen.",
    "Vielä aamukahvi ennen kuin lopetetaan tämän päivän mukavat tarinat tähän paikkaan.",
  ];
  const words = lines.flatMap((line, lineIndex) => line.split(" ").map((word, index) => ({ word, start: lineIndex * 30 + index * 0.4, end: lineIndex * 30 + index * 0.4 + 0.3 })));
  await writeFile(videosPath, JSON.stringify({ videos }));
  for (const [index, video] of videos.entries()) {
    await writeFile(join(outputDir, `1700000000_20231114_${video.id}_fixture.json`), JSON.stringify({
      youtube_id: video.id, file_name: `${video.id}.mp3`, words: index === 2 ? [] : words,
    }));
  }
  return {
    directory, videosPath, outputDir, videos, words,
    async import() {
      return execFileAsync(process.execPath, ["--import", "tsx", "scripts/import-data.ts"], {
        cwd: backendRoot,
        env: { ...process.env, VIDEOS_JSON_PATH: videosPath, OUTPUT_DIR: outputDir },
      });
    },
    async cleanup() {
      if (resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("niilo22-goal-test-")) {
        await rm(directory, { recursive: true, force: true });
      } else throw new Error("Refusing to remove a directory outside the generated fixture root.");
    },
  };
}
