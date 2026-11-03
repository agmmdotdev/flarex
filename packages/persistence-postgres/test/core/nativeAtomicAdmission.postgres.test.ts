import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe } from "vitest";
import { createCorePostgresFixture } from "./fixture";
import { registerNativeAtomicAdmissionScenarios } from "./nativeAtomicAdmissionScenario";
const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));

describe.runIf(endpoints !== undefined)("ordinary-role native atomic admission", () => {
  if (endpoints !== undefined) registerNativeAtomicAdmissionScenarios("PostgreSQL", () => createCorePostgresFixture(endpoints));
});
