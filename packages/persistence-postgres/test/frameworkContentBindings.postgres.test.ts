import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { frameworkContentBindingScenario } from "./frameworkContentBindingScenario";

describe.skipIf(postgresUrl === null)("scalar CMS content overlay (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("authenticates ownership and rebinding with the ordinary role", () => withPersistence(async persistence => {
    const role = await persistence.query<{ superuser: boolean }>(
      "select rolsuper as superuser from pg_roles where rolname = current_user",
    );
    expect(role.rows[0]?.superuser).toBe(false);
    await frameworkContentBindingScenario(persistence);
  }), 60_000);
});
