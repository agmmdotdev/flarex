import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxSystemDataBindingHeads, fxSystemDataBindingActivations } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/schema";
import { fxControlSchemaVersions, fxControlTables, fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxSystemMetadataContractObservations,
  fxSystemIndexBuildStates, fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations, fxAppRowCurrent, fxAppRowRevisions } from
  "../../../persistence-postgres/src/database/schema";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

interface BindingSnapshot {
  readonly catalogs: readonly Pick<typeof fxControlSchemaVersions.$inferSelect, "schemaVersionId" | "manifestSha256">[];
  readonly tableIdentities: readonly (typeof fxControlTables.$inferSelect)[];
  readonly application: Effect.Success<ReturnType<PrivatePayloadSaveFixture["fixture"]["application"]["relationActivation"]["readActive"]>>;
  readonly heads: readonly (typeof fxSystemDataBindingHeads.$inferSelect)[];
  readonly activations: readonly (typeof fxSystemDataBindingActivations.$inferSelect)[];
  readonly clock: readonly (typeof fxSystemScopeClocks.$inferSelect)[];
  readonly authority: readonly (typeof fxSystemScopeExecutionAuthorities.$inferSelect)[];
  readonly metadata: readonly (typeof fxSystemMetadataContractObservations.$inferSelect)[];
  readonly indexes: readonly (typeof fxSystemIndexMaintenanceObligations.$inferSelect)[];
  readonly indexBuilds: readonly (typeof fxSystemIndexBuildStates.$inferSelect)[];
  readonly uniques: readonly (typeof fxSystemUniqueMaintenanceObligations.$inferSelect)[];
  readonly rows: readonly (typeof fxAppRowCurrent.$inferSelect)[];
  readonly revisions: readonly (typeof fxAppRowRevisions.$inferSelect)[];
  readonly published: Awaited<ReturnType<typeof publishedScopeCounts>>;
}

type Application = PrivatePayloadSaveFixture["fixture"]["application"];
export interface PrivateBindingSnapshotSource {
  readonly fixture: {
    readonly application: Pick<Application, "persistence" | "deploymentId" | "relationActivation"> & {
      readonly authority: Pick<Application["authority"], "scopeId">;
    };
    readonly control: PrivatePayloadSaveFixture["fixture"]["control"];
  };
}

export async function privatePayloadBindingSnapshot(fixture: PrivateBindingSnapshotSource): Promise<BindingSnapshot> {
  const db = fixture.fixture.application.persistence.drizzle;
  const control = fixture.fixture.control.drizzle;
  const deploymentId = fixture.fixture.application.deploymentId;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const { scopeUuid } = projectScopeIdUuidV1(scopeId);
  return {
    catalogs: await control.select({ schemaVersionId: fxControlSchemaVersions.schemaVersionId,
      manifestSha256: fxControlSchemaVersions.manifestSha256 }).from(fxControlSchemaVersions)
      .where(eq(fxControlSchemaVersions.deploymentId, deploymentId)).orderBy(fxControlSchemaVersions.schemaVersionId),
    tableIdentities: await control.select().from(fxControlTables).where(eq(fxControlTables.deploymentId, deploymentId))
      .orderBy(fxControlTables.tableId),
    application: await Effect.runPromise(fixture.fixture.application.relationActivation.readActive()),
    heads: await db.select().from(fxSystemDataBindingHeads).where(eq(fxSystemDataBindingHeads.scopeId, scopeId)),
    activations: await db.select().from(fxSystemDataBindingActivations).where(eq(fxSystemDataBindingActivations.scopeId, scopeId))
      .orderBy(fxSystemDataBindingActivations.sequence),
    clock: await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)),
    authority: await db.select().from(fxSystemScopeExecutionAuthorities).where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId)),
    metadata: await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
      .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey,
        fxSystemMetadataContractObservations.contractKey),
    indexes: await db.select().from(fxSystemIndexMaintenanceObligations).where(eq(fxSystemIndexMaintenanceObligations.scopeId, scopeId))
      .orderBy(fxSystemIndexMaintenanceObligations.indexDefinitionId, fxSystemIndexMaintenanceObligations.authorityKind,
        fxSystemIndexMaintenanceObligations.activationSequence),
    indexBuilds: await db.select().from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId, scopeId))
      .orderBy(fxSystemIndexBuildStates.indexDefinitionId),
    uniques: await db.select().from(fxSystemUniqueMaintenanceObligations).where(eq(fxSystemUniqueMaintenanceObligations.scopeId, scopeId))
      .orderBy(fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId, fxSystemUniqueMaintenanceObligations.authorityKind,
        fxSystemUniqueMaintenanceObligations.activationSequence),
    rows: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid))
      .orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
    revisions: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
      .orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    published: await publishedScopeCounts(db, scopeId),
  };
}
