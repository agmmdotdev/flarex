import { describe, expect, it } from "vitest";
import { appDeveloperIndexSelectionScenario } from "./appDeveloperIndexSelectionScenario";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";

describe.skipIf(postgresUrl === null)("Exact published developer selection (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("rejects catalog divergence while keeping the warm lookup scoped", () => withPersistence(async persistence => {
    await appDeveloperIndexSelectionScenario(persistence, async run => {
      const measured = await withPostgresExecutionObservation(persistence.pool, run);
      // Scope ownership and touched definitions remain fresh; no full-schema
      // artifact, binding inventory or required-definition query is repeated.
      expect(measured.observation.phases.resolveAndLock?.queryCalls).toBe(2);
      return measured.value;
    });
  }), 60_000);
});
