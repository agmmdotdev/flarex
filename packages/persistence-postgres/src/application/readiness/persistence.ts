import { Effect } from "effect";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { ApplicationTaskCatalogSnapshotError } from "../tasks/applicationTaskBindings";
import {
  type ValidateAppSchemaCandidateReadinessError,
  validateAppSchemaCandidateReadinessInTransactionEffect,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type { ValidatePointCommitUniqueConstraintEligibilityV1Error } from "../../commit/point/errors";
import type {
  ValidatePhysicalDefinitionLifecycleReadinessError,
} from "../../installation/physicalDefinitionLifecycle";
import {
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
} from "../../scope/scopeClock";
import {
  validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect,
} from "../../commit/point/uniqueEligibility";
import {
  bytesEqualFullScan,
  copyBytes,
} from "@flarex/utils/bytes";
import { appUniqueConstraintEligibilityFrame } from "../../storage/unique/appUniqueConstraintSetBuildV1";
import {
  fxSystemApplicationReadinessV1,
  fxSystemApplicationReadinessFunctionsV1,
} from "../../database/schema";
import {
  and,
  eq,
} from "drizzle-orm";
import { databaseTimestampFromUnknown } from "../../database/databaseTimestamp";
import {
  type PreparedReadiness,
  type ApplicationReadinessRepositoryIssuerV1,
  readyProjection,
} from "./identity";
import type { ApplicationReadinessContext } from "./constructionContracts";
import type { ApplicationReadinessResult } from "./contracts";
import {
  type ApplicationReadinessError,
  readinessFailure,
} from "./errors";
import {
  requireExactAuthority,
  reserveBundle,
  storedBundlesEqual,
} from "./bundle";
import {
  notReady,
  candidateNotReadyReason,
  uniqueNotReadyReason,
} from "./outcomes";
import {
  digestCanonicalJson,
  decodeSha256,
  readinessFrame,
  sha256,
} from "./frames";
import { loadPhysicalReadiness } from "./physicalCoverage";
import { bindRevisionSchema } from "./controlSchema";
import {
  query,
  targetDatabaseTime,
  execute,
} from "./databaseBoundary";
import { MAX_READINESS_BYTES } from "./limits";

export const settleReadiness = Effect.fn("ApplicationReadiness.settleTransaction")(
function* <SchemaFailure, ColdFailure>(
  tx: AppRowTransaction,
  prepared: PreparedReadiness,
  context: ApplicationReadinessContext<SchemaFailure, ColdFailure>,
  issuer: ApplicationReadinessRepositoryIssuerV1,
  mode: "settle" | "validate" = "settle",
): Effect.fn.Return<
  ApplicationReadinessResult,
  ApplicationReadinessError |
  ApplicationTaskCatalogSnapshotError |
  ValidateAppSchemaCandidateReadinessError |
  ValidatePointCommitUniqueConstraintEligibilityV1Error |
  ValidatePhysicalDefinitionLifecycleReadinessError |
  LockScopeClockForShareError |
  LockScopeClockForUpdateError
> {
    const clock = yield* (mode === "validate"
      ? lockScopeClockForShareInTransactionEffect(
        tx,
        prepared.bundle.authority.scopeId,
      )
      : lockScopeClockForUpdateInTransactionEffect(
        tx,
        prepared.bundle.authority.scopeId,
      ));
    yield* requireExactAuthority(prepared.bundle.authority, clock);
    const currentBundle = yield* reserveBundle(
      tx,
      prepared.bundle.authority,
      Object.freeze({
        deploymentId: prepared.bundle.deploymentId,
        revisionId: prepared.bundle.revision.revisionId,
      }),
      context.taskCatalog,
      mode === "validate" ? "share" : "update",
    );
    if ("status" in currentBundle) return currentBundle;
    if (!storedBundlesEqual(prepared.bundle, currentBundle)) {
      return yield* readinessFailure("storedState");
    }
    const candidateValidation = yield*
      validateAppSchemaCandidateReadinessInTransactionEffect(
        tx,
        context.candidateValidation,
        prepared.candidateValidation,
        prepared.bundle.authority,
        clock,
        "share",
      );
    if (candidateValidation.status !== "ready") {
      return notReady(
        prepared.bundle.revision.revisionId,
        candidateNotReadyReason(candidateValidation.reason),
      );
    }
    if (prepared.uniqueConstraintEligibility.status === "eligible") {
      const validatedUnique = yield*
        validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect(
          context.pointCommit,
          tx,
          prepared.uniqueConstraintEligibility.evidence,
          prepared.bundle.authority,
          clock,
        );
      if (validatedUnique.status === "not_ready") {
        return notReady(
          prepared.bundle.revision.revisionId,
          uniqueNotReadyReason(validatedUnique.reason),
          validatedUnique.lifecycle,
        );
      }
      if (validatedUnique.status !== "eligible" || !bytesEqualFullScan(
        yield* digestCanonicalJson(appUniqueConstraintEligibilityFrame(validatedUnique)),
        prepared.uniqueConstraintEligibilitySha256,
      )) return yield* readinessFailure("authorityChanged");
    }
    const physical = yield* loadPhysicalReadiness(
      tx,
      prepared.bundle.authority,
      prepared.requirements,
      context.physicalDefinitionLifecycle,
      prepared.physicalDefinitionLifecycle,
      clock,
    );
    if (physical.status === "not_ready") {
      return notReady(
        prepared.bundle.revision.revisionId,
        physical.reason,
        physical.detail,
      );
    }
    const physicalReadinessSha256 = physical.physicalReadinessSha256;
    const schemaManifestSha256 = decodeSha256(
      prepared.schema.schemaManifestSha256,
    );
    const candidateValidationReceiptSha256 = decodeSha256(
      prepared.candidateValidation.receiptSha256Hex,
    );
    if (mode === "settle") {
      yield* bindRevisionSchema(
        tx,
        prepared.bundle.revision.scopeId,
        prepared.bundle.revision.revisionId,
        prepared.bundle.deploymentId,
        prepared.bundle.publication.schemaSha256,
        prepared.schema.schemaVersionId,
        prepared.schemaVersion,
        schemaManifestSha256,
        prepared.schemaBindingSha256,
      );
    }
    const existingRows = yield* query(
      tx.select().from(fxSystemApplicationReadinessV1).where(and(
        eq(
          fxSystemApplicationReadinessV1.scopeId,
          prepared.bundle.revision.scopeId,
        ),
        eq(
          fxSystemApplicationReadinessV1.revisionId,
          prepared.bundle.revision.revisionId,
        ),
      )).limit(1).for(mode === "validate" ? "share" : "update"),
    );
    const existing = existingRows[0];
    if (mode === "validate" && existing === undefined) {
      return yield* readinessFailure("authorityChanged");
    }
    const readyAt = existing === undefined
      ? yield* targetDatabaseTime(tx, prepared.bundle.authority.scopeId)
      : databaseTimestampFromUnknown(existing.readyAt);
    if (readyAt === null) return yield* readinessFailure("storedState");
    const readinessBytes = readinessFrame(
      prepared,
      physicalReadinessSha256,
      readyAt,
    );
    if (readinessBytes.byteLength > MAX_READINESS_BYTES) {
      return yield* readinessFailure("storedState");
    }
    const readinessSha256 = yield* sha256(readinessBytes);
    if (existing !== undefined) {
      yield* validateReadinessReplay(
        tx,
        prepared,
        existing,
        physicalReadinessSha256,
        readinessSha256,
        readinessBytes,
      );
      return yield* readyProjection(
        "replayed",
        prepared,
        readinessSha256,
        readinessBytes,
        readyAt,
        issuer,
      );
    }
    const readinessInsert: typeof fxSystemApplicationReadinessV1.$inferInsert = {
        scopeId: prepared.bundle.revision.scopeId,
        revisionId: prepared.bundle.revision.revisionId,
        deploymentId: prepared.bundle.deploymentId,
        candidateId: prepared.bundle.revision.candidateId,
        analysisId: prepared.bundle.revision.analysisId,
        sourceArtifactRootSha256:
          copyBytes(prepared.bundle.revision.sourceArtifactRootSha256),
        manifestSha256: copyBytes(prepared.bundle.revision.manifestSha256),
        publicationSha256:
          copyBytes(prepared.bundle.publication.publicationSha256),
        applicationSchemaSha256:
          copyBytes(prepared.bundle.publication.schemaSha256),
        functionCatalogSha256:
          copyBytes(prepared.bundle.publication.functionCatalogSha256),
        storageGeneration: prepared.bundle.authority.storageGeneration,
        storageGenerationFence: clock.storageGenerationFence,
        epoch: clock.epoch,
        schemaVersionId: prepared.schema.schemaVersionId,
        schemaManifestSha256: copyBytes(schemaManifestSha256),
        schemaBindingSha256: copyBytes(prepared.schemaBindingSha256),
        taskCatalogBindingSha256:
          copyBytes(prepared.bundle.task.taskCatalogBindingSha256),
        runtimeHostIdentity: prepared.runtimeHostIdentity,
        compatibilityDate: prepared.compatibilityDate,
        coldReceiptSetSha256: copyBytes(prepared.coldReceiptSetSha256),
        candidateValidationReceiptSha256:
          copyBytes(candidateValidationReceiptSha256),
        uniqueConstraintStatus: prepared.uniqueConstraintEligibility.status,
        uniqueConstraintEligibilitySha256:
          copyBytes(prepared.uniqueConstraintEligibilitySha256),
        physicalReadinessSha256: copyBytes(physicalReadinessSha256),
        readinessSha256: copyBytes(readinessSha256),
        readinessBytes: copyBytes(readinessBytes),
        readyAt,
    };
    const inserted = yield* query(
      tx.insert(fxSystemApplicationReadinessV1).values(readinessInsert)
        .onConflictDoNothing().returning({
        revisionId: fxSystemApplicationReadinessV1.revisionId,
      }),
    );
    if (inserted.length !== 1) {
      return yield* readinessFailure("conflictingReplay");
    }
    if (prepared.cold.length > 0) {
      yield* execute(
        tx.insert(fxSystemApplicationReadinessFunctionsV1).values(
          prepared.cold.map(entry => ({
            scopeId: prepared.bundle.revision.scopeId,
            revisionId: prepared.bundle.revision.revisionId,
            readinessSha256: copyBytes(readinessSha256),
            functionPath: entry.functionPath,
            runtimeTargetSha256: copyBytes(entry.runtimeTargetSha256),
            coldReceiptSha256: copyBytes(entry.coldReceiptSha256),
            coldReceiptBytes: copyBytes(entry.coldReceiptBytes),
          })),
        ),
      );
    }
    return yield* readyProjection(
      "inserted",
      prepared,
      readinessSha256,
      readinessBytes,
      readyAt,
      issuer,
    );
  },
);

const validateReadinessReplay = Effect.fn(function* (
  tx: AppRowTransaction,
  prepared: PreparedReadiness,
  row: typeof fxSystemApplicationReadinessV1.$inferSelect,
  physicalReadinessSha256: Uint8Array,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
): Effect.fn.Return<void, ApplicationReadinessError> {
    if (row.deploymentId !== prepared.bundle.deploymentId ||
      row.candidateId !== prepared.bundle.revision.candidateId ||
      row.analysisId !== prepared.bundle.revision.analysisId ||
      row.storageGeneration !== prepared.bundle.authority.storageGeneration ||
      row.storageGenerationFence !==
        prepared.bundle.authority.storageGenerationFence ||
      row.epoch !== prepared.bundle.authority.epoch ||
      row.schemaVersionId !== prepared.schema.schemaVersionId ||
      row.runtimeHostIdentity !== prepared.runtimeHostIdentity ||
      row.compatibilityDate !== prepared.compatibilityDate ||
      row.uniqueConstraintStatus !==
        prepared.uniqueConstraintEligibility.status ||
      !bytesEqualFullScan(
        row.sourceArtifactRootSha256,
        prepared.bundle.revision.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(row.manifestSha256,
        prepared.bundle.revision.manifestSha256) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.bundle.publication.publicationSha256) ||
      !bytesEqualFullScan(row.applicationSchemaSha256,
        prepared.bundle.publication.schemaSha256) ||
      !bytesEqualFullScan(row.functionCatalogSha256,
        prepared.bundle.publication.functionCatalogSha256) ||
      !bytesEqualFullScan(row.schemaManifestSha256,
        decodeSha256(prepared.schema.schemaManifestSha256)) ||
      !bytesEqualFullScan(row.schemaBindingSha256,
        prepared.schemaBindingSha256) ||
      !bytesEqualFullScan(row.taskCatalogBindingSha256,
        prepared.bundle.task.taskCatalogBindingSha256) ||
      !bytesEqualFullScan(row.coldReceiptSetSha256,
        prepared.coldReceiptSetSha256) ||
      !bytesEqualFullScan(row.candidateValidationReceiptSha256,
        decodeSha256(prepared.candidateValidation.receiptSha256Hex)) ||
      !bytesEqualFullScan(row.uniqueConstraintEligibilitySha256,
        prepared.uniqueConstraintEligibilitySha256) ||
      !bytesEqualFullScan(row.physicalReadinessSha256,
        physicalReadinessSha256) ||
      !bytesEqualFullScan(row.readinessSha256, readinessSha256) ||
      !bytesEqualFullScan(row.readinessBytes, readinessBytes)) {
      return yield* readinessFailure("conflictingReplay");
    }
    const children = yield* query(
      tx.select().from(fxSystemApplicationReadinessFunctionsV1).where(and(
        eq(fxSystemApplicationReadinessFunctionsV1.scopeId, row.scopeId),
        eq(fxSystemApplicationReadinessFunctionsV1.revisionId, row.revisionId),
      )),
    );
    const childrenByPath = new Map(
      children.map(child => [child.functionPath, child] as const),
    );
    if (children.length !== prepared.cold.length ||
      childrenByPath.size !== children.length || prepared.cold.some(
      expected => {
        const child = childrenByPath.get(expected.functionPath);
        return child === undefined ||
          !bytesEqualFullScan(child.readinessSha256, readinessSha256) ||
          !bytesEqualFullScan(
            child.runtimeTargetSha256,
            expected.runtimeTargetSha256,
          ) ||
          !bytesEqualFullScan(
            child.coldReceiptSha256,
            expected.coldReceiptSha256,
          ) ||
          !bytesEqualFullScan(
            child.coldReceiptBytes,
            expected.coldReceiptBytes,
          );
      }
    )) return yield* readinessFailure("conflictingReplay");
  });
