import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { scopePublicationBatchScenario } from "./scopePublicationBatchScenario";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";

describe.skipIf(postgresUrl === null)("publication batches (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("batches publication with exact returned facts and atomic rollback", async () => {
    await withPersistence(persistence => scopePublicationBatchScenario(persistence, async run => {
      const measured = await withPostgresExecutionObservation(persistence.pool, run, { returnedCommands: true });
      expect(measured.observation.checkouts).toBe(1);
      expect(measured.observation.releases).toBe(1);
      expect(measured.observation.returnedCommands.filter(command => command.submittedCommand === "begin" || command.submittedCommand === "commit"))
        .toEqual([{ checkout: 1, submittedCommand: "begin", returnedCommand: "BEGIN" },
          { checkout: 1, submittedCommand: "commit", returnedCommand: "ROLLBACK" }]);
    }));
  }, 120_000);
});
