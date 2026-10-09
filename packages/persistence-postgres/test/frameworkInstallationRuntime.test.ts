import { it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { exerciseColdInstallationAdmission, exerciseInstallationRuntime, exerciseMismatchedInstallationNamespace } from "./frameworkInstallationRuntimeTestSupport";

it("refuses a genuinely issued graph for an uninstalled namespace before canonical reads in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  await exerciseMismatchedInstallationNamespace(persistence.drizzle);
}, 180_000);

it("refuses cold preparation before reading the canonical graph in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  await exerciseColdInstallationAdmission(persistence.drizzle);
}, 180_000);

it("compares fresh installation evidence after preparation in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  await exerciseInstallationRuntime(persistence.drizzle);
}, 180_000);
