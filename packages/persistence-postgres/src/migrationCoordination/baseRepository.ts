import { and, eq } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { restoreStoredFrameworkSchemaReadinessReferenceBySha256InTransactionEffect } from "../frameworkSchema/installation/readinessRepository";
import { fxSystemFrameworkSchemaInstallations, fxSystemFrameworkSchemaReadiness } from "../frameworkSchema/installation/schema";
import type { RestoredFrameworkSchemaReadiness } from "../frameworkSchema/installation/storedMetadataRestoration";
import { fxSystemFrameworkMigrationPlanBases } from "./baseSchema";
import type { FrameworkMigrationBaseInstallation, RelationalMigrationPlanFrame } from "./model";
import { FrameworkMigrationRepositoryError, type FrameworkMigrationRepositoryOperation } from "./repositoryErrors";
import { fxSystemFrameworkMigrationPlans, fxSystemFrameworkMigrationPlanAdmissions } from "./schema";
import { fxSystemFrameworkMigrationPlanSteps, fxSystemFrameworkMigrationAttemptStarts } from "./schema";
import { withAdditiveMigrationGraphLimits } from "./additiveLimits";
import type { RestoredFrameworkMigrationCollisionDomain } from "./storedRestoration";
import { samePrivateJson, isStoredMigrationBaseInstallation } from "./storedValidation";

export const authenticateFrameworkMigrationBaseEffect = Effect.fn("FrameworkMigrationBase.authenticate")(
  function* (transaction: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain,
    input: FrameworkMigrationBaseInstallation, operation: FrameworkMigrationRepositoryOperation,
  ): Effect.fn.Return<RestoredFrameworkSchemaReadiness, FrameworkMigrationRepositoryError> {
    if (!isStoredMigrationBaseInstallation(input)) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    const reference: FrameworkMigrationBaseInstallation = Object.freeze({ ...input, identity: Object.freeze({
      ...input.identity, artifact: Object.freeze({ ...input.identity.artifact }),
      physicalLocator: Object.freeze({ ...input.identity.physicalLocator }),
      targetNamespace: Object.freeze({ ...input.identity.targetNamespace }),
    }) });
    const digest = yield* Effect.fromResult(Encoding.decodeHex(reference.readinessSha256)).pipe(
      Effect.mapError(() => FrameworkMigrationRepositoryError.storedCorruption(operation)));
    // Check the one-hop boundary before recursively restoring any base graph.
    const roots = yield* runDrizzleStatementEffect(transaction.select({
      version: fxSystemFrameworkMigrationPlans.frameVersion,
      planStorageId: fxSystemFrameworkMigrationPlans.planStorageId,
      previousPlanStorageId: fxSystemFrameworkMigrationPlanAdmissions.previousPlanStorageId,
    }).from(fxSystemFrameworkSchemaReadiness).innerJoin(fxSystemFrameworkSchemaInstallations,
      eq(fxSystemFrameworkSchemaReadiness.installationStorageId, fxSystemFrameworkSchemaInstallations.installationStorageId))
      .innerJoin(fxSystemFrameworkMigrationPlans, eq(fxSystemFrameworkSchemaInstallations.planStorageId,
        fxSystemFrameworkMigrationPlans.planStorageId))
      .innerJoin(fxSystemFrameworkMigrationPlanAdmissions, eq(fxSystemFrameworkSchemaInstallations.admissionStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId)).where(and(
        eq(fxSystemFrameworkSchemaReadiness.readinessSha256, digest),
        eq(fxSystemFrameworkMigrationPlans.collisionStorageId, collision.storageId),
      )).limit(1), cause => FrameworkMigrationRepositoryError.resourceFailure(operation, cause));
    if (roots[0]?.version !== 1 || roots[0].previousPlanStorageId !== null) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    const admissions = yield* runDrizzleStatementEffect(transaction.select({ id: fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId })
      .from(fxSystemFrameworkMigrationPlanAdmissions).where(eq(fxSystemFrameworkMigrationPlanAdmissions.collisionStorageId,
        collision.storageId)).limit(3), cause => FrameworkMigrationRepositoryError.resourceFailure(operation, cause));
    if (admissions.length > 2) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    const baseSteps = yield* runDrizzleStatementEffect(transaction.select({ ordinal: fxSystemFrameworkMigrationPlanSteps.stepOrdinal })
      .from(fxSystemFrameworkMigrationPlanSteps).where(eq(fxSystemFrameworkMigrationPlanSteps.planStorageId, roots[0].planStorageId))
      .limit(8), cause => FrameworkMigrationRepositoryError.resourceFailure(operation, cause));
    if (baseSteps.length > 7) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    const attempts = yield* runDrizzleStatementEffect(transaction.select({ id: fxSystemFrameworkMigrationAttemptStarts.attemptStorageId })
      .from(fxSystemFrameworkMigrationAttemptStarts).where(eq(fxSystemFrameworkMigrationAttemptStarts.planStorageId, roots[0].planStorageId))
      .limit(3), cause => FrameworkMigrationRepositoryError.resourceFailure(operation, cause));
    if (attempts.length > 2) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    const readiness = yield* restoreStoredFrameworkSchemaReadinessReferenceBySha256InTransactionEffect(
      transaction, collision, reference.readinessSha256, operation);
    const installation = readiness.installation;
    if (installation.plan.plan.frame.version !== 1 || installation.collision.storageId !== collision.storageId ||
      !samePrivateJson(installation.installation.frame.identity, reference.identity) ||
      installation.installation.sha256 !== reference.installationReceiptSha256 ||
      installation.installation.frame.installedStructureSha256 !== reference.physicalLayoutSha256 ||
      readiness.readiness.frame.validatedStructureSha256 !== reference.physicalLayoutSha256) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    return readiness;
  }, withAdditiveMigrationGraphLimits,
);

