import { it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { exerciseInstallationAcceptance } from "./frameworkInstallationAcceptanceTestSupport";

it("restores installation acceptance once and rejects stale/corrupt evidence in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  await exerciseInstallationAcceptance(persistence.drizzle);
}, 180_000);
