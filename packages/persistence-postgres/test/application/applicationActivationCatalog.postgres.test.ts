import { describe, expect, it } from "vitest";
import { applicationActivationCatalogScenario } from "./applicationActivationCatalogScenario";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../support/postgresHelpers";

describe.skipIf(postgresUrl === null)("split-catalog activation (PostgreSQL)", () => {
  it("borrows the catalog lease for activation, rollback and replay", () => withTemporaryPostgresPersistencePair(async (control, target) => {
    expect((await target.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await applicationActivationCatalogScenario({ persistence: target, controlPersistence: control });
  }), 90_000);
});
