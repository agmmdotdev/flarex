import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { nonNullCatalogScenario } from "./nonNullCatalogScenario";

describe.skipIf(postgresUrl === null)("non-null partial ordered catalog CHECKs on ordinary-role PostgreSQL", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("upgrades the predecessor and refuses malformed and unique predicates", async () => {
    await withPersistence(nonNullCatalogScenario);
  }, 180_000);
});
