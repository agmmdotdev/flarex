import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, Encoding, Exit, Result, Schema } from "effect";

import {
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";

import {
  canonicalizePhysicalEdgeDefinition,
} from "flarex-protocol/internal/application-schema-binding";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { encodeCanonicalJson, type JsonObject } from
  "flarex-protocol/json";
import { CatalogSchemaVersionIdSchema } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";

import {
  locateApplicationRelationManifestBindingEffect,
  type LocatedApplicationRelationManifestBinding,
} from "../applicationRelationBinding";
import {
  APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE,
} from "../appRelationEdges";
import {
  APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE,
  hasApplicationRelationBuildAuthorityForComposition,
  type ApplicationRelationBuildOptions,
  type ApplicationRelationBuildPort,
  type ApplicationRelationBuildReadinessReference,
  type ApplicationRelationReadinessEvidence,
  type ApplicationRelationSemanticValidationPageResult,
  type ApplicationRelationSemanticValidationProgress,
  validateApplicationRelationBuildReadinessInTransactionEffect,
  validateApplicationRelationSemanticPageInTransactionEffect,
  validateCurrentApplicationRelationBuildProjectionReferenceInTransactionEffect,
  validateHistoricalApplicationRelationBuildReadinessInTransactionEffect,
  validateReferencedApplicationRelationBuildReadinessInTransactionEffect,
} from "../applicationRelationBuild";
import {
  hasApplicationRelationCommitAuthorityForControlDb,
  type ApplicationRelationCommitPort,
  type LocatedApplicationRelationDefinition,
  type LocatedApplicationRelationDefinitionSet,
} from "../applicationRelationCommit";
import type { FlarexMetadataDatabase } from "../deployments";
import type { AppRowTransaction } from "../appRows";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { hasExactOwnDataKeys } from "../exactOwnDataKeys";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "../scopeAuthorityResolution";
import {
  lockScopeClockForUpdateInTransactionEffect,
  type ScopeClockRecord,
} from "../scopeClock";
import {
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemApplicationRelationSemanticValidations,
  fxSystemScopeClocks,
} from "../schema";
import { runLocatedReadCommittedEffect } from
  "../locatedReadCommittedEffect";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../transactionSessionAttemptKernel";
import {
  APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_CODEC_VERSION,
  APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_MAXIMUM_BYTES,
  APPLICATION_RELATION_SEMANTIC_VALIDATION_CURSOR_CODEC_VERSION,
} from "./Constants";
import {
  type AdvanceApplicationRelationReadinessError,
  ApplicationRelationReadinessDecisionUncertainError,
  ApplicationRelationReadinessCorruptionError,
  type ApplicationRelationReadinessInput,
  ApplicationRelationReadinessPersistenceError,
  type ApplicationRelationReadinessPort,
  type ApplicationRelationReadinessStepResult,
  ApplicationRelationReadinessStaleAuthorityError,
  ApplicationRelationReadinessUnavailableError,
  type ApplicationRelationSemanticReadinessEvidence,
  type ApplicationRelationSemanticReadinessOriginKind,
  type ApplicationRelationSemanticReadinessReceipt,
  type ApplicationRelationSemanticValidationAttemptFence,
  ApplicationRelationSemanticValidationAttemptFenceSchema,
  type ApplicationRelationSemanticValidationLifecycle,
  type ApplicationRelationSemanticValidationState,
  InvalidApplicationRelationReadinessInputError,
  type PreparedApplicationRelation,
  type PreparedApplicationRelationImmediateOrigin,
  type PreparedApplicationRelationPhysicalDefinition,
  type PreparedApplicationRelationReadiness,
  type PrepareApplicationRelationReadinessError,
} from "./Model";

const INPUT_KEYS = Object.freeze([
  "deploymentId",
  "applicationManifestSha256",
] as const);
const decodeDeploymentIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionGrantDeploymentIdV1Schema),
);
const decodeManifestSha256Result = Schema.decodeUnknownResult(
  Schema.toType(Schema.String.check(Schema.makeFilter((value) =>
    /^[0-9a-f]{64}$/.test(value)
      ? undefined
      : "Expected an exact lowercase hexadecimal SHA-256 digest"
  ))),
);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const TEXT_ENCODER = new TextEncoder();

interface ApplicationRelationReadinessPortState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly relationCommit: ApplicationRelationCommitPort;
  readonly relationBuild: ApplicationRelationBuildPort;
}

interface PreparedApplicationRelationReadinessState {
  readonly port: ApplicationRelationReadinessPortState;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly immediateOrigins: ReadonlyMap<
    number,
    Readonly<{
      readonly definitions: LocatedApplicationRelationDefinitionSet;
      readonly definition: LocatedApplicationRelationDefinition;
    }>
  >;
}

interface ResolvedSemanticOrigin {
  readonly kind: ApplicationRelationSemanticReadinessOriginKind;
  readonly originSemanticAttemptFence:
    ApplicationRelationSemanticValidationAttemptFence | null;
  readonly originSemanticReadinessSha256: Uint8Array | null;
  readonly physicalOriginSchemaVersionId:
    PreparedApplicationRelationReadiness["schemaVersionId"];
  readonly physicalOriginRelationOrdinal: number;
  readonly physicalEvidence: ApplicationRelationReadinessEvidence;
}

type SemanticOriginResolution =
  | Readonly<{
      readonly status: "ready";
      readonly origin: ResolvedSemanticOrigin;
    }>
  | Readonly<{
      readonly status: "missing";
      readonly reason:
        | "physicalReadinessMissing"
        | "semanticOriginMissing";
    }>;

type SemanticValidationRow =
  typeof fxSystemApplicationRelationSemanticValidations.$inferSelect;
type SemanticReadinessRow =
  typeof fxSystemApplicationRelationSemanticReadiness.$inferSelect;

type ReadinessTransactionFailure = AdvanceApplicationRelationReadinessError;

const applicationRelationReadinessPortStates = new WeakMap<
  object,
  ApplicationRelationReadinessPortState
>();
const preparedApplicationRelationReadinessStates = new WeakMap<
  object,
  PreparedApplicationRelationReadinessState
>();

export function createApplicationRelationReadinessPort(
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
  relationCommit: ApplicationRelationCommitPort,
  relationBuild: ApplicationRelationBuildPort,
): ApplicationRelationReadinessPort {
  let port: ApplicationRelationReadinessPort;
  port = Object.freeze({
    prepare: (input: ApplicationRelationReadinessInput) =>
      prepareApplicationRelationReadinessEffect(port, input),
    advance: (
      input: ApplicationRelationReadinessInput,
      options: ApplicationRelationBuildOptions = {},
    ) => advanceApplicationRelationReadinessEffect(port, input, options),
  });
  if (
    hasApplicationRelationCommitAuthorityForControlDb(
      relationCommit,
      controlDb,
    ) && hasApplicationRelationBuildAuthorityForComposition(
      relationBuild,
      controlDb,
      relationCommit,
    )
  ) {
    applicationRelationReadinessPortStates.set(port, Object.freeze({
      controlDb,
      authority: captureTrustedScopeAuthorityResolutionPorts(authority),
      relationCommit,
      relationBuild,
    }));
  }
  return port;
}

export function hasApplicationRelationReadinessAuthority(
  value: unknown,
): value is ApplicationRelationReadinessPort {
  return typeof value === "object" && value !== null &&
    applicationRelationReadinessPortStates.has(value);
}

export function hasPreparedApplicationRelationReadinessAuthority(
  port: ApplicationRelationReadinessPort,
  value: unknown,
): value is PreparedApplicationRelationReadiness {
  if (typeof value !== "object" || value === null) return false;
  const portState = applicationRelationReadinessPortStates.get(port);
  return portState !== undefined &&
    preparedApplicationRelationReadinessStates.get(value)?.port === portState;
}

function getPreparedApplicationRelationReadinessState(
  port: ApplicationRelationReadinessPort,
  prepared: PreparedApplicationRelationReadiness,
): PreparedApplicationRelationReadinessState | null {
  const portState = applicationRelationReadinessPortStates.get(port);
  const preparedState = preparedApplicationRelationReadinessStates.get(
    prepared,
  );
  return portState !== undefined && preparedState?.port === portState
    ? preparedState
    : null;
}

const advanceApplicationRelationReadinessEffect = Effect.fn(
  "ApplicationRelationReadiness.advance",
)(function* (
  port: ApplicationRelationReadinessPort,
  input: ApplicationRelationReadinessInput,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationReadinessStepResult,
  AdvanceApplicationRelationReadinessError
> {
  const portState = applicationRelationReadinessPortStates.get(port);
  if (portState === undefined) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessUnavailableError({
        reason: "compositionMissing",
      }),
    );
  }
  const prepared = yield* prepareApplicationRelationReadinessEffect(
    port,
    input,
  );
  const preparedState = getPreparedApplicationRelationReadinessState(
    port,
    prepared,
  );
  if (preparedState === null) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessUnavailableError({
        reason: "compositionMissing",
      }),
    );
  }
  const locatedAuthority = yield* resolveLocatedTrustedScopeAuthorityEffect(
    prepared.deploymentId,
    portState.authority,
  );
  const target = yield* Effect.try({
    try: () =>
      isLocatedReadCommittedAttemptTargetV1(locatedAuthority.target)
        ? locatedAuthority.target
        : null,
    catch: cause => new ApplicationRelationReadinessPersistenceError({
      operation: "targetTransaction",
      retryable: false,
      cause,
    }),
  });
  if (target === null) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessUnavailableError({
        reason: "targetCapabilityMissing",
      }),
    );
  }
  return yield* runReadinessTransaction(
    target,
    locatedAuthority.authority,
    portState,
    prepared,
    preparedState,
    options,
  );
});

class ApplicationRelationReadinessTargetInvocationFailure extends Error {
  readonly name = "ApplicationRelationReadinessTargetInvocationFailure";

  constructor(readonly invocationCause: unknown) {
    super("E01-B relation readiness target transaction invocation failed.", {
      cause: invocationCause,
    });
  }
}

const runReadinessTransaction = Effect.fn(
  "ApplicationRelationReadiness.runTransaction",
)(function* (
  target: LocatedReadCommittedAttemptTargetV1,
  authority: TrustedScopeAuthority,
  portState: ApplicationRelationReadinessPortState,
  prepared: PreparedApplicationRelationReadiness,
  preparedState: PreparedApplicationRelationReadinessState,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationReadinessStepResult,
  AdvanceApplicationRelationReadinessError
> {
  const exit = yield* Effect.exit(runLocatedReadCommittedEffect(
    guardTargetTransactionInvocation(target),
    {
      rollbackMessage: "E01-B relation readiness transaction rolled back.",
      cleanupDefect: cause => new ApplicationRelationReadinessPersistenceError({
        operation: "targetTransaction",
        retryable: false,
        cause,
      }),
    },
    tx => advanceReadinessInTransaction(
      tx,
      authority,
      portState,
      prepared,
      preparedState,
      options,
    ),
  ));
  if (Exit.isSuccess(exit)) return exit.value;
  const onlyReason = exit.cause.reasons.length === 1
    ? exit.cause.reasons[0]
    : undefined;
  if (
    onlyReason !== undefined && Cause.isDieReason(onlyReason) &&
    onlyReason.defect instanceof
      ApplicationRelationReadinessTargetInvocationFailure
  ) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessPersistenceError({
        operation: "targetTransaction",
        retryable: false,
        cause: onlyReason.defect.invocationCause,
      }),
    );
  }
  if (
    onlyReason !== undefined && Cause.isFailReason(onlyReason) &&
    onlyReason.error instanceof LocatedReadCommittedTransactionFailureV1 &&
    onlyReason.error.issue.kind === "decisionUncertain"
  ) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessDecisionUncertainError({
        scopeId: authority.scopeId,
        schemaVersionId: prepared.schemaVersionId,
        cause: onlyReason.error,
      }),
    );
  }
  if (
    onlyReason !== undefined && Cause.isFailReason(onlyReason) &&
    onlyReason.error instanceof LocatedReadCommittedTransactionFailureV1
  ) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessPersistenceError({
        operation: "targetTransaction",
        retryable: isRetryableTransactionFailure(onlyReason.error),
        cause: onlyReason.error,
      }),
    );
  }
  // SAFETY: The branches above project only isolated kernel failures. The
  // remaining Cause comes from the typed callback channel or retains defects,
  // interruption, and combined cleanup failures intact; this narrows only its
  // typed error parameter rather than folding or rebuilding the Cause.
  return yield* Effect.failCause(exit.cause as Cause.Cause<
    AdvanceApplicationRelationReadinessError
  >);
});

