import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe } from "vitest";
import { createCorePostgresFixture } from "./fixture";
import { registerNativeManyPolicyScenarios } from "./nativeManyPolicyScenarios";

const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));

describe.runIf(endpoints !== undefined)("ordinary-role native many policy", () => {
  if (endpoints !== undefined) registerNativeManyPolicyScenarios("PostgreSQL", () => createCorePostgresFixture(endpoints));
});
