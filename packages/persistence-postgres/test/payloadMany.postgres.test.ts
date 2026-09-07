import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { payloadPreferenceBindingScenario } from "./payloadPreferenceBindingScenario";

describe.skipIf(postgresUrl === null)("private Payload many (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("proves populated many behavior, races and recovery", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await payloadPreferenceBindingScenario(persistence, makePostgresRelationalSession(persistence), "many");
  }), 180000);
  it("refuses existing empty ownership as a fresh many installation", () => withPersistence(async persistence => {
    await payloadPreferenceBindingScenario(persistence, makePostgresRelationalSession(persistence), "many-upgrade");
  }), 180000);
});
