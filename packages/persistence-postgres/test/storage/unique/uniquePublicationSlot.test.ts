import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { verifyPublicationSlotFinalState } from "./uniquePublicationSlotScenario";

describe("publication-local unique slot - PGlite", () => {
  it("requires the exact pending row fact while leaving committed lookups closed", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.drizzle.transaction(verifyPublicationSlotFinalState);
  }, 60_000);
});
