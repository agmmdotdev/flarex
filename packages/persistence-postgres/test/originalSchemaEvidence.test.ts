import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import {
  originalSchemaCorruptionScenario,
  originalSchemaEvidenceScenario,
  originalSchemaWithholdingScenario,
} from "./originalSchemaEvidenceScenario";

describe("original schema evidence (PGlite)", () => {
  it("retains exact database text and detached bytes and dates", async () => {
    await originalSchemaEvidenceScenario(await createMigratedPGlitePersistence());
  }, 120_000);
  it("withholds over-budget originals in SQL while preserving semantic reads", async () => {
    await originalSchemaWithholdingScenario(await createMigratedPGlitePersistence());
  }, 120_000);
  it("refuses corrupt canonical bytes, digests and database JSON at acquisition", async () => {
    await originalSchemaCorruptionScenario(await createMigratedPGlitePersistence());
  }, 120_000);
});
