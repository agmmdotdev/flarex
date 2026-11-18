import { Effect } from "effect";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { CatalogSchemaVersion } from "flarex-protocol/schema-manifest";
import type { ApplicationSchemaAuthority } from "../applicationSchemaAuthority";
import type {
  PublishedPhysicalRequirementSnapshotV1,
} from "../../storage/indexes/indexBuildReconciliation";
import type {
  PreparedPhysicalDefinitionLifecycleReadiness,
} from "../../installation/physicalDefinitionLifecycle";
import type {
  ScopeClockRecord,
  LockScopeClockForShareError,
} from "../../scope/scopeClock";
import { fxSystemApplicationReadinessV1 } from "../../database/schema";
import {
  and,
  eq,
} from "drizzle-orm";
import type { StoredBundle } from "./bundle";
import type { ApplicationReadinessColdMaterializationPort } from "./contracts";
import type { StoredReadinessAuthority } from "./identity";
import {
  type ApplicationReadinessError,
  readinessFailure,
} from "./errors";
import {
  loadStoredColdEvidence,
  type PreparedColdEvidence,
  digestColdReceiptSet,
} from "./coldEvidence";
import { query } from "./databaseBoundary";
import { databaseTimestampFromUnknown } from "../../database/databaseTimestamp";
import {
  uint8ArrayByteLength,
  isUint8ArrayWithByteLength,
  encodeBytesToLowercaseHex,
  bytesEqualFullScan,
  copyBytes,
} from "@flarex/utils/bytes";
import { MAX_READINESS_BYTES } from "./limits";
import {
  readinessFrameFromAuthority,
  sha256,
  decodeSha256,
} from "./frames";

export const loadStoredReadinessAuthority = Effect.fn(
  "ApplicationReadiness.loadStoredAuthority",
)(function* <Failure>(
  tx: AppRowTransaction,
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
  schemaBindingSha256: Uint8Array,
  requirements: PublishedPhysicalRequirementSnapshotV1,
  physicalDefinitionLifecycle:
    PreparedPhysicalDefinitionLifecycleReadiness,
  physicalReadinessSha256: Uint8Array,
  coldPort: ApplicationReadinessColdMaterializationPort<Failure>,
  lockedClock?: ScopeClockRecord,
): Effect.fn.Return<
  StoredReadinessAuthority | null,
  ApplicationReadinessError | LockScopeClockForShareError
> {
  const cold = yield* loadStoredColdEvidence(tx, bundle, coldPort, lockedClock);
  if (cold === null) return null;
  const rows = yield* query(
    tx.select().from(fxSystemApplicationReadinessV1).where(and(
      eq(fxSystemApplicationReadinessV1.scopeId, bundle.authority.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId, bundle.revision.revisionId),
    )).limit(1).for("share"),
  );
  const row = rows[0];
  if (row === undefined) return yield* readinessFailure("storedState");
  return yield* authenticateStoredReadinessAuthority(bundle, schemaVersion, schema, schemaBindingSha256,
    requirements, physicalDefinitionLifecycle, physicalReadinessSha256, row, cold);
});

