import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe } from "vitest";
import { createCorePostgresFixture } from "./fixture";
import { registerNativeReconstitutionHostScenarios } from "./nativeReconstitutionHostScenario";
const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));

describe.runIf(endpoints !== undefined)("ordinary-role native reconstitution host", () => {
  if (endpoints !== undefined) registerNativeReconstitutionHostScenarios("PostgreSQL", () => createCorePostgresFixture(endpoints));
});
