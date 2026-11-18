import { describe, it } from "vitest";
import { createFileScopedPGliteFixture } from "../../support/pgliteTestFixture";
import { useFileScopedPersistence } from "../../support/fileScopedPersistenceFixture";
import { materializationCompositionCases } from "./materializationCompositionScenario";

describe("Application materialization composition on PGlite", { concurrent: false }, () => {
  // Scenarios use distinct scopes and deployments; rows intentionally accumulate
  // while the fixture owner renews its prepared runtime after each case.
  const withPersistence = useFileScopedPersistence(
    () => createFileScopedPGliteFixture(async () => async () => {}), false,
  );
  it.each(materializationCompositionCases)("$name", async scenario => {
    await withPersistence(persistence => scenario.run(persistence));
  }, 120_000);
});