function guardTargetTransactionInvocation(
  target: LocatedReadCommittedAttemptTargetV1,
): LocatedReadCommittedAttemptTargetV1 {
  const guardedRun: RunLocatedReadCommittedTransactionV1 = <Value>(
    work: (tx: AppRowTransaction) => Promise<Value>,
  ): Promise<Value> => {
    let started: Promise<Value>;
    try {
      started = target[RUN_LOCATED_READ_COMMITTED_V1](work);
    } catch (cause) {
      return Promise.reject(
        new ApplicationRelationReadinessTargetInvocationFailure(cause),
      );
    }
    return Promise.resolve(started).catch((cause: unknown) => {
      if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
        throw cause;
      }
      throw new ApplicationRelationReadinessTargetInvocationFailure(cause);
    });
  };
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: TrustedScopeAuthority["scopeId"]) =>
      target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: guardedRun,
  });
}

const advanceReadinessInTransaction = Effect.fn(
  "ApplicationRelationReadiness.advanceInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  portState: ApplicationRelationReadinessPortState,
  prepared: PreparedApplicationRelationReadiness,
  preparedState: PreparedApplicationRelationReadinessState,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationReadinessStepResult,
  ReadinessTransactionFailure
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* requireCurrentAuthorityEffect(authority, clock);
  yield* runFault(options, "afterScopeClockLock");
  for (const relation of prepared.relations) {
    const definition = preparedState.definitions.definitions[
      relation.binding.relationOrdinal - 1
    ];
    if (
      definition === undefined ||
      definition.binding.relationOrdinal !== relation.binding.relationOrdinal
    ) {
      return yield* relationReadinessCorruption("definitionSet");
    }
    const directEvidence = yield*
      validateApplicationRelationBuildReadinessInTransactionEffect(
        portState.relationBuild,
        tx,
        authority,
        clock,
        preparedState.definitions,
        relation.edge.edgeDefinitionId,
      );
    if (directEvidence !== null) continue;
    if (
      relation.binding.evolution.kind !== "preserve" ||
      relation.binding.evolution.physical !== "reuse"
    ) {
      return notReadyResult(
        authority.scopeId,
        prepared.schemaVersionId,
        relation,
        "physicalReadinessMissing",
      );
    }
    const immediateOrigin = preparedState.immediateOrigins.get(
      relation.binding.relationOrdinal,
    );
    if (immediateOrigin === undefined) {
      return yield* relationReadinessCorruption("lineage");
    }
    const existing = yield* readSemanticValidationForUpdateEffect(
      tx,
      authority.scopeId,
      prepared.schemaVersionId,
      relation.binding.relationOrdinal,
    );
    if (existing !== null) {
      yield* Effect.fromResult(requireSemanticCurrentDefinitionResult(
        existing,
        prepared,
        relation,
      ));
      yield* validatePinnedPhysicalReadinessEffect(
        tx,
        authority,
        portState,
        existing,
      );
    }
    const originResolution = yield* resolveSemanticOriginEffect(
      tx,
      authority,
      clock,
      portState,
      relation,
      immediateOrigin,
    );
    if (originResolution.status === "missing") {
      return notReadyResult(
        authority.scopeId,
        prepared.schemaVersionId,
        relation,
        originResolution.reason,
      );
    }
    const origin = originResolution.origin;
    const physicalReceipt = origin.physicalEvidence.receipt;
    const physicalFrontier = yield* Effect.fromResult(
      parseNonNegativeBigintResult(
        physicalReceipt.frontierCommitSeq,
        "semanticReceipt",
      ),
    );
    if (
      physicalReceipt.storageGeneration !== clock.storageGeneration ||
      (yield* Effect.fromResult(parsePositiveBigintResult(
        physicalReceipt.storageGenerationFence,
        "semanticReceipt",
      ))) !== clock.storageGenerationFence ||
      physicalReceipt.epoch !== clock.epoch ||
      physicalFrontier > clock.lastCommitSeq
    ) {
      return notReadyResult(
        authority.scopeId,
        prepared.schemaVersionId,
        relation,
        "physicalReadinessMissing",
      );
    }
    const desired = yield* Effect.fromResult(
      initialSemanticValidationStateResult(
        authority,
        clock,
        prepared,
        relation,
        origin,
      ),
    );
    if (existing === null) {
      const initialized = yield* insertSemanticValidationEffect(tx, desired);
      yield* runFault(options, "afterLifecycleTransition");
      return semanticStepResult(initialized, "initialized");
    }
    yield* Effect.fromResult(requireSemanticDefinitionResult(
      existing,
      desired,
    ));
    if (!semanticAttemptMatches(existing, desired)) {
      const restarted = yield* restartSemanticValidationEffect(
        tx,
        existing,
        desired,
      );
      yield* runFault(options, "afterLifecycleTransition");
      return semanticStepResult(restarted, "restarted");
    }
    if (existing.lifecycle === "ready") {
      yield* readAndVerifySemanticReadinessEffect(tx, existing);
      continue;
    }
    const page = yield*
      validateApplicationRelationSemanticPageInTransactionEffect(
        portState.relationBuild,
        tx,
        authority,
        clock,
        preparedState.definitions,
        relation.edge.edgeDefinitionId,
        yield* Effect.fromResult(semanticProgressResult(existing)),
        options,
      );
    if (page.lifecycle !== "ready") {
      const advanced = yield* updateSemanticValidationEffect(
        tx,
        existing,
        page,
        null,
      );
      yield* runFault(options, "afterLifecycleTransition");
      return semanticStepResult(advanced, "advanced", page);
    }
    const settled = yield* settleSemanticReadinessEffect(
      tx,
      existing,
      page,
      options,
    );
    return semanticStepResult(settled.state, settled.status, page);
  }
  return Object.freeze({
    status: "complete",
    scopeId: authority.scopeId,
    schemaVersionId: prepared.schemaVersionId,
  });
});

const resolveSemanticOriginEffect = Effect.fn(
  "ApplicationRelationReadiness.resolveSemanticOrigin",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  portState: ApplicationRelationReadinessPortState,
  relation: PreparedApplicationRelation,
  immediate: Readonly<{
    readonly definitions: LocatedApplicationRelationDefinitionSet;
    readonly definition: LocatedApplicationRelationDefinition;
  }>,
): Effect.fn.Return<SemanticOriginResolution, ReadinessTransactionFailure> {
  const physical = yield*
    validateHistoricalApplicationRelationBuildReadinessInTransactionEffect(
      portState.relationBuild,
      tx,
      authority,
      immediate.definitions,
      immediate.definition.edge.edgeDefinitionId,
    );
  if (physical !== null) {
    return Object.freeze({
      status: "ready",
      origin: Object.freeze({
        kind: "physical",
        originSemanticAttemptFence: null,
        originSemanticReadinessSha256: null,
        physicalOriginSchemaVersionId: immediate.definitions.schemaVersionId,
        physicalOriginRelationOrdinal:
          immediate.definition.binding.relationOrdinal,
        physicalEvidence: physical,
      }),
    });
  }
  const immediateEvolution = immediate.definition.binding.evolution;
  if (
    immediateEvolution.kind !== "preserve" ||
    immediateEvolution.physical !== "reuse"
  ) {
    return Object.freeze({
      status: "missing",
      reason: "physicalReadinessMissing",
    });
  }
  const semantic = yield* readCurrentSemanticOriginEffect(
    tx,
    authority,
    clock,
    immediate.definitions,
    immediate.definition,
  );
  if (semantic === null) {
    return Object.freeze({
      status: "missing",
      reason: "semanticOriginMissing",
    });
  }
  const receipt = semantic.receipt;
  if (
    receipt.relationId !== relation.binding.relationId ||
    receipt.edgeDefinitionId !== relation.edge.edgeDefinitionId ||
    receipt.sourceTableId !== relation.binding.sourceTableId ||
    receipt.targetTableId !== relation.binding.targetTableId ||
    receipt.physicalDefinitionSha256 !==
      relation.physicalDefinitionSha256 ||
    !isNonBlankString(receipt.physicalOriginSchemaVersionId)
  ) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const reference = yield* Effect.fromResult(
    physicalReferenceFromSemanticReceiptResult(receipt),
  );
  const referencedPhysicalEvidence = yield*
    validateReferencedApplicationRelationBuildReadinessInTransactionEffect(
      portState.relationBuild,
      tx,
      authority,
      reference,
    );
  if (referencedPhysicalEvidence === null) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const physicalEvidence = yield*
    validateCurrentApplicationRelationBuildProjectionReferenceInTransactionEffect(
      portState.relationBuild,
      tx,
      authority,
      clock,
      reference,
    );
  if (physicalEvidence === null) {
    return Object.freeze({
      status: "missing",
      reason: "semanticOriginMissing",
    });
  }
  if (!bytesEqual(physicalEvidence.sha256, referencedPhysicalEvidence.sha256)) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const physicalOriginSchemaVersionId = yield* Effect.fromResult(
    decodeSchemaVersionIdResult(receipt.physicalOriginSchemaVersionId).pipe(
      Result.mapError(cause =>
        new ApplicationRelationReadinessCorruptionError({
          reason: "semanticReceipt",
          cause,
        })
      ),
    ),
  );
  return Object.freeze({
    status: "ready",
    origin: Object.freeze({
      kind: "semantic",
      originSemanticAttemptFence:
        ApplicationRelationSemanticValidationAttemptFenceSchema.make(
          yield* Effect.fromResult(
            parsePositiveBigintResult(receipt.attemptFence, "semanticReceipt"),
          ),
        ),
      originSemanticReadinessSha256: copyBytes(semantic.sha256),
      physicalOriginSchemaVersionId,
      physicalOriginRelationOrdinal: receipt.physicalOriginRelationOrdinal,
      physicalEvidence,
    }),
  });
});

const readCurrentSemanticOriginEffect = Effect.fn(
  "ApplicationRelationReadiness.readCurrentSemanticOrigin",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  definitions: LocatedApplicationRelationDefinitionSet,
  definition: LocatedApplicationRelationDefinition,
): Effect.fn.Return<
  ApplicationRelationSemanticReadinessEvidence | null,
  ReadinessTransactionFailure
> {
  const head = yield* readSemanticValidationForUpdateEffect(
    tx,
    authority.scopeId,
    definitions.schemaVersionId,
    definition.binding.relationOrdinal,
  );
  if (head === null) return null;
  yield* requireSemanticOriginDefinitionEffect(
    head,
    definitions,
    definition,
  );
  if (
    head.lifecycle !== "ready" ||
    head.readinessSha256 === null ||
    head.storageGeneration !== clock.storageGeneration ||
    head.storageGenerationFence !== clock.storageGenerationFence ||
    head.epoch !== clock.epoch ||
    head.frontierCommitSeq !== clock.lastCommitSeq
  ) {
    return null;
  }
  return yield* readAndVerifySemanticReadinessEffect(tx, head);
});

function physicalReferenceFromSemanticReceiptResult(
  receipt: ApplicationRelationSemanticReadinessReceipt,
): Result.Result<
  ApplicationRelationBuildReadinessReference,
  ApplicationRelationReadinessCorruptionError
> {
  return Result.gen(function* () {
    const physicalDefinitionSha256 = yield* decodeSha256HexResult(
      receipt.physicalDefinitionSha256,
      "semanticReceipt",
    );
    const readinessSha256 = yield* decodeSha256HexResult(
      receipt.physicalReadinessSha256,
      "semanticReceipt",
    );
    const storageGenerationFence = yield* parsePositiveBigintResult(
      receipt.storageGenerationFence,
      "semanticReceipt",
    );
    const frontierCommitSeq = yield* parseNonNegativeBigintResult(
      receipt.physicalFrontierCommitSeq,
      "semanticReceipt",
    );
    const attemptFence = yield* parsePositiveBigintResult(
      receipt.physicalAttemptFence,
      "semanticReceipt",
    );
    return Object.freeze({
      scopeId: receipt.scopeId,
      deploymentId: receipt.deploymentId,
      relationId: receipt.relationId,
      edgeDefinitionId: receipt.edgeDefinitionId,
      sourceTableId: receipt.sourceTableId,
      targetTableId: receipt.targetTableId,
      physicalDefinitionSha256,
      storageGeneration: receipt.storageGeneration,
      storageGenerationFence: StorageGenerationFenceSchema.make(
        storageGenerationFence,
      ),
      epoch: receipt.epoch,
      frontierCommitSeq: CommitSeqSchema.make(frontierCommitSeq),
      attemptFence,
      readinessSha256,
    });
  });
}

