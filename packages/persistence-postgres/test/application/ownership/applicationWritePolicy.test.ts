import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { applicationWritePolicyScenario } from "./applicationWritePolicyScenario";
import { ensureRelationBuildTestWebCrypto } from "../relations/applicationRelationBuildTestSupport";

it("enforces Application table write ownership through activation, denial, commit and recovery (PGlite)", async () => {
  ensureRelationBuildTestWebCrypto();
  await applicationWritePolicyScenario(await createMigratedPGlitePersistence());
}, 60_000);
