import { Client } from "pg";
import { createPostgresClientDeclarativeV2VerifierProgressRepositoryV2 } from "@flarex/persistence-postgres/internal/system-test/postgres-client-declarative-v2-verifier-progress-v2";
import type { DeclarativeV2VerifierProgressRepositoryV2 } from "../../src/legacy/declarativeV2VerifierProgressRepositoryV2";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as persistenceApi from "../../src";
import packageManifest from "../../package.json" with { type: "json" };

describe("@flarex/persistence-postgres public API", () => {
  it("keeps activation off the broad persistence facade", () => {
    type RootActivationExport = Extract<
      keyof typeof persistenceApi,
      "createPointMutationSessionActivationPersistenceV1"
    >;
    expectTypeOf<RootActivationExport>().toEqualTypeOf<never>();
  });

  it("does not expose the transaction-scoped invoke-session commit operation", () => {
    expect(persistenceApi).not.toHaveProperty("commitInvokeSessionWrites");
    expect(persistenceApi).not.toHaveProperty(
      "commitInvokeSessionWritesInTransaction",
    );
  });
  it("keeps migration coordinator capabilities source-private", () => {
    for (const name of [
      "FrameworkMigrationRepositoryError",
      "appendFrameworkMigrationEventInTransactionEffect",
      "compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect",
      "corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect",
      "corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect",
      "corroborateRestoredFrameworkMigrationStepReceiptInTransactionEffect",
      "ensureFrameworkMigrationAttemptStartInTransactionEffect",
      "ensureFrameworkMigrationAttemptTerminalInTransactionEffect",
      "ensureFrameworkMigrationCollisionDomainInTransactionEffect",
      "ensureFrameworkMigrationPlanAdmissionInTransactionEffect",
      "ensureFrameworkMigrationStepReceiptInTransactionEffect",
      "ensureFrameworkSchemaTargetNamespaceInTransactionEffect",
      "ensureFreshRelationalMigrationPlanInTransactionEffect",
      "ensureRelationalPhysicalNameAssignmentsInTransactionEffect",
      "initializeFrameworkMigrationCollisionHeadInTransactionEffect",
      "makeFrameworkMigrationTargetEffect",
      "makeFrameworkSchemaTarget",
      "makePGliteFrameworkMigrationTargetEffect",
      "readFrameworkMigrationAttemptStartInTransactionEffect",
      "readFrameworkMigrationAttemptTerminalInTransactionEffect",
      "readFrameworkMigrationCollisionHeadInTransactionEffect",
      "readFrameworkMigrationEventInTransactionEffect",
      "readFrameworkMigrationPlanAdmissionInTransactionEffect",
      "readFrameworkMigrationStepReceiptInTransactionEffect",
      "readFreshRelationalMigrationPlanInTransactionEffect",
      "readRelationalPhysicalNameAssignmentInTransactionEffect",
      "resolveAuthenticatedFrameworkMigrationAttemptStartOccupantsEffect",
      "resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect",
      "resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect",
      "resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect",
      "resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect",
      "resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect",
      "restoreFrameworkMigrationStepReceiptPrefixForAttemptTerminalInTransactionEffect",
      "restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect",
      "restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect",
      "restoreStoredFrameworkSchemaInstallationMetadata",
      "restoreStoredFreshRelationalMigrationPlan",
      "restoredFrameworkMigrationCollisionHeadAuthority",
      "restoredFrameworkMigrationEventAuthority",
      "runFrameworkMigrationTargetTransactionEffect",
      "withFrameworkMigrationRawTransactionEffect",
    ]) {
      expect(persistenceApi).not.toHaveProperty(name);
    }
    for (const source of Object.values(packageManifest.exports)) {
      expect(source).not.toMatch(/^\.\/src\/installation\/migrationCoordination\//);
      expect(source).not.toMatch(/^\.\/src\/installation\/frameworkSchema\/(installation\/|privateMetadataSchemaSupport\.ts|target\.ts)/);
      expect(source).not.toBe("./test/installation/frameworkSchema/frameworkMigrationPGliteTarget.ts");
    }
  });

  it("keeps the legacy verifier client adapter on its existing repository contract", () => {
    expectTypeOf<
      ReturnType<
        typeof createPostgresClientDeclarativeV2VerifierProgressRepositoryV2
      >
    >().toEqualTypeOf<DeclarativeV2VerifierProgressRepositoryV2>();

    const repository =
      createPostgresClientDeclarativeV2VerifierProgressRepositoryV2(
        new Client(),
        {
          kind: "shared_database",
          databaseKey: "primary",
          schemaName: "public",
        },
        {
          repository: {
            claimDurationMilliseconds: 60_000,
          },
          quarantine: () => undefined,
        },
      );

    expect(repository.configuration._tag).toBe("Success");
    expect(Object.keys(repository).sort()).toEqual([
      "abandon",
      "acquire",
      "appendEvidencePage",
      "configuration",
      "createAttempt",
      "observeAttempt",
      "observeCommandDecision",
      "readEvidencePageBatch",
      "readSettledEvidencePageBatch",
      "release",
      "renew",
      "reserveCommand",
      "resumePending",
      "settleCommand",
    ]);
    for (const forbidden of [
      "client",
      "connect",
      "database",
      "drizzle",
      "end",
      "physicalLocator",
      "runTransaction",
      "transaction",
    ]) {
      expect(forbidden in repository).toBe(false);
    }
    expect(
      "createPostgresClientDeclarativeV2VerifierProgressRepositoryV2" in
        persistenceApi,
    ).toBe(false);
  });
});
