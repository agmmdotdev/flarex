import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "../support/postgresHelpers";
import { finiteApplicationMetadataScenario } from "./finiteApplicationMetadataScenario";

it("retains fixed Application metadata and closes transaction authority in PGlite", async () => {
  await finiteApplicationMetadataScenario(await createMigratedPGlitePersistence(undefined, "finiteCapture"));
}, 240_000);
it.skipIf(postgresUrl === null)("retains fixed Application metadata and closes transaction authority in PostgreSQL", async () => {
  const fixture = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
  try { await finiteApplicationMetadataScenario(fixture.persistence); }
  finally { await fixture.dispose(); }
}, 240_000);
