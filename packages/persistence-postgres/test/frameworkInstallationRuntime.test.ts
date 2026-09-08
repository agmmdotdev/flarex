import { it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { exerciseInstallationRuntime } from "./frameworkInstallationRuntimeTestSupport";

it("compares fresh installation evidence after preparation in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  await exerciseInstallationRuntime(persistence.drizzle);
}, 180_000);
