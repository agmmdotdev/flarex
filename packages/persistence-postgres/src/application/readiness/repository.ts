import {
  hasAppSchemaCandidateReadinessComposition,
  loadAppSchemaCandidateReadinessEffect,
} from "../../storage/catalog/appSchemaCandidateValidation";
import { hasApplicationSchemaAuthorityComposition } from "../applicationSchemaAuthority";
import { isApplicationTaskCatalogSnapshotPort } from "../tasks/applicationTaskBindings";
import {
  hasPhysicalDefinitionLifecycleComposition,
  preparePhysicalDefinitionLifecycleReadinessEffect,
} from "../../installation/physicalDefinitionLifecycle";
import { Effect } from "effect";
import {
  type TrustedScopeAuthority,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
} from "../../scope/scopeAuthorityResolution";
import { FlarexDbV1StorageGenerationSchema } from "flarex-protocol/storage-authority";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../storage/indexes/indexBuildReconciliation";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import {
  appSchemaCandidateManifestSha256HexV1FromBytes,
} from "flarex-protocol/internal/app-schema-candidate-validation-v1";
import {
  loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect,
} from "../../commit/point/uniqueEligibility";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForSnapshotReadInTransactionEffect,
} from "../../scope/scopeClock";
import { appUniqueConstraintEligibilityFrame } from "../../storage/unique/appUniqueConstraintSetBuildV1";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../database/locatedTransactionIdentity";
import {
  acquireProtectedMetadataInstallationAdmission,
  captureProtectedMetadataEpoch,
} from "../../execution/preparation/preparedMetadataEpoch";
import type { ApplicationReadinessContext } from "./constructionContracts";
import type {
  ApplicationReadinessRepository,
  ApplicationReadinessResult,
  ApplicationReadinessAuthority,
} from "./contracts";
import {
  type SettleApplicationReadinessError,
  readinessFailure,
  type ReadApplicationReadinessError,
  readinessFailureValue,
  ApplicationReadinessError,
  readinessFailureForOperationValue,
} from "./errors";
import { validIdentity } from "./limits";
import {
  runLocatedTransaction,
  runTransaction,
} from "./databaseBoundary";
import { reserveBundle } from "./bundle";
import {
  requireSchemaCorrelation,
  publishSchemaBinding,
  readSchemaBinding,
} from "./controlSchema";
import {
  MAX_PHYSICAL_DEFINITIONS,
  loadPhysicalReadiness,
} from "./physicalCoverage";
import {
  notReady,
  candidateNotReadyReason,
  uniqueNotReadyReason,
} from "./outcomes";
import {
  loadStoredColdEvidence,
  materializeFunctions,
  digestColdReceiptSet,
} from "./coldEvidence";
import { digestCanonicalJson } from "./frames";
import { settleReadiness } from "./persistence";
import { loadStoredReadinessAuthority } from "./storedAuthority";
import {
  storedReadyProjection,
  registerApplicationReadinessRepository,
  createApplicationReadinessRepositoryIssuer,
} from "./identity";

