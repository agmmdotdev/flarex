import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { compositePreparationLifetimeScenario } from "./compositePreparationLifetimeScenario";

it.each([false, true])("keeps composite request preparation independent of its ambient retained host (policy=%s)",
  async writePolicy => {
    await compositePreparationLifetimeScenario(await createMigratedPGlitePersistence(), writePolicy);
  }, 120_000);
