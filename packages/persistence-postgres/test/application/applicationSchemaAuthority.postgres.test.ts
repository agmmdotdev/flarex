import { afterAll, beforeAll, describe, expect } from "vitest";

import { createFileScopedPostgresFixture, postgresUrl } from "../support/postgresHelpers";
import { registerApplicationSchemaPublicationScenarios } from "./applicationSchemaPublicationScenarios";

describe.skipIf(postgresUrl === null)("Application schema Source publication on ordinary PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFileScopedPostgresFixture>> | undefined;
  beforeAll(async () => {
    fixture = await createFileScopedPostgresFixture();
    expect((await fixture.persistence.query<{ superuser: boolean; bypass: boolean; createDatabase: boolean; createRole: boolean }>(
      'select rolsuper as superuser,rolbypassrls as bypass,rolcreatedb as "createDatabase",rolcreaterole as "createRole" from pg_roles where rolname=current_user',
    )).rows).toEqual([{ superuser: false, bypass: false, createDatabase: false, createRole: false }]);
  }, 120_000);
  afterAll(async () => { await fixture?.dispose(); }, 120_000);
  registerApplicationSchemaPublicationScenarios("fresh and retained declarations", () => {
    if (fixture === undefined) throw new Error("Missing Application schema publication fixture");
    return fixture.persistence;
  });
});
