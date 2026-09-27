import { it } from "vitest";
import { newTestPGlite } from "./pgliteSearchExtensions";
import { verifyLogicalSearchBuildBatch } from "./logicalSearchBuildBatchScenario";

it("batches neutral search readiness across tables and descriptors on PGlite", async () => {
  const { createPGlitePersistence } = await import("../src/pglite");
  const db = newTestPGlite();
  const persistence = await createPGlitePersistence({ db });
  try {
    await persistence.migrate();
    await verifyLogicalSearchBuildBatch(persistence, persistence.drizzle);
  } finally {
    await db.close();
  }
}, 120_000);
