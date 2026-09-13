import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { payloadConfiguredRelationshipScenario } from "./payloadConfiguredRelationshipScenario";

describe.skipIf(postgresUrl === null)("configurable Payload relationships (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it.each([["authors", "author"], ["article-authors", "editor"]])("proves ordinary-role articles -> %s via %s", (target, field) => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await payloadConfiguredRelationshipScenario(persistence, makePostgresRelationalSession(persistence), target, field);
  }), 180000);
});
