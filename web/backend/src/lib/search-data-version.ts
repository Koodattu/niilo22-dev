import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { config } from "../config.js";

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function readSearchDataVersion(): Promise<string> {
  try {
    const details = await stat(config.searchDataVersionPath);
    return `${details.mtimeMs}`;
  } catch (error) {
    if (isFileNotFound(error)) {
      return "missing";
    }

    throw error;
  }
}

export async function writeSearchDataVersion(): Promise<string> {
  const version = `${Date.now()}`;

  await mkdir(dirname(config.searchDataVersionPath), { recursive: true });
  await writeFile(config.searchDataVersionPath, `${version}\n`, "utf8");

  return version;
}