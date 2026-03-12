import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { config } from "../config.js";
import { pool } from "../db.js";

interface MigrationFile {
  fileName: string;
  filePath: string;
  sql: string;
}

const SCHEMA_LOCK_NAMESPACE = 22;
const SCHEMA_LOCK_KEY = 101;

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const currentChar = sql[index];
    const nextChar = sql[index + 1];

    if (inLineComment) {
      current += currentChar;

      if (currentChar === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      current += currentChar;

      if (currentChar === "*" && nextChar === "/") {
        current += nextChar;
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && currentChar === "-" && nextChar === "-") {
      current += currentChar;
      current += nextChar;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && currentChar === "/" && nextChar === "*") {
      current += currentChar;
      current += nextChar;
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (currentChar === "'" && !inDoubleQuote) {
      current += currentChar;

      if (inSingleQuote && nextChar === "'") {
        current += nextChar;
        index += 1;
        continue;
      }

      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (currentChar === '"' && !inSingleQuote) {
      current += currentChar;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (currentChar === ";" && !inSingleQuote && !inDoubleQuote) {
      const trimmedStatement = current.trim();

      if (trimmedStatement.length > 0) {
        statements.push(trimmedStatement);
      }

      current = "";
      continue;
    }

    current += currentChar;
  }

  const trailingStatement = current.trim();

  if (trailingStatement.length > 0) {
    statements.push(trailingStatement);
  }

  return statements;
}

async function readMigrationFiles(migrationPath: string): Promise<MigrationFile[]> {
  const migrationStats = await stat(migrationPath);

  if (!migrationStats.isDirectory()) {
    return [
      {
        fileName: basename(migrationPath),
        filePath: migrationPath,
        sql: await readFile(migrationPath, "utf8"),
      },
    ];
  }

  const entries = await readdir(migrationPath, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".sql")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = resolve(migrationPath, fileName);

      return {
        fileName,
        filePath,
        sql: await readFile(filePath, "utf8"),
      };
    }),
  );
}

export async function ensureSchema(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        file_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationFiles = await readMigrationFiles(config.migrationPath);

    for (const migrationFile of migrationFiles) {
      const alreadyApplied = await client.query<{ file_name: string }>("SELECT file_name FROM schema_migrations WHERE file_name = $1 LIMIT 1", [migrationFile.fileName]);

      if (alreadyApplied.rowCount) {
        continue;
      }

      const statements = splitSqlStatements(migrationFile.sql);

      for (const statement of statements) {
        await client.query(statement);
      }

      await client.query(
        `
          INSERT INTO schema_migrations (file_name)
          VALUES ($1)
          ON CONFLICT (file_name) DO NOTHING
        `,
        [migrationFile.fileName],
      );
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY]);
    client.release();
  }
}
