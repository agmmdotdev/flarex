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
});