export const insertFrameworkMigrationBaseEffect = Effect.fn("FrameworkMigrationBase.insert")(
  function* (transaction: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain,
    planStorageId: bigint, frame: RelationalMigrationPlanFrame, operation: FrameworkMigrationRepositoryOperation,
  ): Effect.fn.Return<void, FrameworkMigrationRepositoryError> {
    if (frame.version === 1) return;
    const base = yield* authenticateFrameworkMigrationBaseEffect(transaction, collision, frame.baseInstallation, operation);
    const installation = base.installation;
    const decode = (value: string) => Effect.fromResult(Encoding.decodeHex(value)).pipe(
      Effect.mapError(() => FrameworkMigrationRepositoryError.storedCorruption(operation)));
    yield* runDrizzleStatementEffect(transaction.insert(fxSystemFrameworkMigrationPlanBases).values({
      planStorageId, collisionStorageId: collision.storageId,
      basePlanStorageId: installation.plan.storageId, installationStorageId: installation.storageId,
      installationSha256: yield* decode(frame.baseInstallation.identity.installationSha256),
      installationReceiptSha256: yield* decode(frame.baseInstallation.installationReceiptSha256),
      readinessStorageId: base.storageId, readinessSha256: yield* decode(frame.baseInstallation.readinessSha256),
      physicalLayoutSha256: yield* decode(frame.baseInstallation.physicalLayoutSha256),
    }), cause => FrameworkMigrationRepositoryError.resourceFailure(operation, cause));
  },
);

export const restoreFrameworkMigrationBaseEffect = Effect.fn("FrameworkMigrationBase.restore")(
  function* (transaction: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain,
    planStorageId: bigint, frame: RelationalMigrationPlanFrame, operation: FrameworkMigrationRepositoryOperation,
  ): Effect.fn.Return<Option.Option<RestoredFrameworkSchemaReadiness>, FrameworkMigrationRepositoryError> {
    const rows = yield* runDrizzleStatementEffect(transaction.select().from(fxSystemFrameworkMigrationPlanBases)
      .where(eq(fxSystemFrameworkMigrationPlanBases.planStorageId, planStorageId)).limit(2),
    cause => FrameworkMigrationRepositoryError.resourceFailure(operation, cause));
    if (frame.version === 1) {
      if (rows.length !== 0) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      return Option.none();
    }
    const row = rows[0];
    if (rows.length !== 1 || row === undefined || row.collisionStorageId !== collision.storageId ||
      Encoding.encodeHex(row.installationSha256) !== frame.baseInstallation.identity.installationSha256 ||
      Encoding.encodeHex(row.installationReceiptSha256) !== frame.baseInstallation.installationReceiptSha256 ||
      Encoding.encodeHex(row.readinessSha256) !== frame.baseInstallation.readinessSha256 ||
      Encoding.encodeHex(row.physicalLayoutSha256) !== frame.baseInstallation.physicalLayoutSha256) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    const base = yield* authenticateFrameworkMigrationBaseEffect(transaction, collision, frame.baseInstallation, operation);
    if (row.installationStorageId !== base.installation.storageId || row.readinessStorageId !== base.storageId ||
      row.basePlanStorageId !== base.installation.plan.storageId) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    return Option.some(base);
  },
);
