import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { appUniqueConstraintSelectionScenario } from "./appUniqueConstraintSelectionScenario";

it("requires exact closed unique definitions across cold and warm selection (PGlite)", async () => {
  await appUniqueConstraintSelectionScenario(await createMigratedPGlitePersistence());
}, 60_000);
