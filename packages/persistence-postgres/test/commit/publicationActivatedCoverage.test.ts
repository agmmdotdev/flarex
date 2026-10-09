import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import { postgresUrl, createFileScopedPostgresFixture } from "../support/postgresHelpers";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture } from "../application/applicationNativeMutationTestFixture";
import { prepareActivatedCoverageProof } from "./publicationActivatedCoverageProof";

describe("activated publication coverage order", () => {
  it("folds the genuine active schema once after candidate failure on PGlite", async () => {
    const control = await createMigratedPGlitePersistence();
    const target = await createMigratedPGlitePersistence();
    const proof = await prepareActivatedCoverageProof(await createApplicationNativeMutationPGliteFixtureWithPersistence({
      runtimeHostIdentity: "flarex.test/publication-coverage", compatibilityDate: "2026-08-16" }, { control, target }));
    await proof();
  }, 180_000);
  (postgresUrl === null ? it.skip : it)("folds the genuine active schema once after candidate failure on ordinary PostgreSQL", async () => {
    const control = await createFileScopedPostgresFixture();
    const target = await createFileScopedPostgresFixture();
    try {
      const proof = await prepareActivatedCoverageProof(await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: "flarex.test/publication-coverage-pg", compatibilityDate: "2026-08-16",
        physicalLocator: { kind: "database_per_scope", databaseKey: "publication-coverage-pg", schemaName: target.schemaName },
      }, { control: control.persistence, target: target.persistence }));
      await proof();
    } finally { await target.dispose(); await control.dispose(); }
  }, 180_000);
});