function initialSemanticValidationStateResult(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  prepared: PreparedApplicationRelationReadiness,
  relation: PreparedApplicationRelation,
  origin: ResolvedSemanticOrigin,
): Result.Result<
  ApplicationRelationSemanticValidationState,
  ApplicationRelationReadinessCorruptionError
> {
  return Result.gen(function* () {
    const evolution = relation.binding.evolution;
    if (evolution.kind !== "preserve" || evolution.physical !== "reuse") {
      return yield* readinessCorruptionResult("lineage");
    }
    const physicalReceipt = origin.physicalEvidence.receipt;
    const physicalSha256 = origin.physicalEvidence.sha256;
    if (
      physicalReceipt.scopeId !== authority.scopeId ||
      physicalReceipt.deploymentId !== prepared.deploymentId ||
      physicalReceipt.relationId !== relation.binding.relationId ||
      physicalReceipt.edgeDefinitionId !== relation.edge.edgeDefinitionId ||
      physicalReceipt.sourceTableId !== relation.binding.sourceTableId ||
      physicalReceipt.targetTableId !== relation.binding.targetTableId ||
      physicalReceipt.physicalDefinitionSha256 !==
        relation.physicalDefinitionSha256 ||
      physicalReceipt.storageGeneration !== clock.storageGeneration ||
      physicalReceipt.epoch !== clock.epoch ||
      origin.physicalOriginSchemaVersionId === prepared.schemaVersionId ||
      !isNonBlankString(origin.physicalOriginSchemaVersionId) ||
      origin.physicalOriginRelationOrdinal < 1 ||
      origin.physicalOriginRelationOrdinal > 1_024 ||
      (origin.kind === "physical") !==
        (origin.originSemanticAttemptFence === null) ||
      (origin.kind === "physical") !==
        (origin.originSemanticReadinessSha256 === null)
    ) {
      return yield* readinessCorruptionResult("semanticReceipt");
    }
    const physicalStorageFence = yield* parsePositiveBigintResult(
      physicalReceipt.storageGenerationFence,
      "semanticReceipt",
    );
    const physicalFrontier = yield* parseNonNegativeBigintResult(
      physicalReceipt.frontierCommitSeq,
      "semanticReceipt",
    );
    const physicalAttemptFence = yield* parsePositiveBigintResult(
      physicalReceipt.attemptFence,
      "semanticReceipt",
    );
    if (
      physicalStorageFence !== clock.storageGenerationFence ||
      physicalFrontier > clock.lastCommitSeq ||
      !isUint8ArrayWithByteLength(physicalSha256, 32)
    ) {
      return yield* readinessCorruptionResult("semanticReceipt");
    }
    const applicationSchemaSha256 = yield* decodeSha256HexResult(
      prepared.applicationSchemaSha256,
      "bindingMismatch",
    );
    const schemaManifestSha256 = yield* decodeSha256HexResult(
      prepared.schemaManifestSha256,
      "bindingMismatch",
    );
    const boundPublicationSha256 = yield* decodeSha256HexResult(
      prepared.boundPublicationSha256,
      "bindingMismatch",
    );
    const semanticDefinitionSha256 = yield* decodeSha256HexResult(
      relation.binding.semanticDefinitionSha256,
      "definitionSet",
    );
    const physicalDefinitionSha256 = yield* decodeSha256HexResult(
      relation.physicalDefinitionSha256,
      "definitionSet",
    );
    return Object.freeze({
      scopeId: authority.scopeId,
      deploymentId: prepared.deploymentId,
      applicationSchemaSha256,
      schemaVersionId: prepared.schemaVersionId,
      schemaVersion: prepared.schemaVersion,
      schemaManifestSha256,
      boundPublicationSha256,
      relationOrdinal: relation.binding.relationOrdinal,
      relationId: relation.binding.relationId,
      sourceTableId: relation.binding.sourceTableId,
      targetTableId: relation.binding.targetTableId,
      semanticDefinitionSha256,
      edgeDefinitionId: relation.edge.edgeDefinitionId,
      physicalDefinitionSha256,
      originSchemaVersionId: evolution.fromSchemaVersionId,
      originRelationOrdinal: evolution.fromRelationOrdinal,
      originReadinessKind: origin.kind,
      originSemanticAttemptFence: origin.originSemanticAttemptFence,
      originSemanticReadinessSha256:
        origin.originSemanticReadinessSha256 === null
          ? null
          : copyBytes(origin.originSemanticReadinessSha256),
      physicalOriginSchemaVersionId: origin.physicalOriginSchemaVersionId,
      physicalOriginRelationOrdinal: origin.physicalOriginRelationOrdinal,
      physicalAttemptFence,
      physicalReadinessSha256: copyBytes(physicalSha256),
      physicalFrontierCommitSeq: CommitSeqSchema.make(physicalFrontier),
      storageGeneration: clock.storageGeneration,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      frontierCommitSeq: clock.lastCommitSeq,
      attemptFence:
        ApplicationRelationSemanticValidationAttemptFenceSchema.make(1n),
      lifecycle: "validating_sources",
      sourceCursorRowId: null,
      edgeCursor: null,
      versionCursor: null,
      validatedSourceCount: 0n,
      validatedEdgeCount: 0n,
      validatedVersionCount: 0n,
      readinessSha256: null,
    });
  });
}

function requireSemanticCurrentDefinitionResult(
  stored: ApplicationRelationSemanticValidationState,
  prepared: PreparedApplicationRelationReadiness,
  relation: PreparedApplicationRelation,
): Result.Result<void, ApplicationRelationReadinessCorruptionError> {
  return Result.gen(function* () {
    const evolution = relation.binding.evolution;
    if (evolution.kind !== "preserve" || evolution.physical !== "reuse") {
      return yield* readinessCorruptionResult("lineage");
    }
    const applicationSchemaSha256 = yield* decodeSha256HexResult(
      prepared.applicationSchemaSha256,
      "bindingMismatch",
    );
    const schemaManifestSha256 = yield* decodeSha256HexResult(
      prepared.schemaManifestSha256,
      "bindingMismatch",
    );
    const boundPublicationSha256 = yield* decodeSha256HexResult(
      prepared.boundPublicationSha256,
      "bindingMismatch",
    );
    const semanticDefinitionSha256 = yield* decodeSha256HexResult(
      relation.binding.semanticDefinitionSha256,
      "definitionSet",
    );
    const physicalDefinitionSha256 = yield* decodeSha256HexResult(
      relation.physicalDefinitionSha256,
      "definitionSet",
    );
    if (
      stored.deploymentId !== prepared.deploymentId ||
      stored.schemaVersionId !== prepared.schemaVersionId ||
      stored.schemaVersion !== prepared.schemaVersion ||
      !bytesEqual(stored.applicationSchemaSha256, applicationSchemaSha256) ||
      !bytesEqual(stored.schemaManifestSha256, schemaManifestSha256) ||
      !bytesEqual(stored.boundPublicationSha256, boundPublicationSha256) ||
      stored.relationOrdinal !== relation.binding.relationOrdinal ||
      stored.relationId !== relation.binding.relationId ||
      stored.sourceTableId !== relation.binding.sourceTableId ||
      stored.targetTableId !== relation.binding.targetTableId ||
      !bytesEqual(
        stored.semanticDefinitionSha256,
        semanticDefinitionSha256,
      ) ||
      stored.edgeDefinitionId !== relation.edge.edgeDefinitionId ||
      !bytesEqual(
        stored.physicalDefinitionSha256,
        physicalDefinitionSha256,
      ) ||
      stored.originSchemaVersionId !== evolution.fromSchemaVersionId ||
      stored.originRelationOrdinal !== evolution.fromRelationOrdinal
    ) {
      return yield* readinessCorruptionResult("storedValidation");
    }
  });
}

const validatePinnedPhysicalReadinessEffect = Effect.fn(
  "ApplicationRelationReadiness.validatePinnedPhysicalReadiness",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  portState: ApplicationRelationReadinessPortState,
  stored: ApplicationRelationSemanticValidationState,
): Effect.fn.Return<
  ApplicationRelationReadinessEvidence,
  ReadinessTransactionFailure
> {
  const evidence = yield*
    validateReferencedApplicationRelationBuildReadinessInTransactionEffect(
      portState.relationBuild,
      tx,
      authority,
      {
        scopeId: stored.scopeId,
        deploymentId: stored.deploymentId,
        relationId: stored.relationId,
        edgeDefinitionId: stored.edgeDefinitionId,
        sourceTableId: stored.sourceTableId,
        targetTableId: stored.targetTableId,
        physicalDefinitionSha256: copyBytes(
          stored.physicalDefinitionSha256,
        ),
        storageGeneration: stored.storageGeneration,
        storageGenerationFence: stored.storageGenerationFence,
        epoch: stored.epoch,
        frontierCommitSeq: stored.physicalFrontierCommitSeq,
        attemptFence: stored.physicalAttemptFence,
        readinessSha256: copyBytes(stored.physicalReadinessSha256),
      },
    );
  if (evidence === null) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  return evidence;
});

function requireSemanticDefinitionResult(
  stored: ApplicationRelationSemanticValidationState,
  desired: ApplicationRelationSemanticValidationState,
): Result.Result<void, ApplicationRelationReadinessCorruptionError> {
  return stored.scopeId === desired.scopeId &&
      stored.deploymentId === desired.deploymentId &&
      bytesEqual(
        stored.applicationSchemaSha256,
        desired.applicationSchemaSha256,
      ) &&
      stored.schemaVersionId === desired.schemaVersionId &&
      stored.schemaVersion === desired.schemaVersion &&
      bytesEqual(stored.schemaManifestSha256, desired.schemaManifestSha256) &&
      bytesEqual(
        stored.boundPublicationSha256,
        desired.boundPublicationSha256,
      ) &&
      stored.relationOrdinal === desired.relationOrdinal &&
      stored.relationId === desired.relationId &&
      stored.sourceTableId === desired.sourceTableId &&
      stored.targetTableId === desired.targetTableId &&
      bytesEqual(
        stored.semanticDefinitionSha256,
        desired.semanticDefinitionSha256,
      ) &&
      stored.edgeDefinitionId === desired.edgeDefinitionId &&
      bytesEqual(
        stored.physicalDefinitionSha256,
        desired.physicalDefinitionSha256,
      ) &&
      stored.originSchemaVersionId === desired.originSchemaVersionId &&
      stored.originRelationOrdinal === desired.originRelationOrdinal
    ? Result.succeed(undefined)
    : readinessCorruptionResult("storedValidation");
}

