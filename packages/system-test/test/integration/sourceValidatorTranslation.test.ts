import { describe } from "vitest";
import { createCorePGliteFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { withApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { createSourceValidatorApplicationDefinition } from "../../support/sourceValidatorTranslation";
import { defineSourceValidatorTranslationContract } from "../contracts/sourceValidatorTranslationContract";

describe("Source validator translation - PGlite and actual Worker", () => {
  defineSourceValidatorTranslationContract(async scenario => {
    const definition = await createSourceValidatorApplicationDefinition();
    return withApplicationCoreFixture(await createCorePGliteFixture(), definition, scenario);
  }, () => createCorePGliteFixture());
});
