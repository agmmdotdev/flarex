import { describe } from "vitest";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { registerCoreManagedProductReadScenarios } from "./support/core-product-managed-read-scenarios";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("ordinary PostgreSQL", () => {
  registerCoreManagedProductReadScenarios("postgres");
});
