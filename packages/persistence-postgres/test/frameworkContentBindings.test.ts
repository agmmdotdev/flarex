import { it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { frameworkContentBindingScenario } from "./frameworkContentBindingScenario";

it("authenticates the scalar CMS content overlay against active Application ownership (PGlite)", async () => {
  await frameworkContentBindingScenario(await createMigratedPGlitePersistence());
}, 60_000);
