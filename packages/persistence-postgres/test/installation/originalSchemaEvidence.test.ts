import { afterAll, beforeAll, describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import {
  originalSchemaCorruptionScenario,
  originalSchemaEvidenceScenario,
  originalSchemaWithholdingScenario,
} from "./originalSchemaEvidenceScenario";

describe("original schema evidence (PGlite)", { concurrent: false }, () => {
  // Each scenario owns distinct deployment and schema artifact coordinates.
  let persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>;
  let dispose: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    persistence = await createMigratedPGlitePersistence(cleanup => { dispose = cleanup; });
  }, 120_000);
  afterAll(async () => { await dispose?.(); }, 120_000);

  it("retains exact database text and detached bytes and dates", async () => {
    await originalSchemaEvidenceScenario(persistence);
  }, 120_000);
  it("withholds over-budget originals in SQL while preserving semantic reads", async () => {
    await originalSchemaWithholdingScenario(persistence);
  }, 120_000);
  it("refuses corrupt canonical bytes, digests and database JSON at acquisition", async () => {
    await originalSchemaCorruptionScenario(persistence);
  }, 120_000);
});
