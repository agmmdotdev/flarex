import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import {
  originalSchemaCorruptionScenario,
  originalSchemaEvidenceScenario,
  originalSchemaWithholdingScenario,
} from "./originalSchemaEvidenceScenario";

describe.skipIf(postgresUrl === null)("original schema evidence (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("retains exact database text and detached bytes and dates", async () => {
    await withPersistence(originalSchemaEvidenceScenario);
  }, 120_000);
  it("withholds over-budget originals in SQL while preserving semantic reads", async () => {
    await withPersistence(originalSchemaWithholdingScenario);
  }, 120_000);
  it("refuses corrupt canonical bytes, digests and database JSON at acquisition", async () => {
    await withPersistence(originalSchemaCorruptionScenario);
  }, 120_000);
});