export const authenticateStoredReadinessAuthority = Effect.fn('ApplicationReadiness.authenticateStoredAuthority')(
function* (
  bundle: StoredBundle, schemaVersion: CatalogSchemaVersion, schema: ApplicationSchemaAuthority,
  schemaBindingSha256: Uint8Array, requirements: PublishedPhysicalRequirementSnapshotV1,
  physicalDefinitionLifecycle: PreparedPhysicalDefinitionLifecycleReadiness,
  physicalReadinessSha256: Uint8Array, row: typeof fxSystemApplicationReadinessV1.$inferSelect,
  cold: PreparedColdEvidence,
) {
  const readyAt = databaseTimestampFromUnknown(row.readyAt);
  const readinessByteLength = uint8ArrayByteLength(row.readinessBytes);
  const sha256Fields = [
    row.sourceArtifactRootSha256,
    row.manifestSha256,
    row.publicationSha256,
    row.applicationSchemaSha256,
    row.functionCatalogSha256,
    row.schemaManifestSha256,
    row.schemaBindingSha256,
    row.taskCatalogBindingSha256,
    row.coldReceiptSetSha256,
    row.candidateValidationReceiptSha256,
    row.uniqueConstraintEligibilitySha256,
    row.physicalReadinessSha256,
    row.readinessSha256,
  ];
  if (readyAt === null ||
    sha256Fields.some(value => !isUint8ArrayWithByteLength(value, 32)) ||
    readinessByteLength === undefined || readinessByteLength < 1 ||
    readinessByteLength > MAX_READINESS_BYTES) {
    return yield* readinessFailure("storedState");
  }
  const coldReceiptSetSha256 = yield* digestColdReceiptSet(cold);
  const readinessBytes = readinessFrameFromAuthority({
    bundle,
    schemaVersionId: schema.schemaVersionId,
    schemaManifestSha256Hex: schema.schemaManifestSha256,
    schemaBindingSha256,
    runtimeHostIdentity: cold.runtimeHostIdentity,
    compatibilityDate: cold.compatibilityDate,
    coldReceiptSetSha256,
    candidateValidationReceiptSha256Hex: encodeBytesToLowercaseHex(
      row.candidateValidationReceiptSha256,
    ),
    uniqueConstraintStatus: row.uniqueConstraintStatus,
    uniqueConstraintEligibilitySha256:
      row.uniqueConstraintEligibilitySha256,
    physicalReadinessSha256,
    cold: cold.entries,
  }, readyAt);
  const readinessSha256 = yield* sha256(readinessBytes);
  if (row.deploymentId !== bundle.deploymentId ||
    row.candidateId !== bundle.revision.candidateId ||
    row.analysisId !== bundle.revision.analysisId ||
    row.storageGeneration !== bundle.authority.storageGeneration ||
    row.storageGenerationFence !== bundle.authority.storageGenerationFence ||
    row.epoch !== bundle.authority.epoch ||
    row.schemaVersionId !== schema.schemaVersionId ||
    row.runtimeHostIdentity !== cold.runtimeHostIdentity ||
    row.compatibilityDate !== cold.compatibilityDate ||
    !bytesEqualFullScan(
      row.sourceArtifactRootSha256,
      bundle.revision.sourceArtifactRootSha256,
    ) ||
    !bytesEqualFullScan(row.manifestSha256, bundle.revision.manifestSha256) ||
    !bytesEqualFullScan(
      row.publicationSha256,
      bundle.publication.publicationSha256,
    ) ||
    !bytesEqualFullScan(
      row.applicationSchemaSha256,
      bundle.publication.schemaSha256,
    ) ||
    !bytesEqualFullScan(
      row.functionCatalogSha256,
      bundle.publication.functionCatalogSha256,
    ) ||
    !bytesEqualFullScan(
      row.schemaManifestSha256,
      decodeSha256(schema.schemaManifestSha256),
    ) ||
    !bytesEqualFullScan(row.schemaBindingSha256, schemaBindingSha256) ||
    !bytesEqualFullScan(
      row.taskCatalogBindingSha256,
      bundle.task.taskCatalogBindingSha256,
    ) ||
    !bytesEqualFullScan(row.coldReceiptSetSha256, coldReceiptSetSha256) ||
    !bytesEqualFullScan(
      row.physicalReadinessSha256,
      physicalReadinessSha256,
    ) ||
    !bytesEqualFullScan(row.readinessSha256, readinessSha256) ||
    !bytesEqualFullScan(row.readinessBytes, readinessBytes)) {
    return yield* readinessFailure("storedState");
  }
  return Object.freeze({
    bundle,
    schemaVersion,
    schema,
    schemaBindingSha256: copyBytes(schemaBindingSha256),
    requirements,
    physicalDefinitionLifecycle,
    cold,
    readinessSha256: copyBytes(readinessSha256),
    readinessBytes: copyBytes(readinessBytes),
    readyAt: new Date(readyAt.getTime()),
    physicalReadinessSha256: copyBytes(physicalReadinessSha256),
  });
});
