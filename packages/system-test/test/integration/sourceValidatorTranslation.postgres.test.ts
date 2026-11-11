import { describe, expect, it } from "vitest";
import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { withApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { createSourceValidatorApplicationDefinition } from "../../support/sourceValidatorTranslation";
import { defineSourceValidatorTranslationContract } from "../contracts/sourceValidatorTranslationContract";

const serving = process.env.FLAREX_POSTGRES_DATABASE_URL;
const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;

describe("Source validator translation PostgreSQL acceptance environment", () => {
  it("requires explicit serving and provisioning endpoints", () => {
    expect(serving).toBeDefined();
    expect(provisioning).toBeDefined();
  });
});

const describePostgres = serving === undefined || provisioning === undefined ? describe.skip : describe;
describePostgres("Source validator translation - ordinary PostgreSQL and actual Worker", () => {
  defineSourceValidatorTranslationContract(async scenario => {
    if (serving === undefined || provisioning === undefined) throw new Error("Source validator proof requires explicit PostgreSQL endpoints.");
    const definition = await createSourceValidatorApplicationDefinition();
    return withApplicationCoreFixture(
      await createCorePostgresFixture({ connectionString: serving, provisioningConnectionString: provisioning }),
      definition, scenario,
    );
  });
});
