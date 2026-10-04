import { it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";
import { finiteApplicationMetadataScenario } from "./finiteApplicationMetadataScenario";

it("retains fixed Application metadata and closes transaction authority in PGlite", async () => {
  await finiteApplicationMetadataScenario(await createMigratedPGlitePersistence());
}, 240_000);
it.skipIf(postgresUrl === null)("retains fixed Application metadata and closes transaction authority in PostgreSQL", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try { await finiteApplicationMetadataScenario(fixture.persistence); }
  finally { await fixture.dispose(); }
}, 240_000);