const requireSemanticOriginDefinitionEffect = Effect.fn(
  "ApplicationRelationReadiness.requireSemanticOriginDefinition",
)(function* (
  stored: ApplicationRelationSemanticValidationState,
  definitions: LocatedApplicationRelationDefinitionSet,
  definition: LocatedApplicationRelationDefinition,
): Effect.fn.Return<void, ApplicationRelationReadinessCorruptionError> {
    const evolution = definition.binding.evolution;
    if (
      evolution.kind !== "preserve" ||
      evolution.physical !== "reuse"
    ) {
      return yield* relationReadinessCorruption("lineage");
    }
    const applicationSchemaSha256 = yield* Effect.fromResult(decodeSha256HexResult(
      definitions.applicationSchemaSha256,
      "lineage",
    ));
    const schemaManifestSha256 = yield* Effect.fromResult(decodeSha256HexResult(
      definitions.schemaManifestSha256,
      "lineage",
    ));
    const boundPublicationSha256 = yield* Effect.fromResult(decodeSha256HexResult(
      definitions.boundPublicationSha256,
      "lineage",
    ));
    const semanticDefinitionSha256 = yield* Effect.fromResult(decodeSha256HexResult(
      definition.binding.semanticDefinitionSha256,
      "lineage",
    ));
    const canonicalPhysical = yield* canonicalizePhysicalEdgeDefinition(
      definition.edge.physical,
    ).pipe(
      Effect.mapError(cause => new ApplicationRelationReadinessCorruptionError({
        reason: "lineage",
        cause,
      })),
    );
    const physicalDefinitionSha256 = yield* Effect.fromResult(decodeSha256HexResult(
      canonicalPhysical.sha256Hex,
      "lineage",
    ));
    if (
      stored.deploymentId !== definitions.deploymentId ||
      stored.schemaVersionId !== definitions.schemaVersionId ||
      !bytesEqual(stored.applicationSchemaSha256, applicationSchemaSha256) ||
      !bytesEqual(stored.schemaManifestSha256, schemaManifestSha256) ||
      !bytesEqual(stored.boundPublicationSha256, boundPublicationSha256) ||
      stored.relationOrdinal !== definition.binding.relationOrdinal ||
      stored.relationId !== definition.binding.relationId ||
      stored.sourceTableId !== definition.binding.sourceTableId ||
      stored.targetTableId !== definition.binding.targetTableId ||
      !bytesEqual(
        stored.semanticDefinitionSha256,
        semanticDefinitionSha256,
      ) ||
      stored.edgeDefinitionId !== definition.edge.edgeDefinitionId ||
      !bytesEqual(
        stored.physicalDefinitionSha256,
        physicalDefinitionSha256,
      ) ||
      stored.originSchemaVersionId !== evolution.fromSchemaVersionId ||
      stored.originRelationOrdinal !== evolution.fromRelationOrdinal
    ) {
      return yield* relationReadinessCorruption("lineage");
    }
});

function semanticAttemptMatches(
  stored: ApplicationRelationSemanticValidationState,
  desired: ApplicationRelationSemanticValidationState,
): boolean {
  return stored.originReadinessKind === desired.originReadinessKind &&
    stored.physicalOriginSchemaVersionId ===
      desired.physicalOriginSchemaVersionId &&
    stored.physicalOriginRelationOrdinal ===
      desired.physicalOriginRelationOrdinal &&
    nullableBigintEqual(
    stored.originSemanticAttemptFence,
    desired.originSemanticAttemptFence,
  ) && nullableBytesEqual(
    stored.originSemanticReadinessSha256,
    desired.originSemanticReadinessSha256,
  ) && stored.physicalAttemptFence === desired.physicalAttemptFence &&
    bytesEqual(
      stored.physicalReadinessSha256,
      desired.physicalReadinessSha256,
    ) &&
    stored.physicalFrontierCommitSeq === desired.physicalFrontierCommitSeq &&
    stored.storageGeneration === desired.storageGeneration &&
    stored.storageGenerationFence === desired.storageGenerationFence &&
    stored.epoch === desired.epoch &&
    stored.frontierCommitSeq === desired.frontierCommitSeq;
}

function semanticProgressResult(
  state: ApplicationRelationSemanticValidationState,
): Result.Result<
  ApplicationRelationSemanticValidationProgress,
  ApplicationRelationReadinessCorruptionError
> {
  if (state.lifecycle === "ready") {
    return readinessCorruptionResult("storedValidation");
  }
  return Result.succeed(Object.freeze({
    relationOrdinal: state.relationOrdinal,
    lifecycle: state.lifecycle,
    rootFrontierCommitSeq: state.physicalFrontierCommitSeq,
    frontierCommitSeq: state.frontierCommitSeq,
    attemptFence: state.attemptFence,
    sourceCursorRowId: state.sourceCursorRowId,
    edgeCursor: state.edgeCursor,
    versionCursor: state.versionCursor,
    validatedSourceCount: state.validatedSourceCount,
    validatedEdgeCount: state.validatedEdgeCount,
    validatedVersionCount: state.validatedVersionCount,
  }));
}

function notReadyResult(
  scopeId: TrustedScopeAuthority["scopeId"],
  schemaVersionId: PreparedApplicationRelationReadiness["schemaVersionId"],
  relation: PreparedApplicationRelation,
  reason: Extract<
    ApplicationRelationReadinessStepResult,
    { readonly status: "not_ready" }
  >["reason"],
): ApplicationRelationReadinessStepResult {
  return Object.freeze({
    status: "not_ready",
    reason,
    scopeId,
    schemaVersionId,
    relationOrdinal: relation.binding.relationOrdinal,
    edgeDefinitionId: relation.edge.edgeDefinitionId,
  });
}

function semanticStepResult(
  state: ApplicationRelationSemanticValidationState,
  status: Extract<
    ApplicationRelationReadinessStepResult,
    { readonly lifecycle: ApplicationRelationSemanticValidationLifecycle }
  >["status"],
  page?: ApplicationRelationSemanticValidationPageResult,
): ApplicationRelationReadinessStepResult {
  return Object.freeze({
    status,
    scopeId: state.scopeId,
    schemaVersionId: state.schemaVersionId,
    relationOrdinal: state.relationOrdinal,
    edgeDefinitionId: state.edgeDefinitionId,
    lifecycle: state.lifecycle,
    frontierCommitSeq: state.frontierCommitSeq,
    attemptFence: state.attemptFence,
    processedSourceRows: page?.processedSourceRows ?? 0,
    processedEdges: page?.processedEdges ?? 0,
    processedVersions: page?.processedVersions ?? 0,
  });
}

const readSemanticValidationForUpdateEffect = Effect.fn(
  "ApplicationRelationReadiness.readValidation",
)(function* (
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  schemaVersionId: PreparedApplicationRelationReadiness["schemaVersionId"],
  relationOrdinal: number,
): Effect.fn.Return<
  ApplicationRelationSemanticValidationState | null,
  ApplicationRelationReadinessPersistenceError |
    ApplicationRelationReadinessCorruptionError
> {
  const rows = yield* queryEffect(
    "readValidation",
    tx.select().from(
      fxSystemApplicationRelationSemanticValidations,
    ).where(and(
      eq(
        fxSystemApplicationRelationSemanticValidations.scopeId,
        scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.schemaVersionId,
        schemaVersionId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.relationOrdinal,
        relationOrdinal,
      ),
    )).limit(1).for("update"),
  );
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeSemanticValidationResult(row));
});

const insertSemanticValidationEffect = Effect.fn(
  "ApplicationRelationReadiness.insertValidation",
)(function* (
  tx: AppRowTransaction,
  state: ApplicationRelationSemanticValidationState,
): Effect.fn.Return<
  ApplicationRelationSemanticValidationState,
  ApplicationRelationReadinessPersistenceError |
    ApplicationRelationReadinessCorruptionError
> {
  const rows = yield* queryEffect(
    "insertValidation",
    tx.insert(fxSystemApplicationRelationSemanticValidations).values(
      semanticValidationValues(state),
    ).onConflictDoNothing().returning(),
  );
  const row = rows[0];
  if (row === undefined || rows.length !== 1) {
    return yield* relationReadinessCorruption("concurrentStateChange");
  }
  return yield* Effect.fromResult(decodeSemanticValidationResult(row));
});

const restartSemanticValidationEffect = Effect.fn(
  "ApplicationRelationReadiness.restartValidation",
)(function* (
  tx: AppRowTransaction,
  existing: ApplicationRelationSemanticValidationState,
  desired: ApplicationRelationSemanticValidationState,
): Effect.fn.Return<
  ApplicationRelationSemanticValidationState,
  ApplicationRelationReadinessPersistenceError |
    ApplicationRelationReadinessCorruptionError
> {
  if (existing.attemptFence >= MAX_PERSISTED_SIGNED_INT64_V1) {
    return yield* relationReadinessCorruption("attemptFenceExhausted");
  }
  const nextAttemptFence =
    ApplicationRelationSemanticValidationAttemptFenceSchema.make(
      existing.attemptFence + 1n,
    );
  const rows = yield* queryEffect(
    "updateValidation",
    tx.update(fxSystemApplicationRelationSemanticValidations).set({
      originReadinessKind: desired.originReadinessKind,
      originSemanticAttemptFence: desired.originSemanticAttemptFence,
      originSemanticReadinessSha256:
        desired.originSemanticReadinessSha256 === null
          ? null
          : copyBytes(desired.originSemanticReadinessSha256),
      physicalOriginSchemaVersionId:
        desired.physicalOriginSchemaVersionId,
      physicalOriginRelationOrdinal:
        desired.physicalOriginRelationOrdinal,
      physicalAttemptFence: desired.physicalAttemptFence,
      physicalReadinessSha256: copyBytes(
        desired.physicalReadinessSha256,
      ),
      physicalFrontierCommitSeq: desired.physicalFrontierCommitSeq,
      storageGeneration: desired.storageGeneration,
      storageGenerationFence: desired.storageGenerationFence,
      epoch: desired.epoch,
      frontierCommitSeq: desired.frontierCommitSeq,
      attemptFence: nextAttemptFence,
      lifecycle: "validating_sources",
      sourceCursorRowId: null,
      edgeCursorSourceRowId: null,
      edgeCursorTargetRowId: null,
      versionCursorDirection: null,
      versionCursorEndpointRowId: null,
      validatedSourceCount: 0n,
      validatedEdgeCount: 0n,
      validatedVersionCount: 0n,
      readinessSha256: null,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(
        fxSystemApplicationRelationSemanticValidations.scopeId,
        existing.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.schemaVersionId,
        existing.schemaVersionId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.relationOrdinal,
        existing.relationOrdinal,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.attemptFence,
        existing.attemptFence,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.lifecycle,
        existing.lifecycle,
      ),
    )).returning(),
  );
  const row = rows[0];
  if (row === undefined || rows.length !== 1) {
    return yield* relationReadinessCorruption("concurrentStateChange");
  }
  return yield* Effect.fromResult(decodeSemanticValidationResult(row));
});

const updateSemanticValidationEffect = Effect.fn(
  "ApplicationRelationReadiness.updateValidation",
)(function* (
  tx: AppRowTransaction,
  existing: ApplicationRelationSemanticValidationState,
  page: ApplicationRelationSemanticValidationPageResult,
  readinessSha256: Uint8Array | null,
): Effect.fn.Return<
  ApplicationRelationSemanticValidationState,
  ApplicationRelationReadinessPersistenceError |
    ApplicationRelationReadinessCorruptionError
> {
  yield* Effect.fromResult(requireSemanticPageTransitionResult(existing, page));
  if (
    (page.lifecycle === "ready") !== (readinessSha256 !== null) ||
    (readinessSha256 !== null &&
      !isUint8ArrayWithByteLength(readinessSha256, 32))
  ) {
    return yield* relationReadinessCorruption("storedValidation");
  }
  const rows = yield* queryEffect(
    "updateValidation",
    tx.update(fxSystemApplicationRelationSemanticValidations).set({
      lifecycle: page.lifecycle,
      sourceCursorRowId: page.sourceCursorRowId === null
        ? null
        : appRowIdHexV1ToBytes(page.sourceCursorRowId),
      edgeCursorSourceRowId: page.edgeCursor === null
        ? null
        : appRowIdHexV1ToBytes(page.edgeCursor.sourceRowId),
      edgeCursorTargetRowId: page.edgeCursor === null
        ? null
        : appRowIdHexV1ToBytes(page.edgeCursor.targetRowId),
      versionCursorDirection: page.versionCursor?.direction ?? null,
      versionCursorEndpointRowId: page.versionCursor === null
        ? null
        : appRowIdHexV1ToBytes(page.versionCursor.endpointRowId),
      validatedSourceCount: page.validatedSourceCount,
      validatedEdgeCount: page.validatedEdgeCount,
      validatedVersionCount: page.validatedVersionCount,
      readinessSha256: readinessSha256 === null
        ? null
        : copyBytes(readinessSha256),
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(
        fxSystemApplicationRelationSemanticValidations.scopeId,
        existing.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.schemaVersionId,
        existing.schemaVersionId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.relationOrdinal,
        existing.relationOrdinal,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.attemptFence,
        existing.attemptFence,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.lifecycle,
        existing.lifecycle,
      ),
    )).returning(),
  );
  const row = rows[0];
  if (row === undefined || rows.length !== 1) {
    return yield* relationReadinessCorruption("concurrentStateChange");
  }
  return yield* Effect.fromResult(decodeSemanticValidationResult(row));
});

