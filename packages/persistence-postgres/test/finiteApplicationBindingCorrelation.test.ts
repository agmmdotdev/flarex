import { it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";
import { finiteApplicationBindingCorrelationScenario } from "./finiteApplicationBindingCorrelationScenario";

it("binds finite correlation to successful full-entry identity and closes checked observations in PGlite", async () => {
  await finiteApplicationBindingCorrelationScenario(await createMigratedPGlitePersistence());
}, 240_000);
it.skipIf(postgresUrl === null)("retains fresh Application schema correlation in PostgreSQL", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try { await finiteApplicationBindingCorrelationScenario(fixture.persistence); }
  finally { await fixture.dispose(); }
}, 240_000);
