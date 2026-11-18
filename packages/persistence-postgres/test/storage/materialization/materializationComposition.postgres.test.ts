import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { materializationCompositionCases } from "./materializationCompositionScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("Application materialization composition on ordinary PostgreSQL", { concurrent: false }, () => {
  const withPersistence = useFileScopedPostgresPersistence({ retainRows: true });
  it.each(materializationCompositionCases)("$name", async scenario => {
    await withPersistence(persistence => scenario.run(persistence));
  }, 120_000);
});
