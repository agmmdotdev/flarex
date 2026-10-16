import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { installJsonArrayDefaultFixture, assertJsonArrayDefaultDriftRefused } from "./frameworkJsonArrayDefaultTestSupport";

it("installs and replays the physical empty JSON array default and refuses drift in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const fixture = await installJsonArrayDefaultFixture(persistence);
  await assertJsonArrayDefaultDriftRefused(persistence, fixture);
}, 180_000);
