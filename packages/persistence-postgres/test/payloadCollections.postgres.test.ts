import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { payloadCollectionsScenario } from "./payloadCollectionsScenario";

describe.skipIf(postgresUrl === null)("compiled Payload collections (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("proves ordinary-role collection routing, uniqueness and atomic preference cleanup", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await payloadCollectionsScenario(persistence, makePostgresRelationalSession(persistence));
  }), 180000);
});
