import { Effect } from "effect";
import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "../applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import {
  EXECUTION_CATALOG_BACKFILL_CORRUPTION_OPTIONS,
  executionCatalogBackfillCorruptionScenario,
} from "./executionCatalogBackfillCorruptionScenario";

it("keeps public PGlite maintenance drained when stored catalog authentication fails", async () => {
  const control = await createMigratedPGlitePersistence();
  const target = await createMigratedPGlitePersistence(undefined, "finiteCapture", { immutableCatalog: control.drizzle });
  const native = await createApplicationNativeMutationPGliteFixtureWithPersistence(EXECUTION_CATALOG_BACKFILL_CORRUPTION_OPTIONS,
    { control, target });
  await runEffect(Effect.scoped(executionCatalogBackfillCorruptionScenario(native,
    { kind: "pglite", writer: target, migrate: () => target.migrate() })));
}, 120_000);
