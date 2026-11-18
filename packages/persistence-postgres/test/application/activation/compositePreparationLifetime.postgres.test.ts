import { expect, it } from "vitest";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { compositePreparationLifetimeScenario } from "./compositePreparationLifetimeScenario";

it.skipIf(postgresUrl === null).each([false, true])(
  "keeps composite request preparation independent of its ambient retained host on ordinary-role PostgreSQL (policy=%s)",
  async writePolicy => {
    const fixture = await createFileScopedPostgresFixture();
    try {
      const role = await fixture.persistence.query<{ superuser: boolean }>(
        "select rolsuper as superuser from pg_roles where rolname=current_user",
      );
      expect(role.rows[0]?.superuser).toBe(false);
      await compositePreparationLifetimeScenario(fixture.persistence, writePolicy);
    } finally {
      await fixture.dispose();
    }
  }, 120_000,
);
