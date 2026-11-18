import { describe, expect, it } from "vitest";
import { appUniqueConstraintSelectionScenario } from "./appUniqueConstraintSelectionScenario";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";

describe.skipIf(postgresUrl === null)("Exact closed unique selection (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("rejects catalog divergence while keeping warm selection scoped", () => withPersistence(async persistence => {
    await appUniqueConstraintSelectionScenario(persistence, async run => {
      const measured = await withPostgresExecutionObservation(persistence.pool, run);
      expect(measured.observation.phases.resolveAndLock?.queryCalls).toBe(2);
      return measured.value;
    });
  }), 60_000);
});