function requireSemanticPageTransitionResult(
  existing: ApplicationRelationSemanticValidationState,
  page: ApplicationRelationSemanticValidationPageResult,
): Result.Result<void, ApplicationRelationReadinessCorruptionError> {
  if (
    existing.lifecycle === "ready" ||
    page.relationOrdinal !== existing.relationOrdinal ||
    page.rootFrontierCommitSeq !== existing.physicalFrontierCommitSeq ||
    page.frontierCommitSeq !== existing.frontierCommitSeq ||
    page.attemptFence !== existing.attemptFence ||
    !isBoundedPageCount(
      page.processedSourceRows,
      APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE,
    ) ||
    !isBoundedPageCount(
      page.processedEdges,
      APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE,
    ) ||
    !isBoundedPageCount(
      page.processedVersions,
      APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE,
    ) ||
    page.validatedSourceCount < 0n ||
    page.validatedEdgeCount < 0n ||
    page.validatedVersionCount < 0n ||
    !semanticStateProgressMatchesLifecycle(page)
  ) {
    return readinessCorruptionResult("storedValidation");
  }
  switch (existing.lifecycle) {
    case "validating_sources": {
      const continues = page.processedSourceRows ===
        APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE;
      const sourceDelta = page.validatedSourceCount -
        existing.validatedSourceCount;
      return page.processedEdges === 0 &&
          page.processedVersions === 0 &&
          sourceDelta >= 0n &&
          sourceDelta <= BigInt(page.processedSourceRows) &&
          page.validatedEdgeCount === existing.validatedEdgeCount &&
          page.validatedVersionCount === existing.validatedVersionCount &&
          (continues
            ? page.lifecycle === "validating_sources" &&
              rowCursorAdvances(
                existing.sourceCursorRowId,
                page.sourceCursorRowId,
              )
            : page.lifecycle === "validating_edges" &&
              page.sourceCursorRowId === null)
        ? Result.succeed(undefined)
        : readinessCorruptionResult("storedValidation");
    }
    case "validating_edges": {
      const continues = page.processedEdges ===
        APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE;
      return page.processedSourceRows === 0 &&
          page.processedVersions === 0 &&
          page.validatedSourceCount === existing.validatedSourceCount &&
          page.validatedEdgeCount === existing.validatedEdgeCount +
            BigInt(page.processedEdges) &&
          page.validatedVersionCount === existing.validatedVersionCount &&
          (continues
            ? page.lifecycle === "validating_edges" &&
              edgeCursorAdvances(existing.edgeCursor, page.edgeCursor)
            : page.lifecycle === "validating_versions" &&
              page.edgeCursor === null)
        ? Result.succeed(undefined)
        : readinessCorruptionResult("storedValidation");
    }
    case "validating_versions": {
      const continues = page.processedVersions ===
        APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE;
      return page.processedSourceRows === 0 &&
          page.processedEdges === 0 &&
          page.validatedSourceCount === existing.validatedSourceCount &&
          page.validatedEdgeCount === existing.validatedEdgeCount &&
          page.validatedVersionCount === existing.validatedVersionCount +
            BigInt(page.processedVersions) &&
          (continues
            ? page.lifecycle === "validating_versions" &&
              versionCursorAdvances(existing.versionCursor, page.versionCursor)
            : page.lifecycle === "ready" && page.versionCursor === null)
        ? Result.succeed(undefined)
        : readinessCorruptionResult("storedValidation");
    }
  }
}

