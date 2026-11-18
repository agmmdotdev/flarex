import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { logicalWorkingSetScanObservationsScenario } from "./logicalWorkingSetScanObservationsScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPersistence = useFileScopedPostgresPersistence();
describePostgres("ordinary PostgreSQL scan-backed call observations", () => {
  it("keeps scan-backed key, prefix and unchanged lifecycle observations call-local", { timeout: 60_000 }, async () => {
    await withPersistence(persistence => logicalWorkingSetScanObservationsScenario(persistence.drizzle));
  });
});