export function makeApplicationReadinessRepository<SchemaFailure, ColdFailure>(
  context: ApplicationReadinessContext<SchemaFailure, ColdFailure>,
): ApplicationReadinessRepository<SchemaFailure, ColdFailure> {
  const capturedContext = Object.freeze({
    controlDb: context.controlDb,
    ...(context.protectedMetadata === undefined ? {} : { protectedMetadata: context.protectedMetadata }),
    authority: context.authority,
    schema: context.schema,
    taskCatalog: context.taskCatalog,
    candidateValidation: context.candidateValidation,
    pointCommit: context.pointCommit,
    physicalDefinitionLifecycle: context.physicalDefinitionLifecycle,
    cold: context.cold,
  });
  const issuer = createApplicationReadinessRepositoryIssuer();
  const compositionIsExact = () =>
    hasAppSchemaCandidateReadinessComposition(
      capturedContext.candidateValidation,
      capturedContext.controlDb,
      capturedContext.authority,
    ) && hasApplicationSchemaAuthorityComposition(
      capturedContext.schema,
      capturedContext.controlDb,
    ) && isApplicationTaskCatalogSnapshotPort(capturedContext.taskCatalog) &&
    hasPhysicalDefinitionLifecycleComposition(
      capturedContext.physicalDefinitionLifecycle,
      capturedContext.controlDb,
      capturedContext.authority,
    );
  const settle = Effect.fn("ApplicationReadiness.settle")(
    function* (input: {
      readonly deploymentId: string;
      readonly scopeId: TrustedScopeAuthority["scopeId"];
      readonly revisionId: string;
    }): Effect.fn.Return<
      ApplicationReadinessResult,
      SettleApplicationReadinessError<SchemaFailure, ColdFailure>
    > {
      if (!validIdentity(input.deploymentId) || !validIdentity(input.revisionId)) {
        return yield* readinessFailure("invalidInput");
      }
      if (!compositionIsExact()) {
        return yield* readinessFailure("invalidComposition");
      }
      const captured = Object.freeze({
        deploymentId: input.deploymentId,
        scopeId: input.scopeId,
        revisionId: input.revisionId,
      });
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        capturedContext.authority,
      );
      if (located.authority.storageGeneration !== "flarexdb_v1") {
        return yield* readinessFailure("authorityChanged");
      }
      const authority: ApplicationReadinessAuthority = Object.freeze({
        ...located.authority,
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      });
      const reserved = yield* runLocatedTransaction(
        located.target,
        tx => reserveBundle(
          tx,
          authority,
          captured,
          capturedContext.taskCatalog,
        ),
      );
      if ("status" in reserved) return reserved;
      const schema = yield* capturedContext.schema.publish({
        deploymentId: reserved.deploymentId,
        manifest: reserved.manifest,
      });
      const schemaVersion = schema.schemaVersion;
      yield* requireSchemaCorrelation(reserved, schemaVersion, schema);
      const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
        capturedContext.controlDb,
        Object.freeze({
          deploymentId: reserved.deploymentId,
          schemaVersionId: schema.schemaVersionId,
        }),
      );
      if (requirements === null ||
        encodeBytesToLowercaseHex(requirements.manifestSha256) !==
          schema.schemaManifestSha256) {
        return yield* readinessFailure("storedState");
      }
      if (requirements.definitions.length > MAX_PHYSICAL_DEFINITIONS) {
        return yield* readinessFailure("storedState");
      }
      const schemaBindingSha256 = yield* runTransaction(
        capturedContext.controlDb,
        tx => publishSchemaBinding(tx, reserved, schemaVersion, schema),
      );
      const candidateValidation = yield* loadAppSchemaCandidateReadinessEffect(
        capturedContext.candidateValidation,
        Object.freeze({
          deploymentId: reserved.deploymentId,
          scopeId: reserved.authority.scopeId,
          schemaVersionId: schema.schemaVersionId,
          schemaManifestSha256Hex:
            appSchemaCandidateManifestSha256HexV1FromBytes(
              requirements.manifestSha256,
            ),
        }),
      );
      if (candidateValidation.status !== "ready") {
        return notReady(
          reserved.revision.revisionId,
          candidateNotReadyReason(candidateValidation.reason),
        );
      }
      const uniqueConstraintEligibility = yield*
        loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect(
          capturedContext.pointCommit,
          Object.freeze({
            deploymentId: reserved.deploymentId,
            scopeId: reserved.authority.scopeId,
            schemaVersionId: schema.schemaVersionId,
          }),
          capturedContext.controlDb,
          capturedContext.authority,
        );
      if (uniqueConstraintEligibility.status === "not_ready") {
        return notReady(
          reserved.revision.revisionId,
          uniqueNotReadyReason(uniqueConstraintEligibility.reason),
          uniqueConstraintEligibility.lifecycle,
        );
      }
      // Unique-set closure must be observed first: once closed, its member set is
      // immutable, so lifecycle preparation cannot omit a concurrently published
      // required unique definition that the eligibility evidence admits.
      const physicalDefinitionLifecycle = yield*
        preparePhysicalDefinitionLifecycleReadinessEffect(
          capturedContext.physicalDefinitionLifecycle,
          reserved.authority.scopeId,
          requirements,
        );
      const preliminaryPhysical = yield* runLocatedTransaction(
        located.target,
        tx => Effect.gen(function* () {
          const clock = yield* lockScopeClockForShareInTransactionEffect(
            tx,
            reserved.authority.scopeId,
          );
          return yield* loadPhysicalReadiness(
            tx,
            reserved.authority,
            requirements,
            capturedContext.physicalDefinitionLifecycle,
            physicalDefinitionLifecycle,
            clock,
          );
        }),
      );
      if (preliminaryPhysical.status === "not_ready") {
        return notReady(
          reserved.revision.revisionId,
          preliminaryPhysical.reason,
          preliminaryPhysical.detail,
        );
      }
      const storedColdEvidence = yield* runLocatedTransaction(
        located.target,
        tx => loadStoredColdEvidence(tx, reserved, capturedContext.cold),
      );
      const coldEvidence = storedColdEvidence ??
        (yield* materializeFunctions(reserved, capturedContext.cold));
      const cold = coldEvidence.entries;
      const coldReceiptSetSha256 = yield* digestColdReceiptSet(coldEvidence);
      const uniqueConstraintEligibilitySha256 = yield* digestCanonicalJson(
        appUniqueConstraintEligibilityFrame(uniqueConstraintEligibility),
      );
      return yield* runLocatedTransaction(
        located.target,
        tx => settleReadiness(tx, {
          bundle: reserved,
          schemaVersion,
          schema,
          schemaBindingSha256,
          cold,
          runtimeHostIdentity: coldEvidence.runtimeHostIdentity,
          compatibilityDate: coldEvidence.compatibilityDate,
          coldReceiptSetSha256,
          requirements,
          candidateValidation: candidateValidation.evidence,
          uniqueConstraintEligibility,
          uniqueConstraintEligibilitySha256,
          physicalDefinitionLifecycle,
        }, capturedContext, issuer),
      );
    },
  );
  const readReadyOperation = Effect.fn("ApplicationReadiness.readReady")(
    function* (input: {
      readonly deploymentId: string;
      readonly scopeId: TrustedScopeAuthority["scopeId"];
      readonly revisionId: string;
    }): Effect.fn.Return<
      ApplicationReadinessResult,
      ReadApplicationReadinessError
    > {
      if (!validIdentity(input.deploymentId) || !validIdentity(input.revisionId)) {
        return yield* readinessFailure("invalidInput");
      }
      if (!compositionIsExact()) {
        return yield* readinessFailure("invalidComposition");
      }
      const captured = Object.freeze({
        deploymentId: input.deploymentId,
        scopeId: input.scopeId,
        revisionId: input.revisionId,
      });
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        capturedContext.authority,
      );
      if (located.authority.storageGeneration !== "flarexdb_v1") {
        return yield* readinessFailure("authorityChanged");
      }
      const authority: ApplicationReadinessAuthority = Object.freeze({
        ...located.authority,
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      });
      const protection = capturedContext.protectedMetadata;
      if (protection !== undefined &&
        !hasLocatedReadCommittedTargetDatabaseV1(located.target, protection.database))
        return yield* readinessFailure("invalidComposition");
      const protectedTarget = protection !== undefined &&
        hasLocatedReadCommittedTargetDatabaseV1(located.target, protection.database) ? protection : undefined;
      const first = yield* runLocatedTransaction(
        located.target,
        tx => Effect.gen(function* () {
          if (protectedTarget !== undefined) yield* acquireProtectedMetadataInstallationAdmission(
            protectedTarget.token, protectedTarget.database, tx,
          ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          const epoch = protectedTarget === undefined ? undefined :
            yield* captureProtectedMetadataEpoch(protectedTarget.token, protectedTarget.database, tx)
              .pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          const reserved = yield* reserveBundle(tx, authority, captured, capturedContext.taskCatalog, "share");
          return { reserved, epoch };
        }),
      );
      const { reserved } = first;
      if ("status" in reserved) return reserved;
      const { schema } = yield* capturedContext.schema.readPublished({
        deploymentId: reserved.deploymentId,
        manifest: reserved.manifest,
      });
      const schemaVersion = schema.schemaVersion;
      yield* requireSchemaCorrelation(reserved, schemaVersion, schema);
      const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
        capturedContext.controlDb,
        Object.freeze({
          deploymentId: reserved.deploymentId,
          schemaVersionId: schema.schemaVersionId,
        }),
      );
      if (requirements === null ||
        encodeBytesToLowercaseHex(requirements.manifestSha256) !==
          schema.schemaManifestSha256 ||
        requirements.definitions.length > MAX_PHYSICAL_DEFINITIONS) {
        return yield* readinessFailure("storedState");
      }
      const uniqueConstraintEligibility = yield*
        loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect(
          capturedContext.pointCommit,
          Object.freeze({
            deploymentId: reserved.deploymentId,
            scopeId: reserved.authority.scopeId,
            schemaVersionId: schema.schemaVersionId,
          }),
          capturedContext.controlDb,
          capturedContext.authority,
        );
      if (uniqueConstraintEligibility.status === "not_ready") {
        return notReady(
          reserved.revision.revisionId,
          uniqueNotReadyReason(uniqueConstraintEligibility.reason),
          uniqueConstraintEligibility.lifecycle,
        );
      }
      const physicalDefinitionLifecycle = yield*
        preparePhysicalDefinitionLifecycleReadinessEffect(
          capturedContext.physicalDefinitionLifecycle,
          reserved.authority.scopeId,
          requirements,
        );
      const schemaBindingSha256 = yield* runTransaction(
        capturedContext.controlDb,
        tx => readSchemaBinding(tx, reserved, schemaVersion, schema),
      ).pipe(Effect.map(binding => binding.sha256));
      const second = yield* runLocatedTransaction(
        located.target,
        tx => Effect.gen(function* () {
          if (protectedTarget !== undefined) yield* acquireProtectedMetadataInstallationAdmission(
            protectedTarget.token, protectedTarget.database, tx,
          ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(
            tx,
            reserved.authority.scopeId,
          );
          const physical = yield* loadPhysicalReadiness(
            tx,
            reserved.authority,
            requirements,
            capturedContext.physicalDefinitionLifecycle,
            physicalDefinitionLifecycle,
            clock,
          );
          if (physical.status === "not_ready") return { stored: physical };
          const storedAuthority = yield* loadStoredReadinessAuthority(
            tx,
            reserved,
            schemaVersion,
            schema,
            schemaBindingSha256,
            requirements,
            physicalDefinitionLifecycle,
            physical.physicalReadinessSha256,
            capturedContext.cold,
            // Reuse this provisional read's clock. Reacquiring FOR SHARE would
            // serialize fresh selection behind an ordinary data publication.
            clock,
          );
          if (storedAuthority === null) return yield* readinessFailure("storedState");
          const epoch = protectedTarget === undefined ? undefined :
            yield* captureProtectedMetadataEpoch(protectedTarget.token, protectedTarget.database, tx)
              .pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          return { stored: storedAuthority, epoch };
        }),
      );
      const { stored } = second;
      if (first.epoch !== undefined && second.epoch !== undefined &&
        first.epoch.generation !== second.epoch.generation)
        return yield* readinessFailure("authorityChanged");
      return "status" in stored
        ? notReady(
            reserved.revision.revisionId,
            stored.reason,
            stored.detail,
          )
        : yield* storedReadyProjection(second.epoch === undefined || protectedTarget === undefined ?
          Object.freeze({ ...stored, target: located.target }) :
          Object.freeze({ ...stored, target: located.target, protectedMetadata: Object.freeze({ database: protectedTarget.database,
            token: protectedTarget.token, epoch: second.epoch }) }), issuer);
    },
  );
  const readReady: ApplicationReadinessRepository<
    SchemaFailure,
    ColdFailure
  >["readReady"] = input => readReadyOperation(input).pipe(
    Effect.mapError(error => error instanceof ApplicationReadinessError
      ? readinessFailureForOperationValue("readReady", error)
      : error),
  );
  const repository = Object.freeze({ settle, readReady });
  registerApplicationReadinessRepository(repository, Object.freeze({
    // SAFETY: the captured context is erased to unknown at this internal
    // state boundary; the generic parameters are recovered by the typed
    // settle/readReady wrappers above.
    context: capturedContext as ApplicationReadinessContext<unknown, unknown>,
    issuer,
  }));
  return repository;
}
