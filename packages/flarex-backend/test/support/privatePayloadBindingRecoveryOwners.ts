import { Effect } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type { SplitScopePhysicalLocator } from "../../../persistence-postgres/src/scope/scopeMetadataTypes";
import type { PGliteFlarexPersistence } from "../../../persistence-postgres/src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../persistence-postgres/src/database/postgres";
import { composeRelationReadinessFixtureRuntime } from "../../../persistence-postgres/test/application/relations/applicationRelationReadinessFixture";
import { makeFrameworkSchemaTarget } from "../../../persistence-postgres/src/installation/frameworkSchema/target";
import { makeDataBindingHost } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { createPointMutationExecutionClaimAcquisitionV1 } from "../../../persistence-postgres/src/execution/claims/acquisition";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makePayloadContentProfiles } from "../../../payload-adapter/src/profile";
import { privateSaveCollections } from "./privatePayloadSaveFixture";
import { privatePayloadBindingSnapshot, type PrivateBindingSnapshotSource } from "./privatePayloadBindingSnapshot";
import { fxSystemTransactionSessions, fxSystemTransactionExecutionClaims } from "../../../persistence-postgres/src/database/schema";
import { eq } from "drizzle-orm";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";

/** Durable selection/configuration only: no retained preparation, native
 * receipt, execution object, grant or frozen graph crosses reconstruction. */
export interface PrivateBindingRecoveryConfiguration {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ScopeId;
  readonly physicalLocator: SplitScopePhysicalLocator;
  readonly schemaVersionId: CatalogSchemaVersionId;
}
type Resources = Readonly<{ persistence: PGliteFlarexPersistence | PostgresFlarexPersistence; control: PGliteFlarexPersistence }>;
type Binding = Effect.Success<ReturnType<typeof makeDataBindingHost>>;
type Acquisition = ReturnType<typeof createPointMutationExecutionClaimAcquisitionV1>;
type RecoverySnapshot = Awaited<ReturnType<typeof privatePayloadBindingSnapshot>> & Readonly<{
  sessions: readonly (typeof fxSystemTransactionSessions.$inferSelect)[];
  claims: readonly (typeof fxSystemTransactionExecutionClaims.$inferSelect)[];
}>;
export interface PrivateBindingRecoveryOwners {
  readonly binding: Binding;
  readonly recovery: Acquisition;
  readonly snapshot: () => Promise<RecoverySnapshot>;
}

/** Fresh factories over persisted data. Existing owners alone authenticate the
 * historical activation and recover committed outcomes before live admission.
 * This is test composition, not a second recovery or dispatch implementation. */
export function privatePayloadBindingRecoveryOwners(resources: Resources,
  configuration: PrivateBindingRecoveryConfiguration): Promise<PrivateBindingRecoveryOwners> {
  return Effect.runPromise(Effect.gen(function* () {
    const { persistence, control } = resources;
    const runtime = composeRelationReadinessFixtureRuntime(control, persistence, { ...configuration, bindingAdmission: true });
    const compiled = yield* compilePayloadCollections(privateSaveCollections);
    const target = yield* makeFrameworkSchemaTarget({ database: persistence.drizzle,
      deploymentId: configuration.deploymentId, canonicalPhysicalDatabaseIdentity: "private_permissions",
      physicalLocator: configuration.physicalLocator });
    const payloadProfiles = yield* makePayloadContentProfiles(compiled);
    const binding = yield* makeDataBindingHost({ database: persistence.drizzle, target,
      selection: { deploymentId: configuration.deploymentId, scopeId: configuration.scopeId },
      authority: runtime.authorityPorts, application: runtime.relationActivation,
      payloadProfiles,
      logicalStorage: { controlDb: control.drizzle, schemaVersionId: configuration.schemaVersionId,
        unique: runtime.servingOwners.uniqueConstraintEligibility } });
    const source: PrivateBindingSnapshotSource = { fixture: { control, application: { persistence,
      deploymentId: configuration.deploymentId, authority: { scopeId: configuration.scopeId },
      relationActivation: runtime.relationActivation } } };
    const scopeUuid = projectScopeIdUuidV1(configuration.scopeId).scopeUuid;
    return { binding, recovery: createPointMutationExecutionClaimAcquisitionV1(runtime.pointCommitAuthority,
      { durationMilliseconds: 60_000 }), snapshot: async () => ({ ...await privatePayloadBindingSnapshot(source),
        sessions: await persistence.drizzle.select().from(fxSystemTransactionSessions)
          .where(eq(fxSystemTransactionSessions.scopeUuid, scopeUuid)).orderBy(fxSystemTransactionSessions.sessionId),
        claims: await persistence.drizzle.select().from(fxSystemTransactionExecutionClaims)
          .where(eq(fxSystemTransactionExecutionClaims.scopeUuid, scopeUuid)).orderBy(fxSystemTransactionExecutionClaims.sessionId),
      }) };
  }));
}
