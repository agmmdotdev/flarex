import { it } from "vitest";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "../../application/applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { FINITE_INDEXED_QUERY_OPTIONS, finiteIndexedQueriesScenario } from "./finiteIndexedQueriesScenario";
import { FINITE_PENDING_INDEX_OPTIONS, finitePendingIndexesScenario } from "./finitePendingIndexesScenario";
import { finiteIndexedHydrationQuotaScenario } from "./finiteIndexedHydrationQuotaScenario";

for (const { name, options, scenario } of [
  { name: "retains finite range lookahead evidence through a genuine competing finite publication (PGlite)",
    options: FINITE_INDEXED_QUERY_OPTIONS, scenario: finiteIndexedQueriesScenario },
  { name: "preserves finite pending index transitions, failure order and deleted-base refill (PGlite)",
    options: FINITE_PENDING_INDEX_OPTIONS, scenario: finitePendingIndexesScenario },
]) it(name, async () => {
  const control = await createMigratedPGlitePersistence();
  const target = await createMigratedPGlitePersistence(undefined, "finiteCapture");
  const native = await createApplicationNativeMutationPGliteFixtureWithPersistence(options, { control, target });
  await runEffect(scenario(native));
}, 120_000);

it("preserves root resource failure during selected range-body hydration (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const target = await createMigratedPGlitePersistence(undefined, "finiteCapture");
  const native = await createApplicationNativeMutationPGliteFixtureWithPersistence(FINITE_INDEXED_QUERY_OPTIONS, { control, target });
  await runEffect(finiteIndexedHydrationQuotaScenario(native));
}, 120_000);
