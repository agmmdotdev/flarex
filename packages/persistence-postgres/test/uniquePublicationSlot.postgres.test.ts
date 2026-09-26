import { describe, it } from "vitest";
import { postgresUrl, withTemporaryPostgresPersistence } from "./postgresHelpers";
import { verifyPublicationSlotFinalState } from "./uniquePublicationSlotScenario";

describe.skipIf(postgresUrl === null)("publication-local unique slot - PostgreSQL", () => {
  it("requires the exact pending row fact while leaving committed lookups closed", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await persistence.drizzle.transaction(verifyPublicationSlotFinalState);
    });
  }, 60_000);
});
