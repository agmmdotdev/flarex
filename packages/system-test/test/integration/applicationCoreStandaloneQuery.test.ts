import { createCorePGliteFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { withApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { describe } from "vitest";
import { createCoreApplicationDefinition } from "../../support/applicationCoreDefinition";
import { defineApplicationCoreStandaloneQueryContract } from "../contracts/applicationCoreStandaloneQueryContract";

describe("Shared Application owner standalone queries - PGlite", () => {
  defineApplicationCoreStandaloneQueryContract({ runScenario: async scenario => {
    const definition = await createCoreApplicationDefinition();
    return withApplicationCoreFixture(await createCorePGliteFixture(), definition, scenario);
  } });
});
