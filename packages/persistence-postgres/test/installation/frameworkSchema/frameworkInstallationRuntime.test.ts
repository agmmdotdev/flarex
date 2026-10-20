import { describe, it } from "vitest";
import { useFileScopedFrameworkCoordinatorGraphPersistence } from "./frameworkCoordinatorRepositoryTestSupport";
import { exerciseColdInstallationAdmission, exerciseInstallationRuntime, exerciseMismatchedInstallationNamespace } from "./frameworkInstallationRuntimeTestSupport";

describe("framework installation runtime (PGlite)", { concurrent: false }, () => {
  const withPersistence = useFileScopedFrameworkCoordinatorGraphPersistence();

  it("refuses a genuinely issued graph for an uninstalled namespace before canonical reads in PGlite", async () =>
    withPersistence(async persistence => {
      await exerciseMismatchedInstallationNamespace(persistence.drizzle);
    }), 180_000);

  it("refuses cold preparation before reading the canonical graph in PGlite", async () =>
    withPersistence(async persistence => {
      await exerciseColdInstallationAdmission(persistence.drizzle);
    }), 180_000);

  it("compares fresh installation evidence after preparation in PGlite", async () =>
    withPersistence(async persistence => {
      await exerciseInstallationRuntime(persistence.drizzle);
    }), 180_000);
});
