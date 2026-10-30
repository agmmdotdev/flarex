import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { jointApplicationRelationsScenario } from "./jointApplicationRelationsScenario";

describe.skipIf(postgresUrl === null)("joint App/Payload/Currency relations (ordinary-role PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  const withForeign = useFileScopedPostgresPersistence();
  it("maintains exact relations, provenance, replay and rollback for every participant", () =>
    withPersistence(persistence => withForeign(async foreign => {
      const role = await persistence.query<{ superuser: boolean; bypass: boolean }>(
        "select rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user");
      expect(role.rows).toEqual([{ superuser: false, bypass: false }]);
      await jointApplicationRelationsScenario(persistence, makePostgresRelationalSession(persistence), foreign.drizzle);
    })), 180_000);
});
