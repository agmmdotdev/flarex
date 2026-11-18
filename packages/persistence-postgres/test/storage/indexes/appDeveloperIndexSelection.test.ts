import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { appDeveloperIndexSelectionScenario } from "./appDeveloperIndexSelectionScenario";

it("requires exact published developer definitions across cold and warm selection (PGlite)", async () => {
  await appDeveloperIndexSelectionScenario(await createMigratedPGlitePersistence());
}, 60_000);
