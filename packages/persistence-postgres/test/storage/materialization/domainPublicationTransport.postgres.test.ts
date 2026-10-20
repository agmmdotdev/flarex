import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { publicationTransportCases } from "./domainPublicationTransportScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("Application publication typed array transport on ordinary PostgreSQL", { concurrent: false }, () => {
  const withPersistence = useFileScopedPostgresPersistence({ retainRows: true });
  it.each(publicationTransportCases)("$name", async scenario => {
    await withPersistence(async persistence => { await scenario.run(persistence.drizzle); });
  }, 120_000);
});
