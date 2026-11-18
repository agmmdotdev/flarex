import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { withApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { describe } from "vitest";
import { createCoreApplicationDefinition } from "../../support/applicationCoreDefinition";
import { defineApplicationCoreStandaloneQueryContract } from "../contracts/applicationCoreStandaloneQueryContract";

describe("Shared Application owner standalone queries - PostgreSQL", () => {
  defineApplicationCoreStandaloneQueryContract({ runScenario: async scenario => {
    const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL;
    const provisioningConnectionString = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
    if (connectionString === undefined || provisioningConnectionString === undefined)
      throw new Error("Core PostgreSQL proof requires explicit ordinary-role serving and provisioning endpoints.");
    const definition = await createCoreApplicationDefinition();
    return withApplicationCoreFixture(await createCorePostgresFixture({ connectionString, provisioningConnectionString }), definition, scenario);
  } });
});
