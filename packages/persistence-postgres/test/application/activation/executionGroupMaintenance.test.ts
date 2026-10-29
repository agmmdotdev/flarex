import { Effect } from "effect";
import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "../applicationNativeMutationTestFixture";
import { EXECUTION_GROUP_MAINTENANCE_OPTIONS, executionGroupMaintenanceScenario } from "./executionGroupMaintenanceScenario";
import { runEffect } from "../../support/effectTestRuntime";

it("reconciles predecessor execution groups through public PGlite migrate while preserving genuine attempts", async () => {
  const control = await createMigratedPGlitePersistence();
  const target = await createMigratedPGlitePersistence(undefined, "finiteCapture", { immutableCatalog: control.drizzle });
  const native = await createApplicationNativeMutationPGliteFixtureWithPersistence(EXECUTION_GROUP_MAINTENANCE_OPTIONS, { control, target });
  await runEffect(Effect.scoped(executionGroupMaintenanceScenario(native, { writer: target, migrate: () => target.migrate() })));
}, 120_000);