function isBoundedPageCount(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function rowCursorAdvances(
  previous: ApplicationRelationSemanticValidationState["sourceCursorRowId"],
  current: ApplicationRelationSemanticValidationPageResult["sourceCursorRowId"],
): boolean {
  return current !== null && (previous === null || current > previous);
}

function edgeCursorAdvances(
  previous: ApplicationRelationSemanticValidationState["edgeCursor"],
  current: ApplicationRelationSemanticValidationPageResult["edgeCursor"],
): boolean {
  if (current === null) return false;
  return previous === null || current.sourceRowId > previous.sourceRowId ||
    (current.sourceRowId === previous.sourceRowId &&
      current.targetRowId > previous.targetRowId);
}

function versionCursorAdvances(
  previous: ApplicationRelationSemanticValidationState["versionCursor"],
  current: ApplicationRelationSemanticValidationPageResult["versionCursor"],
): boolean {
  if (current === null) return false;
  if (previous === null) return true;
  const previousDirection = previous.direction === "incoming" ? 0 : 1;
  const currentDirection = current.direction === "incoming" ? 0 : 1;
  return currentDirection > previousDirection ||
    (currentDirection === previousDirection &&
      current.endpointRowId > previous.endpointRowId);
}

function semanticValidationValues(
  state: ApplicationRelationSemanticValidationState,
): typeof fxSystemApplicationRelationSemanticValidations.$inferInsert {
  return {
    scopeId: state.scopeId,
    deploymentId: state.deploymentId,
    applicationSchemaSha256: copyBytes(state.applicationSchemaSha256),
    schemaVersionId: state.schemaVersionId,
    schemaVersion: state.schemaVersion,
    schemaManifestSha256: copyBytes(state.schemaManifestSha256),
    boundPublicationSha256: copyBytes(state.boundPublicationSha256),
    relationOrdinal: state.relationOrdinal,
    relationId: state.relationId,
    sourceTableId: state.sourceTableId,
    targetTableId: state.targetTableId,
    semanticDefinitionSha256: copyBytes(state.semanticDefinitionSha256),
    edgeDefinitionId: state.edgeDefinitionId,
    physicalDefinitionSha256: copyBytes(state.physicalDefinitionSha256),
    originSchemaVersionId: state.originSchemaVersionId,
    originRelationOrdinal: state.originRelationOrdinal,
    originReadinessKind: state.originReadinessKind,
    originSemanticAttemptFence: state.originSemanticAttemptFence,
    originSemanticReadinessSha256:
      state.originSemanticReadinessSha256 === null
        ? null
        : copyBytes(state.originSemanticReadinessSha256),
    physicalOriginSchemaVersionId: state.physicalOriginSchemaVersionId,
    physicalOriginRelationOrdinal: state.physicalOriginRelationOrdinal,
    physicalAttemptFence: state.physicalAttemptFence,
    physicalReadinessSha256: copyBytes(state.physicalReadinessSha256),
    physicalFrontierCommitSeq: state.physicalFrontierCommitSeq,
    storageGeneration: state.storageGeneration,
    storageGenerationFence: state.storageGenerationFence,
    epoch: state.epoch,
    frontierCommitSeq: state.frontierCommitSeq,
    attemptFence: state.attemptFence,
    lifecycle: state.lifecycle,
    cursorCodecVersion:
      APPLICATION_RELATION_SEMANTIC_VALIDATION_CURSOR_CODEC_VERSION,
    sourceCursorRowId: state.sourceCursorRowId === null
      ? null
      : appRowIdHexV1ToBytes(state.sourceCursorRowId),
    edgeCursorSourceRowId: state.edgeCursor === null
      ? null
      : appRowIdHexV1ToBytes(state.edgeCursor.sourceRowId),
    edgeCursorTargetRowId: state.edgeCursor === null
      ? null
      : appRowIdHexV1ToBytes(state.edgeCursor.targetRowId),
    versionCursorDirection: state.versionCursor?.direction ?? null,
    versionCursorEndpointRowId: state.versionCursor === null
      ? null
      : appRowIdHexV1ToBytes(state.versionCursor.endpointRowId),
    validatedSourceCount: state.validatedSourceCount,
    validatedEdgeCount: state.validatedEdgeCount,
    validatedVersionCount: state.validatedVersionCount,
    readinessSha256: state.readinessSha256 === null
      ? null
      : copyBytes(state.readinessSha256),
  };
}

function decodeSemanticValidationResult(
  row: SemanticValidationRow,
): Result.Result<
  ApplicationRelationSemanticValidationState,
  ApplicationRelationReadinessCorruptionError
> {
  return Result.gen(function* () {
    const createdAt = copyFiniteDate(row.createdAt);
    const updatedAt = copyFiniteDate(row.updatedAt);
    if (
      !isNonBlankString(row.scopeId) ||
      !isNonBlankString(row.deploymentId) ||
      !isNonBlankString(row.schemaVersionId) ||
      !Number.isSafeInteger(row.schemaVersion) || row.schemaVersion < 1 ||
      !isPositiveSafeInteger(row.relationOrdinal) ||
      row.relationOrdinal > 1_024 ||
      !isPositiveSafeInteger(row.relationId) ||
      !isPositiveSafeInteger(row.sourceTableId) ||
      !isPositiveSafeInteger(row.targetTableId) ||
      !isPositiveSafeInteger(row.edgeDefinitionId) ||
      !isUint8ArrayWithByteLength(row.applicationSchemaSha256, 32) ||
      !isUint8ArrayWithByteLength(row.schemaManifestSha256, 32) ||
      !isUint8ArrayWithByteLength(row.boundPublicationSha256, 32) ||
      !isUint8ArrayWithByteLength(row.semanticDefinitionSha256, 32) ||
      !isUint8ArrayWithByteLength(row.physicalDefinitionSha256, 32) ||
      !isNonBlankString(row.originSchemaVersionId) ||
      row.originSchemaVersionId === row.schemaVersionId ||
      !isPositiveSafeInteger(row.originRelationOrdinal) ||
      row.originRelationOrdinal > 1_024 ||
      !isSemanticOriginKind(row.originReadinessKind) ||
      !isNonBlankString(row.physicalOriginSchemaVersionId) ||
      row.physicalOriginSchemaVersionId === row.schemaVersionId ||
      !isPositiveSafeInteger(row.physicalOriginRelationOrdinal) ||
      row.physicalOriginRelationOrdinal > 1_024 ||
      row.physicalAttemptFence < 1n ||
      !isUint8ArrayWithByteLength(row.physicalReadinessSha256, 32) ||
      row.physicalFrontierCommitSeq < 0n ||
      row.storageGeneration !== "flarexdb_v1" ||
      row.storageGenerationFence < 1n ||
      !isNonBlankString(row.epoch) ||
      row.frontierCommitSeq < row.physicalFrontierCommitSeq ||
      row.attemptFence < 1n ||
      !isSemanticLifecycle(row.lifecycle) ||
      row.cursorCodecVersion !==
        APPLICATION_RELATION_SEMANTIC_VALIDATION_CURSOR_CODEC_VERSION ||
      row.validatedSourceCount < 0n ||
      row.validatedEdgeCount < 0n ||
      row.validatedVersionCount < 0n ||
      createdAt === undefined || updatedAt === undefined ||
      updatedAt.getTime() < createdAt.getTime()
    ) {
      return yield* readinessCorruptionResult("storedValidation");
    }
    const semanticPointerPresent =
      row.originSemanticAttemptFence !== null &&
      row.originSemanticReadinessSha256 !== null;
    if (
      (row.originReadinessKind === "semantic") !== semanticPointerPresent ||
      (row.originSemanticAttemptFence !== null &&
        row.originSemanticAttemptFence < 1n) ||
      (row.originSemanticReadinessSha256 !== null &&
        !isUint8ArrayWithByteLength(
          row.originSemanticReadinessSha256,
          32,
        ))
    ) {
      return yield* readinessCorruptionResult("storedValidation");
    }
    const sourceCursorRowId = yield* decodeNullableRowIdResult(
      row.sourceCursorRowId,
    );
    const edgeSource = yield* decodeNullableRowIdResult(
      row.edgeCursorSourceRowId,
    );
    const edgeTarget = yield* decodeNullableRowIdResult(
      row.edgeCursorTargetRowId,
    );
    const versionEndpoint = yield* decodeNullableRowIdResult(
      row.versionCursorEndpointRowId,
    );
    const edgeCursor = edgeSource === null || edgeTarget === null
      ? null
      : Object.freeze({ sourceRowId: edgeSource, targetRowId: edgeTarget });
    const versionCursor =
      row.versionCursorDirection === null || versionEndpoint === null
        ? null
        : Object.freeze({
          direction: row.versionCursorDirection,
          endpointRowId: versionEndpoint,
        });
    if (
      (edgeSource === null) !== (edgeTarget === null) ||
      (row.versionCursorDirection === null) !==
        (versionEndpoint === null) ||
      (row.versionCursorDirection !== null &&
        row.versionCursorDirection !== "incoming" &&
        row.versionCursorDirection !== "outgoing") ||
      (row.lifecycle === "ready"
        ? !isUint8ArrayWithByteLength(row.readinessSha256, 32)
        : row.readinessSha256 !== null) ||
      !semanticStateProgressMatchesLifecycle({
        lifecycle: row.lifecycle,
        sourceCursorRowId,
        edgeCursor,
        versionCursor,
        validatedSourceCount: row.validatedSourceCount,
        validatedEdgeCount: row.validatedEdgeCount,
        validatedVersionCount: row.validatedVersionCount,
      })
    ) {
      return yield* readinessCorruptionResult("storedValidation");
    }
    return Object.freeze({
      scopeId: row.scopeId,
      deploymentId: row.deploymentId,
      applicationSchemaSha256: copyBytes(row.applicationSchemaSha256),
      schemaVersionId: row.schemaVersionId,
      schemaVersion: row.schemaVersion,
      schemaManifestSha256: copyBytes(row.schemaManifestSha256),
      boundPublicationSha256: copyBytes(row.boundPublicationSha256),
      relationOrdinal: row.relationOrdinal,
      relationId: row.relationId,
      sourceTableId: row.sourceTableId,
      targetTableId: row.targetTableId,
      semanticDefinitionSha256: copyBytes(row.semanticDefinitionSha256),
      edgeDefinitionId: row.edgeDefinitionId,
      physicalDefinitionSha256: copyBytes(row.physicalDefinitionSha256),
      originSchemaVersionId: row.originSchemaVersionId,
      originRelationOrdinal: row.originRelationOrdinal,
      originReadinessKind: row.originReadinessKind,
      originSemanticAttemptFence: row.originSemanticAttemptFence === null
        ? null
        : ApplicationRelationSemanticValidationAttemptFenceSchema.make(
          row.originSemanticAttemptFence,
        ),
      originSemanticReadinessSha256:
        row.originSemanticReadinessSha256 === null
          ? null
          : copyBytes(row.originSemanticReadinessSha256),
      physicalOriginSchemaVersionId: row.physicalOriginSchemaVersionId,
      physicalOriginRelationOrdinal: row.physicalOriginRelationOrdinal,
      physicalAttemptFence: row.physicalAttemptFence,
      physicalReadinessSha256: copyBytes(row.physicalReadinessSha256),
      physicalFrontierCommitSeq: row.physicalFrontierCommitSeq,
      storageGeneration: row.storageGeneration,
      storageGenerationFence: row.storageGenerationFence,
      epoch: row.epoch,
      frontierCommitSeq: row.frontierCommitSeq,
      attemptFence: ApplicationRelationSemanticValidationAttemptFenceSchema.make(
        row.attemptFence,
      ),
      lifecycle: row.lifecycle,
      sourceCursorRowId,
      edgeCursor,
      versionCursor,
      validatedSourceCount: row.validatedSourceCount,
      validatedEdgeCount: row.validatedEdgeCount,
      validatedVersionCount: row.validatedVersionCount,
      readinessSha256: row.readinessSha256 === null
        ? null
        : copyBytes(row.readinessSha256),
    });
  });
}

function decodeNullableRowIdResult(
  value: Uint8Array | null,
): Result.Result<
  ApplicationRelationSemanticValidationState["sourceCursorRowId"],
  ApplicationRelationReadinessCorruptionError
> {
  if (value === null) return Result.succeed(null);
  if (!isUint8ArrayWithByteLength(value, 16)) {
    return readinessCorruptionResult("storedValidation");
  }
  return appRowIdHexV1FromBytesResult(copyBytes(value)).pipe(
    Result.mapError(cause => new ApplicationRelationReadinessCorruptionError({
      reason: "storedValidation",
      cause,
    })),
  );
}

function semanticStateProgressMatchesLifecycle(progress: Readonly<{
  readonly lifecycle: ApplicationRelationSemanticValidationLifecycle;
  readonly sourceCursorRowId:
    ApplicationRelationSemanticValidationState["sourceCursorRowId"];
  readonly edgeCursor:
    ApplicationRelationSemanticValidationState["edgeCursor"];
  readonly versionCursor:
    ApplicationRelationSemanticValidationState["versionCursor"];
  readonly validatedSourceCount: bigint;
  readonly validatedEdgeCount: bigint;
  readonly validatedVersionCount: bigint;
}>): boolean {
  switch (progress.lifecycle) {
    case "validating_sources":
      return progress.edgeCursor === null &&
        progress.versionCursor === null &&
        progress.validatedEdgeCount === 0n &&
        progress.validatedVersionCount === 0n;
    case "validating_edges":
      return progress.sourceCursorRowId === null &&
        progress.versionCursor === null &&
        progress.validatedVersionCount === 0n;
    case "validating_versions":
      return progress.sourceCursorRowId === null &&
        progress.edgeCursor === null;
    case "ready":
      return progress.sourceCursorRowId === null &&
        progress.edgeCursor === null &&
        progress.versionCursor === null;
  }
}

const settleSemanticReadinessEffect = Effect.fn(
  "ApplicationRelationReadiness.settleReadiness",
)(function* (
  tx: AppRowTransaction,
  existing: ApplicationRelationSemanticValidationState,
  page: ApplicationRelationSemanticValidationPageResult,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  Readonly<{
    readonly state: ApplicationRelationSemanticValidationState;
    readonly status: "ready" | "replayed";
  }>,
  ReadinessTransactionFailure
> {
  if (page.lifecycle !== "ready") {
    return yield* relationReadinessCorruption("storedValidation");
  }
  const timestampRows = yield* queryEffect(
    "readTimestamp",
    tx.select({ settledAt: sql<Date>`clock_timestamp()` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, existing.scopeId))
      .limit(1),
  );
  const settledAt = databaseTimestampFromUnknown(
    timestampRows[0]?.settledAt,
  );
  if (settledAt === null) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const readyState = stateWithSemanticPage(existing, page);
  const canonical = yield* canonicalSemanticReadinessEffect(
    readyState,
    settledAt,
  );
  const inserted = yield* queryEffect(
    "insertReceipt",
    tx.insert(fxSystemApplicationRelationSemanticReadiness).values({
      scopeId: readyState.scopeId,
      deploymentId: readyState.deploymentId,
      applicationSchemaSha256: copyBytes(
        readyState.applicationSchemaSha256,
      ),
      schemaVersionId: readyState.schemaVersionId,
      schemaVersion: readyState.schemaVersion,
      schemaManifestSha256: copyBytes(readyState.schemaManifestSha256),
      boundPublicationSha256: copyBytes(
        readyState.boundPublicationSha256,
      ),
      relationOrdinal: readyState.relationOrdinal,
      relationId: readyState.relationId,
      sourceTableId: readyState.sourceTableId,
      targetTableId: readyState.targetTableId,
      semanticDefinitionSha256: copyBytes(
        readyState.semanticDefinitionSha256,
      ),
      edgeDefinitionId: readyState.edgeDefinitionId,
      physicalDefinitionSha256: copyBytes(
        readyState.physicalDefinitionSha256,
      ),
      originSchemaVersionId: readyState.originSchemaVersionId,
      originRelationOrdinal: readyState.originRelationOrdinal,
      originReadinessKind: readyState.originReadinessKind,
      originSemanticAttemptFence:
        readyState.originSemanticAttemptFence,
      originSemanticReadinessSha256:
        readyState.originSemanticReadinessSha256 === null
          ? null
          : copyBytes(readyState.originSemanticReadinessSha256),
      physicalOriginSchemaVersionId:
        readyState.physicalOriginSchemaVersionId,
      physicalOriginRelationOrdinal:
        readyState.physicalOriginRelationOrdinal,
      physicalAttemptFence: readyState.physicalAttemptFence,
      physicalReadinessSha256: copyBytes(
        readyState.physicalReadinessSha256,
      ),
      physicalFrontierCommitSeq: readyState.physicalFrontierCommitSeq,
      storageGeneration: readyState.storageGeneration,
      storageGenerationFence: readyState.storageGenerationFence,
      epoch: readyState.epoch,
      frontierCommitSeq: readyState.frontierCommitSeq,
      attemptFence: readyState.attemptFence,
      receiptCodecVersion:
        APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_CODEC_VERSION,
      receiptBytes: copyBytes(canonical.canonicalBytes),
      readinessSha256: copyBytes(canonical.sha256),
      sourceCount: readyState.validatedSourceCount,
      edgeCount: readyState.validatedEdgeCount,
      versionCount: readyState.validatedVersionCount,
      settledAt,
    }).onConflictDoNothing().returning({
      readinessSha256:
        fxSystemApplicationRelationSemanticReadiness.readinessSha256,
    }),
  );
  let status: "ready" | "replayed" = "ready";
  let readinessSha256 = canonical.sha256;
  if (inserted[0] === undefined) {
    const replay = yield* readSemanticReadinessRowEffect(tx, readyState);
    if (replay === null) {
      return yield* relationReadinessCorruption("semanticReceipt");
    }
    const evidence = yield* verifySemanticReadinessRowEffect(
      readyState,
      replay,
    );
    readinessSha256 = evidence.sha256;
    status = "replayed";
  }
  yield* runFault(options, "afterReceiptInsert");
  const state = yield* updateSemanticValidationEffect(
    tx,
    existing,
    page,
    readinessSha256,
  );
  yield* runFault(options, "afterLifecycleTransition");
  return Object.freeze({ state, status });
});

function stateWithSemanticPage(
  existing: ApplicationRelationSemanticValidationState,
  page: ApplicationRelationSemanticValidationPageResult,
): ApplicationRelationSemanticValidationState {
  return Object.freeze({
    ...existing,
    lifecycle: page.lifecycle,
    sourceCursorRowId: page.sourceCursorRowId,
    edgeCursor: page.edgeCursor,
    versionCursor: page.versionCursor,
    validatedSourceCount: page.validatedSourceCount,
    validatedEdgeCount: page.validatedEdgeCount,
    validatedVersionCount: page.validatedVersionCount,
    readinessSha256: null,
  });
}

const readAndVerifySemanticReadinessEffect = Effect.fn(
  "ApplicationRelationReadiness.readReadiness",
)(function* (
  tx: AppRowTransaction,
  state: ApplicationRelationSemanticValidationState,
): Effect.fn.Return<
  ApplicationRelationSemanticReadinessEvidence,
  ApplicationRelationReadinessPersistenceError |
    ApplicationRelationReadinessCorruptionError
> {
  if (state.lifecycle !== "ready" || state.readinessSha256 === null) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const row = yield* readSemanticReadinessRowEffect(tx, state);
  if (row === null) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const evidence = yield* verifySemanticReadinessRowEffect(state, row);
  if (!bytesEqual(state.readinessSha256, evidence.sha256)) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  return evidence;
});

const readSemanticReadinessRowEffect = Effect.fn(
  "ApplicationRelationReadiness.readReceipt",
)(function* (
  tx: AppRowTransaction,
  state: ApplicationRelationSemanticValidationState,
): Effect.fn.Return<
  SemanticReadinessRow | null,
  ApplicationRelationReadinessPersistenceError
> {
  const rows = yield* queryEffect(
    "readReceipt",
    tx.select().from(
      fxSystemApplicationRelationSemanticReadiness,
    ).where(and(
      eq(
        fxSystemApplicationRelationSemanticReadiness.scopeId,
        state.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticReadiness.schemaVersionId,
        state.schemaVersionId,
      ),
      eq(
        fxSystemApplicationRelationSemanticReadiness.relationOrdinal,
        state.relationOrdinal,
      ),
      eq(
        fxSystemApplicationRelationSemanticReadiness.attemptFence,
        state.attemptFence,
      ),
    )).limit(1),
  );
  return rows[0] ?? null;
});

const verifySemanticReadinessRowEffect = Effect.fn(
  "ApplicationRelationReadiness.verifyReceipt",
)(function* (
  state: ApplicationRelationSemanticValidationState,
  row: SemanticReadinessRow,
): Effect.fn.Return<
  ApplicationRelationSemanticReadinessEvidence,
  ApplicationRelationReadinessPersistenceError |
    ApplicationRelationReadinessCorruptionError
> {
  const settledAt = copyFiniteDate(row.settledAt);
  if (
    settledAt === undefined ||
    !semanticReadinessRowHasExpectedBytes(row) ||
    !semanticReadinessRowMatchesState(row, state) ||
    row.receiptCodecVersion !==
      APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_CODEC_VERSION ||
    row.receiptBytes.byteLength < 1 ||
    row.receiptBytes.byteLength >
      APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_MAXIMUM_BYTES
  ) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const canonical = yield* canonicalSemanticReadinessEffect(state, settledAt);
  if (
    !bytesEqual(row.receiptBytes, canonical.canonicalBytes) ||
    !bytesEqual(row.readinessSha256, canonical.sha256)
  ) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  return yield* Effect.fromResult(semanticEvidenceResult(
    canonical.receipt,
    canonical.canonicalBytes,
    canonical.sha256,
    settledAt,
  ));
});

function semanticReadinessRowHasExpectedBytes(
  row: SemanticReadinessRow,
): boolean {
  return isUint8ArrayWithByteLength(row.applicationSchemaSha256, 32) &&
    isUint8ArrayWithByteLength(row.schemaManifestSha256, 32) &&
    isUint8ArrayWithByteLength(row.boundPublicationSha256, 32) &&
    isUint8ArrayWithByteLength(row.semanticDefinitionSha256, 32) &&
    isUint8ArrayWithByteLength(row.physicalDefinitionSha256, 32) &&
    (row.originSemanticReadinessSha256 === null ||
      isUint8ArrayWithByteLength(row.originSemanticReadinessSha256, 32)) &&
    isUint8ArrayWithByteLength(row.physicalReadinessSha256, 32) &&
    isUint8Array(row.receiptBytes) &&
    isUint8ArrayWithByteLength(row.readinessSha256, 32);
}

function semanticReadinessRowMatchesState(
  row: SemanticReadinessRow,
  state: ApplicationRelationSemanticValidationState,
): boolean {
  return row.scopeId === state.scopeId &&
    row.deploymentId === state.deploymentId &&
    bytesEqual(row.applicationSchemaSha256, state.applicationSchemaSha256) &&
    row.schemaVersionId === state.schemaVersionId &&
    row.schemaVersion === state.schemaVersion &&
    bytesEqual(row.schemaManifestSha256, state.schemaManifestSha256) &&
    bytesEqual(row.boundPublicationSha256, state.boundPublicationSha256) &&
    row.relationOrdinal === state.relationOrdinal &&
    row.relationId === state.relationId &&
    row.sourceTableId === state.sourceTableId &&
    row.targetTableId === state.targetTableId &&
    bytesEqual(
      row.semanticDefinitionSha256,
      state.semanticDefinitionSha256,
    ) &&
    row.edgeDefinitionId === state.edgeDefinitionId &&
    bytesEqual(
      row.physicalDefinitionSha256,
      state.physicalDefinitionSha256,
    ) &&
    row.originSchemaVersionId === state.originSchemaVersionId &&
    row.originRelationOrdinal === state.originRelationOrdinal &&
    row.originReadinessKind === state.originReadinessKind &&
    nullableBigintEqual(
      row.originSemanticAttemptFence,
      state.originSemanticAttemptFence,
    ) &&
    nullableBytesEqual(
      row.originSemanticReadinessSha256,
      state.originSemanticReadinessSha256,
    ) &&
    row.physicalOriginSchemaVersionId ===
      state.physicalOriginSchemaVersionId &&
    row.physicalOriginRelationOrdinal ===
      state.physicalOriginRelationOrdinal &&
    row.physicalAttemptFence === state.physicalAttemptFence &&
    bytesEqual(
      row.physicalReadinessSha256,
      state.physicalReadinessSha256,
    ) &&
    row.physicalFrontierCommitSeq === state.physicalFrontierCommitSeq &&
    row.storageGeneration === state.storageGeneration &&
    row.storageGenerationFence === state.storageGenerationFence &&
    row.epoch === state.epoch &&
    row.frontierCommitSeq === state.frontierCommitSeq &&
    row.attemptFence === state.attemptFence &&
    row.sourceCount === state.validatedSourceCount &&
    row.edgeCount === state.validatedEdgeCount &&
    row.versionCount === state.validatedVersionCount;
}

interface CanonicalSemanticReadiness {
  readonly receipt: ApplicationRelationSemanticReadinessReceipt;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

const canonicalSemanticReadinessEffect = Effect.fn(
  "ApplicationRelationReadiness.canonicalReadiness",
)(function* (
  state: ApplicationRelationSemanticValidationState,
  settledAt: Date,
): Effect.fn.Return<
  CanonicalSemanticReadiness,
  ApplicationRelationReadinessPersistenceError |
    ApplicationRelationReadinessCorruptionError
> {
  const ownedSettledAt = copyFiniteDate(settledAt);
  if (
    ownedSettledAt === undefined ||
    state.lifecycle !== "ready"
  ) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const common = {
    format: "flarex.application-relation-semantic-readiness",
    version: APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_CODEC_VERSION,
    scopeId: state.scopeId,
    deploymentId: state.deploymentId,
    applicationSchemaSha256: encodeBytesToLowercaseHex(
      state.applicationSchemaSha256,
    ),
    schemaVersionId: state.schemaVersionId,
    schemaVersion: state.schemaVersion,
    schemaManifestSha256: encodeBytesToLowercaseHex(
      state.schemaManifestSha256,
    ),
    boundPublicationSha256: encodeBytesToLowercaseHex(
      state.boundPublicationSha256,
    ),
    relationOrdinal: state.relationOrdinal,
    relationId: state.relationId,
    sourceTableId: state.sourceTableId,
    targetTableId: state.targetTableId,
    semanticDefinitionSha256: encodeBytesToLowercaseHex(
      state.semanticDefinitionSha256,
    ),
    edgeDefinitionId: state.edgeDefinitionId,
    physicalDefinitionSha256: encodeBytesToLowercaseHex(
      state.physicalDefinitionSha256,
    ),
    originSchemaVersionId: state.originSchemaVersionId,
    originRelationOrdinal: state.originRelationOrdinal,
    originReadinessKind: state.originReadinessKind,
    physicalOriginSchemaVersionId: state.physicalOriginSchemaVersionId,
    physicalOriginRelationOrdinal: state.physicalOriginRelationOrdinal,
    physicalAttemptFence: state.physicalAttemptFence.toString(),
    physicalReadinessSha256: encodeBytesToLowercaseHex(
      state.physicalReadinessSha256,
    ),
    physicalFrontierCommitSeq: state.physicalFrontierCommitSeq.toString(),
    storageGeneration: state.storageGeneration,
    storageGenerationFence: state.storageGenerationFence.toString(),
    epoch: state.epoch,
    frontierCommitSeq: state.frontierCommitSeq.toString(),
    attemptFence: state.attemptFence.toString(),
    sourceCount: state.validatedSourceCount.toString(),
    edgeCount: state.validatedEdgeCount.toString(),
    versionCount: state.validatedVersionCount.toString(),
    settledAt: ownedSettledAt.toISOString(),
  } as const;
  let receiptJson: JsonObject & ApplicationRelationSemanticReadinessReceipt;
  if (state.originReadinessKind === "semantic") {
    const originSemanticAttemptFence = state.originSemanticAttemptFence;
    const originSemanticReadinessSha256 =
      state.originSemanticReadinessSha256;
    if (
      originSemanticAttemptFence === null ||
      originSemanticReadinessSha256 === null
    ) {
      return yield* relationReadinessCorruption("semanticReceipt");
    }
    receiptJson = {
      ...common,
      originSemanticAttemptFence: originSemanticAttemptFence.toString(),
      originSemanticReadinessSha256: encodeBytesToLowercaseHex(
        originSemanticReadinessSha256,
      ),
    };
  } else {
    if (
      state.originSemanticAttemptFence !== null ||
      state.originSemanticReadinessSha256 !== null
    ) {
      return yield* relationReadinessCorruption("semanticReceipt");
    }
    receiptJson = common;
  }
  const receipt: ApplicationRelationSemanticReadinessReceipt = Object.freeze(
    receiptJson,
  );
  const canonicalText = encodeCanonicalJson(
    receiptJson satisfies JsonObject,
    issue => {
      throw new Error(
        `Typed semantic relation readiness lost JSON: ${issue.reason}.`,
      );
    },
  );
  const canonicalBytes = TEXT_ENCODER.encode(canonicalText);
  if (
    canonicalBytes.byteLength < 1 ||
    canonicalBytes.byteLength >
      APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_MAXIMUM_BYTES
  ) {
    return yield* relationReadinessCorruption("semanticReceipt");
  }
  const sha256 = yield* digestReceiptEffect(canonicalBytes);
  return Object.freeze({
    receipt,
    canonicalBytes: copyBytes(canonicalBytes),
    sha256,
  });
});

function semanticEvidenceResult(
  receipt: ApplicationRelationSemanticReadinessReceipt,
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
  settledAt: Date,
): Result.Result<
  ApplicationRelationSemanticReadinessEvidence,
  ApplicationRelationReadinessCorruptionError
> {
  const stableBytes = copyBytes(canonicalBytes);
  const stableSha256 = copyBytes(sha256);
  const stableSettledAt = copyFiniteDate(settledAt);
  if (
    stableSettledAt === undefined ||
    !isUint8ArrayWithByteLength(stableSha256, 32)
  ) {
    return readinessCorruptionResult("semanticReceipt");
  }
  return Result.succeed(Object.freeze({
    receipt,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
    get sha256(): Uint8Array {
      return copyBytes(stableSha256);
    },
    get settledAt(): Date {
      return new Date(stableSettledAt.getTime());
    },
  }));
}

function digestReceiptEffect(
  bytes: Uint8Array,
): Effect.Effect<
  Uint8Array,
  ApplicationRelationReadinessPersistenceError
> {
  return Effect.tryPromise({
    try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: cause => new ApplicationRelationReadinessPersistenceError({
      operation: "digestReceipt",
      retryable: false,
      cause,
    }),
  });
}

const prepareApplicationRelationReadinessEffect = Effect.fn(
  "ApplicationRelationReadiness.prepare",
)(function* (
  port: ApplicationRelationReadinessPort,
  input: unknown,
): Effect.fn.Return<
  PreparedApplicationRelationReadiness,
  PrepareApplicationRelationReadinessError
> {
  const state = applicationRelationReadinessPortStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessUnavailableError({
        reason: "compositionMissing",
      }),
    );
  }
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const locatedManifest = yield* locateApplicationRelationManifestBindingEffect(
    state.controlDb,
    decoded,
  );
  if (locatedManifest === null) {
    return yield* Effect.fail(
      new ApplicationRelationReadinessUnavailableError({
        reason: "manifestBindingUnavailable",
      }),
    );
  }
  const definitions = yield* state.relationCommit.locate({
    deploymentId: decoded.deploymentId,
    schemaVersionId:
      locatedManifest.manifestBinding.binding.schemaVersionId,
  });
  if (definitions === null) {
    return yield* relationReadinessCorruption("bindingMismatch");
  }
  yield* Effect.fromResult(requireRootAgreementResult(
    decoded,
    locatedManifest,
    definitions,
  ));
  const immediateOrigins = new Map<number, Readonly<{
    readonly definitions: LocatedApplicationRelationDefinitionSet;
    readonly definition: LocatedApplicationRelationDefinition;
  }>>();
  const originSets = new Map<string, LocatedApplicationRelationDefinitionSet>();
  const relations: PreparedApplicationRelation[] = [];
  for (let index = 0; index < definitions.definitions.length; index += 1) {
    const definition = definitions.definitions[index];
    if (
      definition === undefined ||
      definition.binding.relationOrdinal !== index + 1
    ) {
      return yield* relationReadinessCorruption("definitionSet");
    }
    const physical = yield* canonicalizePhysicalEdgeDefinition(
      definition.edge.physical,
    ).pipe(Effect.mapError(cause =>
      new ApplicationRelationReadinessCorruptionError({
        reason: "definitionSet",
        cause,
      })
    ));
    let immediateOrigin: PreparedApplicationRelationImmediateOrigin | null =
      null;
    const evolution = definition.binding.evolution;
    if (
      evolution.kind === "preserve" &&
      evolution.physical === "reuse"
    ) {
      const originSchemaVersionId = evolution.fromSchemaVersionId;
      let originSet = originSets.get(originSchemaVersionId);
      if (originSet === undefined) {
        const locatedOrigin = yield* state.relationCommit.locate({
          deploymentId: decoded.deploymentId,
          schemaVersionId: originSchemaVersionId,
        });
        if (locatedOrigin === null) {
          return yield* relationReadinessCorruption("lineage");
        }
        originSet = locatedOrigin;
        originSets.set(originSchemaVersionId, originSet);
      }
      const originMatches = originSet.definitions.filter((candidate) =>
        candidate.binding.relationOrdinal ===
          evolution.fromRelationOrdinal
      );
      const origin = originMatches[0];
      if (origin === undefined || originMatches.length !== 1) {
        return yield* relationReadinessCorruption("lineage");
      }
      const originPhysical = yield* canonicalizePhysicalEdgeDefinition(
        origin.edge.physical,
      ).pipe(Effect.mapError(cause =>
        new ApplicationRelationReadinessCorruptionError({
          reason: "lineage",
          cause,
        })
      ));
      if (
        origin.binding.relationId !== definition.binding.relationId ||
        origin.binding.sourceTableId !== definition.binding.sourceTableId ||
        origin.binding.targetTableId !== definition.binding.targetTableId ||
        origin.edge.edgeDefinitionId !== definition.edge.edgeDefinitionId ||
        originPhysical.sha256Hex !== physical.sha256Hex
      ) {
        return yield* relationReadinessCorruption("lineage");
      }
      immediateOrigins.set(definition.binding.relationOrdinal, Object.freeze({
        definitions: originSet,
        definition: origin,
      }));
      immediateOrigin = Object.freeze({
        schemaVersionId: originSet.schemaVersionId,
        relationOrdinal: origin.binding.relationOrdinal,
        semanticDefinitionSha256:
          origin.binding.semanticDefinitionSha256,
        edgeDefinitionId: origin.edge.edgeDefinitionId,
        physicalDefinitionSha256: originPhysical.sha256Hex,
        evolution: snapshotEvolution(origin.binding.evolution),
      });
    }
    relations.push(Object.freeze({
      binding: definition.binding,
      semantic: definition.semantic,
      edge: definition.edge,
      physicalDefinitionSha256: physical.sha256Hex,
      immediateOrigin,
    }));
  }
  const physicalDefinitions = yield* Effect.fromResult(
    deduplicatePhysicalDefinitionsResult(relations),
  );
  const prepared = Object.freeze({
    deploymentId: definitions.deploymentId,
    applicationManifestSha256:
      locatedManifest.manifestBinding.binding.applicationManifestSha256,
    manifestSchemaBindingSha256: locatedManifest.manifestBinding.sha256Hex,
    applicationSchemaSha256: definitions.applicationSchemaSha256,
    schemaVersionId: definitions.schemaVersionId,
    schemaVersion: locatedManifest.manifestBinding.binding.schemaVersion,
    schemaManifestSha256: definitions.schemaManifestSha256,
    boundPublicationSha256: definitions.boundPublicationSha256,
    relations: Object.freeze(relations),
    physicalDefinitions,
  } satisfies PreparedApplicationRelationReadiness);
  preparedApplicationRelationReadinessStates.set(prepared, Object.freeze({
    port: state,
    definitions,
    immediateOrigins,
  }));
  return prepared;
});

interface DecodedInput {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly applicationManifestSha256:
    ApplicationRelationReadinessInput["applicationManifestSha256"];
}

function decodeInputResult(
  input: unknown,
): Result.Result<DecodedInput, InvalidApplicationRelationReadinessInputError> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(
        new InvalidApplicationRelationReadinessInputError({
          reason: "invalidInputShape",
        }),
      );
    }
    const deploymentId = yield* decodeDeploymentIdResult(
      input.deploymentId,
    ).pipe(Result.mapError(() =>
      new InvalidApplicationRelationReadinessInputError({
        reason: "invalidDeploymentId",
      })
    ));
    const applicationManifestSha256 = yield* decodeManifestSha256Result(
      input.applicationManifestSha256,
    ).pipe(Result.mapError(() =>
      new InvalidApplicationRelationReadinessInputError({
        reason: "invalidApplicationManifestSha256",
      })
    ));
    return Object.freeze({ deploymentId, applicationManifestSha256 });
  });
}

