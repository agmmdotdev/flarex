import { it } from "vitest";
import { verifyLogicalSearchBuildBatch } from "./logicalSearchBuildBatchScenario";

it("batches neutral search readiness across tables and descriptors on PGlite", async () => {
  const { createMigratedPGlitePersistence } = await import("../../support/pgliteTestFixture");
  const persistence = await createMigratedPGlitePersistence();
  await verifyLogicalSearchBuildBatch(persistence, persistence.drizzle);
}, 120_000);
