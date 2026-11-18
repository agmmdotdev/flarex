import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { booleanCatalogScenario } from "./booleanCatalogScenario";

describe.skipIf(postgresUrl === null)("Boolean partial catalog CHECKs on ordinary-role PostgreSQL", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("admits exact new definitions and upgrades the predecessor CHECKs without loosening malformed JSON", async () => {
    await withPersistence(booleanCatalogScenario);
  }, 180_000);
});