function requireRootAgreementResult(
  input: DecodedInput,
  located: LocatedApplicationRelationManifestBinding,
  definitions: LocatedApplicationRelationDefinitionSet,
): Result.Result<void, ApplicationRelationReadinessCorruptionError> {
  const manifest = located.manifestBinding.binding;
  const root = located.relationBinding;
  return manifest.deploymentId === input.deploymentId &&
      manifest.applicationManifestSha256 === input.applicationManifestSha256 &&
      root.deploymentId === input.deploymentId &&
      root.schemaVersionId === manifest.schemaVersionId &&
      root.binding.schemaVersion === manifest.schemaVersion &&
      definitions.deploymentId === root.deploymentId &&
      definitions.schemaVersionId === root.schemaVersionId &&
      definitions.applicationSchemaSha256 ===
        manifest.applicationSchemaSha256 &&
      definitions.applicationSchemaSha256 ===
        encodeBytesToLowercaseHex(root.applicationSchemaSha256) &&
      definitions.schemaManifestSha256 ===
        encodeBytesToLowercaseHex(root.schemaManifestSha256) &&
      definitions.boundPublicationSha256 ===
        manifest.boundPublicationSha256 &&
      definitions.boundPublicationSha256 ===
        encodeBytesToLowercaseHex(root.boundPublicationSha256) &&
      definitions.definitions.length === root.binding.relationBindings.length
    ? Result.succeed(undefined)
    : Result.fail(new ApplicationRelationReadinessCorruptionError({
      reason: "bindingMismatch",
    }));
}

