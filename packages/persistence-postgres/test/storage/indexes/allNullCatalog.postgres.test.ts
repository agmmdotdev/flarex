import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { allNullCatalogScenario } from "./allNullCatalogScenario";

describe.skipIf(postgresUrl === null)("two-null partial catalog CHECKs on ordinary-role PostgreSQL", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("admits genuine definitions and upgrades the predecessor without accepting malformed predicates", async () => {
    await withPersistence(allNullCatalogScenario);
  }, 180_000);
});
