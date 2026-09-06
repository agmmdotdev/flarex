import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { payloadPreferenceBindingScenario } from "./payloadPreferenceBindingScenario";
describe.skipIf(postgresUrl === null)("private preference binding (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("installs real preference storage and revalidates admission", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await payloadPreferenceBindingScenario(persistence, makePostgresRelationalSession(persistence));
  }), 180000);
});
