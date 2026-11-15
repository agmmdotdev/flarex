import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe } from "vitest";
import { createCorePostgresFixture } from "./fixture";
import { registerNativeSnapshotPushdownScenarios } from "./nativeSnapshotPushdownScenario";

const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));

describe.runIf(endpoints !== undefined)("ordinary-role native snapshot predicate pushdown", () => {
  if (endpoints !== undefined) registerNativeSnapshotPushdownScenarios("PostgreSQL", options => createCorePostgresFixture({ ...endpoints, ...options }));
});
