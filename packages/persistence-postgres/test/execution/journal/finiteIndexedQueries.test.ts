import { it } from "vitest";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "../../application/applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { FINITE_INDEXED_QUERY_OPTIONS, finiteIndexedQueriesScenario } from "./finiteIndexedQueriesScenario";

it("retains finite range lookahead evidence through a genuine competing finite publication (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const target = await createMigratedPGlitePersistence(undefined, "finiteCapture");
  const native = await createApplicationNativeMutationPGliteFixtureWithPersistence(FINITE_INDEXED_QUERY_OPTIONS, { control, target });
  await runEffect(finiteIndexedQueriesScenario(native));
}, 120_000);
