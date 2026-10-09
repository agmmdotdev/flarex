import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Schema } from "effect";
import { expect } from "vitest";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";

const decodeConfiguration = Schema.decodeUnknownSync(
  Schema.Struct({
    server_version: Schema.String,
    fsync: Schema.String,
    synchronous_commit: Schema.String,
    full_page_writes: Schema.String,
    shared_buffers: Schema.String,
    superuser: Schema.Boolean,
  }),
);
const decodeDriver = Schema.decodeUnknownSync(
  Schema.Struct({ version: Schema.String }),
);

export async function readCe0Environment(
  persistence: PostgresFlarexPersistence,
  sourcePaths: readonly string[],
) {
  const configuration = decodeConfiguration(
    (
      await persistence.query(`
      select current_setting('server_version') as server_version,
        current_setting('fsync') as fsync,
        current_setting('synchronous_commit') as synchronous_commit,
        current_setting('full_page_writes') as full_page_writes,
        current_setting('shared_buffers') as shared_buffers,
        (select rolsuper from pg_roles where rolname = current_user) as superuser
    `)
    ).rows[0],
  );
  expect(configuration.superuser).toBe(false);
  expect(configuration.fsync).toBe("on");
  expect(configuration.synchronous_commit).toBe("on");
  expect(configuration.full_page_writes).toBe("on");
  const driver = decodeDriver(createRequire(import.meta.url)("pg/package.json"));
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      [
        ...sourcePaths,
        "./ce0Environment.ts",
        "./postgresExecutionObservation.ts",
      ].map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(new URL(path, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  );
  return {
    configuration,
    node: process.version,
    pg: driver.version,
    platform: process.platform,
    architecture: process.arch,
    poolMax: persistence.pool.options.max,
    transport: "pg TCP socket",
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
    trackedDiffSha256: createHash("sha256")
      .update(
        execFileSync("git", ["diff", "HEAD", "--"], {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        }),
      )
      .digest("hex"),
    sourceHashes,
  };
}
