import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { createFileScopedPostgresFixture, postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { sourceCmsApplicationRelationsScenario, sourceCmsRelationAdmissionBarrierScenario,
  sourceCmsRelationUncertainCommitScenario, sourceCmsEmptyApplicationReadProjectionScenario } from "./sourceCmsApplicationRelationsScenario";

describe.skipIf(postgresUrl === null)("source CMS Application relations (ordinary-role PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  const withForeign = useFileScopedPostgresPersistence();
  it("maintains native rows, relation sidecars, facts and rollback", () => withPersistence(persistence => withForeign(async foreign => {
    const role = await persistence.query<{ superuser: boolean; bypass: boolean }>(
      "select rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user");
    expect(role.rows).toEqual([{ superuser: false, bypass: false }]);
    await sourceCmsApplicationRelationsScenario(persistence, makePostgresRelationalSession(persistence), foreign.drizzle);
  })), 180_000);
  it("reconciles a lost native COMMIT acknowledgement without invoking Payload twice", () =>
    withPersistence(sourceCmsRelationUncertainCommitScenario), 180_000);
  it("blocks activation and relation rebuild behind the held native command", () =>
    withPersistence(sourceCmsRelationAdmissionBarrierScenario), 180_000);
  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("refuses the absent Application read root through a genuine protected installation", async () => {
    const owner = await createFileScopedPostgresFixture();
    try { await sourceCmsEmptyApplicationReadProjectionScenario(owner); }
    finally { await owner.dispose(); }
  }, 180_000);
});
