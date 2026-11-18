
import type { PersistenceJson } from "@flarex/persistence-postgres";
import type { WritableJson } from "flarex-protocol/json";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as persistenceApi from "../../src";
import packageManifest from "../../package.json" with { type: "json" };

describe("@flarex/persistence-postgres public API", () => {
  it("preserves the published name as the protocol writable JSON shape", () => {
    expectTypeOf<PersistenceJson>().toEqualTypeOf<WritableJson>();
  });

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
  it("keeps private repository and migration capabilities source-private", () => {
    expect(packageManifest.exports).not.toHaveProperty(
      "./declarative-v2-inert-repository",
    );
    for (const name of [
      "ensureFrameworkSchemaInstallationInTransactionEffect",
      "readFrameworkSchemaInstallationInTransactionEffect",
      "ensureFrameworkSchemaReadinessInTransactionEffect",
      "readFrameworkSchemaReadinessInTransactionEffect",
      "appendFrameworkSchemaAvailabilityHistoryInTransactionEffect",
      "readFrameworkSchemaAvailabilityHistoryInTransactionEffect",
      "corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect",
      "resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect",
      "restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect",
      "restoredFrameworkSchemaAvailabilityHistoryAuthority",
      "initializeFrameworkSchemaAvailabilityHeadInTransactionEffect",
      "readFrameworkSchemaAvailabilityHeadInTransactionEffect",
      "compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect",
      "isRestoredFrameworkSchemaAvailabilityHead",
      "capturedAuthorityForFrameworkSchemaAvailabilityHead",
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
      expect(source).not.toMatch(/^\.\/src\/installation\/frameworkSchema\/artifact\//);
      expect(source).not.toMatch(/^\.\/src\/storage\/relationalSchema\/physical\//);
      expect(source).not.toBe("./src/database/catalogControlSession.ts");
      expect(source).not.toBe("./src/database/readCommittedTransactionRunner.ts");
      expect(source).not.toBe("./test/installation/frameworkSchema/frameworkMigrationPGliteTarget.ts");
    }
  });
});
