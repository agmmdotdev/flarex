import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { payloadCollectionsScenario } from "./payloadCollectionsScenario";
import { payloadManyCollectionsScenario } from "./payloadManyCollectionsScenario";

describe.skipIf(postgresUrl === null)("compiled Payload collections (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("proves ordinary-role collection routing, uniqueness and atomic preference cleanup", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await payloadCollectionsScenario(persistence, makePostgresRelationalSession(persistence));
  }), 180000);
  it("prepares a read-only host for 33 unique collections", () => withPersistence(persistence =>
    payloadManyCollectionsScenario(persistence, makePostgresRelationalSession(persistence))), 180000);
});
