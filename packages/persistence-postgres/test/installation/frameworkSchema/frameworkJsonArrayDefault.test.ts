import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { installJsonDefaultFixture, assertJsonDefaultDriftRefused } from "./frameworkJsonDefaultTestSupport";

it("installs and replays the physical empty JSON array default and refuses drift in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const fixture = await installJsonDefaultFixture(persistence);
  await assertJsonDefaultDriftRefused(persistence, fixture);
}, 180_000);

it("installs and replays the physical empty JSON object default and refuses drift in PGlite", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const fixture = await installJsonDefaultFixture(persistence, "emptyJsonObject");
  await assertJsonDefaultDriftRefused(persistence, fixture);
}, 180_000);
