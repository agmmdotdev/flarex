import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { payloadPreferenceBindingScenario } from "../../frameworks/payloadPreferences/payloadPreferenceBindingScenario";

describe.skipIf(postgresUrl === null)("private Payload population (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("batches reads with coherent admission and bounded cleanup", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await payloadPreferenceBindingScenario(persistence, makePostgresRelationalSession(persistence), "population");
  }), 180000);
});
