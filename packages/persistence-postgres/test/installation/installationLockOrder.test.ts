import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { coLocatedInstallationFrontierSource } from "../../src/installation/installationLifecycle";

it("orders actual installation gates in PostgreSQL C order including Unicode supplementary characters", () => {
  const refs = (schemaName: string) => ({ schemaName, gate: sql`${sql.identifier(schemaName)}.fx_lock_installation_admission()`,
    localFrontierExpected: sql`null` });
  const bmp = "schema_\uE000", supplementary = "schema_\u{10000}";
  expect(supplementary < bmp).toBe(true);
  for (const [target, control] of [[bmp, supplementary], [supplementary, bmp]] as const) {
    const query = new PgDialect().sqlToQuery(coLocatedInstallationFrontierSource({ target: refs(target), control: refs(control) })).sql;
    expect(query.indexOf(`"${bmp}".fx_lock_installation_frontier(`))
      .toBeLessThan(query.indexOf(`"${supplementary}".fx_lock_installation_frontier(`));
    expect(query).toContain('from first_frontier where (first_frontier.frontier).accepted');
    expect(query).not.toContain('jsonb_build_object');
    const gated = new PgDialect().sqlToQuery(coLocatedInstallationFrontierSource({ target: refs(target), control: refs(control) },
      sql`select 1 from preflight where reason = 'accepted'`)).sql;
    expect(gated).toContain("from (select 1 from preflight where reason = 'accepted') prerequisite offset 0");
    expect(gated).toContain('from first_frontier where (first_frontier.frontier).accepted offset 0');
  }
});