function deduplicatePhysicalDefinitionsResult(
  relations: ReadonlyArray<PreparedApplicationRelation>,
): Result.Result<
  ReadonlyArray<PreparedApplicationRelationPhysicalDefinition>,
  ApplicationRelationReadinessCorruptionError
> {
  const byEdgeDefinitionId = new Map<
    number,
    PreparedApplicationRelationPhysicalDefinition
  >();
  for (const relation of relations) {
    const existing = byEdgeDefinitionId.get(relation.edge.edgeDefinitionId);
    if (existing === undefined) {
      byEdgeDefinitionId.set(relation.edge.edgeDefinitionId, Object.freeze({
        edgeDefinitionId: relation.edge.edgeDefinitionId,
        relationId: relation.binding.relationId,
        physical: relation.edge.physical,
        physicalDefinitionSha256: relation.physicalDefinitionSha256,
      }));
      continue;
    }
    if (
      existing.relationId !== relation.binding.relationId ||
      existing.physicalDefinitionSha256 !== relation.physicalDefinitionSha256
    ) {
      return Result.fail(new ApplicationRelationReadinessCorruptionError({
        reason: "definitionSet",
      }));
    }
  }
  return Result.succeed(Object.freeze(Array.from(
    byEdgeDefinitionId.values(),
  ).toSorted((left, right) => left.edgeDefinitionId - right.edgeDefinitionId)));
}

function snapshotEvolution(
  evolution: ApplicationRelationSchemaEvolution,
): ApplicationRelationSchemaEvolution {
  return evolution.kind === "new"
    ? Object.freeze({ kind: "new" })
    : Object.freeze({
      kind: "preserve",
      fromSchemaVersionId: evolution.fromSchemaVersionId,
      fromRelationOrdinal: evolution.fromRelationOrdinal,
      physical: evolution.physical,
      compatibility: Object.freeze({
        declarationCodec: evolution.compatibility.declarationCodec,
        changes: Object.freeze([...evolution.compatibility.changes]),
      }),
    });
}

type ApplicationRelationSchemaEvolution =
  PreparedApplicationRelation["binding"]["evolution"];

function requireCurrentAuthorityEffect(
  expected: TrustedScopeAuthority,
  current: ScopeClockRecord,
): Effect.Effect<void, ApplicationRelationReadinessStaleAuthorityError> {
  for (const reason of [
    "storageGeneration",
    "storageGenerationFence",
    "epoch",
  ] as const) {
    if (expected[reason] !== current[reason]) {
      return Effect.fail(new ApplicationRelationReadinessStaleAuthorityError({
        scopeId: expected.scopeId,
        reason,
      }));
    }
  }
  if (current.storageGeneration !== "flarexdb_v1") {
    return Effect.fail(new ApplicationRelationReadinessStaleAuthorityError({
      scopeId: expected.scopeId,
      reason: "storageGeneration",
    }));
  }
  return Effect.void;
}

function parsePositiveBigintResult(
  value: string,
  reason: ApplicationRelationReadinessCorruptionError["reason"],
): Result.Result<bigint, ApplicationRelationReadinessCorruptionError> {
  return parseCanonicalBigintResult(value, reason).pipe(
    Result.flatMap(parsed => parsed >= 1n
      ? Result.succeed(parsed)
      : readinessCorruptionResult(reason)),
  );
}

function parseNonNegativeBigintResult(
  value: string,
  reason: ApplicationRelationReadinessCorruptionError["reason"],
): Result.Result<bigint, ApplicationRelationReadinessCorruptionError> {
  return parseCanonicalBigintResult(value, reason);
}

function parseCanonicalBigintResult(
  value: string,
  reason: ApplicationRelationReadinessCorruptionError["reason"],
): Result.Result<bigint, ApplicationRelationReadinessCorruptionError> {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return readinessCorruptionResult(reason);
  }
  const parsed = BigInt(value);
  return parsed <= MAX_PERSISTED_SIGNED_INT64_V1
    ? Result.succeed(parsed)
    : readinessCorruptionResult(reason);
}

function decodeSha256HexResult(
  value: string,
  reason: ApplicationRelationReadinessCorruptionError["reason"],
): Result.Result<Uint8Array, ApplicationRelationReadinessCorruptionError> {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return readinessCorruptionResult(reason);
  }
  return Encoding.decodeHex(value).pipe(
    Result.mapError(cause => new ApplicationRelationReadinessCorruptionError({
      reason,
      cause,
    })),
  );
}

function nullableBytesEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null || right === null
    ? left === right
    : bytesEqual(left, right);
}

function nullableBigintEqual(
  left: bigint | null,
  right: bigint | null,
): boolean {
  return left === right;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function isSemanticOriginKind(
  value: string,
): value is ApplicationRelationSemanticReadinessOriginKind {
  return value === "physical" || value === "semantic";
}

function isSemanticLifecycle(
  value: string,
): value is ApplicationRelationSemanticValidationLifecycle {
  return value === "validating_sources" ||
    value === "validating_edges" ||
    value === "validating_versions" ||
    value === "ready";
}

function readinessCorruptionResult(
  reason: ApplicationRelationReadinessCorruptionError["reason"],
  cause?: unknown,
): Result.Result<never, ApplicationRelationReadinessCorruptionError> {
  return Result.fail(new ApplicationRelationReadinessCorruptionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  }));
}

function queryEffect<Value>(
  operation: ApplicationRelationReadinessPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, ApplicationRelationReadinessPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: cause => new ApplicationRelationReadinessPersistenceError({
      operation,
      retryable: isRetryableSqlCause(cause),
      cause,
    }),
  }));
}

function runFault(
  options: ApplicationRelationBuildOptions,
  point: Parameters<NonNullable<
    ApplicationRelationBuildOptions["faultAfter"]
  >>[0],
): Effect.Effect<void, ApplicationRelationReadinessPersistenceError> {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.tryPromise({
      try: async () => options.faultAfter?.(point),
      catch: cause => new ApplicationRelationReadinessPersistenceError({
        operation: "targetTransaction",
        retryable: false,
        cause,
      }),
    });
}

function isRetryableTransactionFailure(
  failure: LocatedReadCommittedTransactionFailureV1,
): boolean {
  switch (failure.issue.kind) {
    case "infrastructureFailure":
      return isRetryableSqlCause(failure.issue.cause);
    case "callbackRolledBack":
      return isRetryableSqlCause(failure.issue.callbackCause);
    case "callbackCleanupFailed":
    case "decisionUncertain":
      return false;
  }
}

function isRetryableSqlCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  try {
    const code = Reflect.get(cause, "code");
    return code === "40001" || code === "40P01" || code === "55P03";
  } catch {
    return false;
  }
}

function relationReadinessCorruption(
  reason: ApplicationRelationReadinessCorruptionError["reason"],
): Effect.Effect<never, ApplicationRelationReadinessCorruptionError> {
  return Effect.fail(new ApplicationRelationReadinessCorruptionError({
    reason,
  }));
}
