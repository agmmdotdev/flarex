import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result } from "effect";
import {
  decodeApplicationActionInvocationRequestV1,
  decodeApplicationActionInvocationRequestV2,
  decodeExecutionEvidenceBodyReferenceV1,
  encodeExternalEffectExecutionSubjectV1,
  type ApplicationActionInvocationRequestFrameV1,
  type ApplicationActionInvocationRequestFrameV2,
  type CanonicalExecutionEvidenceFrameV1,
  type ExecutionEvidenceBodyReferenceV1,
  type ExternalEffectExecutionSubjectFrameV1,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  canonicalizeApplicationActionExecutionAuthorityV1,
  type CanonicalApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { getScopeClock } from "./scopeClock";
import {
  fxSystemApplicationActionInvocationsV1,
  fxSystemExternalEffectAttemptsV1,
  fxSystemScopeClocks,
} from "./schema";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import { scopePhysicalLocatorsEqual } from "./scopePhysicalLocator";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

const ACTION_TARGET_DB: unique symbol = Symbol(
  "FlarexDB/applicationActionAuthorityTargetDbV1",
);
const MAX_TEXT_BYTES = 2_048;
const UTF8 = new TextEncoder();

export interface LocatedApplicationActionAuthorityTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {
  readonly [ACTION_TARGET_DB]: FlarexMetadataDatabase;
}

export function createLocatedApplicationActionAuthorityTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedApplicationActionAuthorityTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [ACTION_TARGET_DB]: db,
  });
}

export interface ApplicationActionAuthoritySha256V1<E> {
  readonly hash: (bytes: Uint8Array) => Effect.Effect<Uint8Array, E>;
}

export interface ApplicationActionAuthorityContextV1<HashError> {
  readonly target: LocatedApplicationActionAuthorityTargetV1;
  readonly authority: TrustedScopeAuthority;
  readonly sha256: ApplicationActionAuthoritySha256V1<HashError>;
  readonly proofAfterTransactionStep?: (
    step: ApplicationActionAuthorityTransactionStepV1,
  ) => void;
}

export type ApplicationActionAuthorityTransactionStepV1 =
  | "afterAdmissionInsert"
  | "afterClaimUpdate"
  | "afterEffectOrdinalUpdate"
  | "afterEffectInsert"
  | "afterEffectTransitionUpdate"
  | "afterEffectConfirmationUpdate"
  | "afterSettlementEffectUpdate"
  | "afterSettlementUpdate"
  | "afterCancellationUpdate"
  | "afterRecoveryPreparedEffectUpdate"
  | "afterRecoveryDispatchingEffectUpdate"
  | "afterRecoveryParentUpdate";

export interface AdmitApplicationActionInvocationV1Input {
  readonly request: CanonicalExecutionEvidenceFrameV1<
    ApplicationActionInvocationRequestFrameV1
  >;
  readonly invocationId: string;
}

export interface AdmitApplicationAuthorityActionInvocationInput {
  readonly request: CanonicalExecutionEvidenceFrameV1<
    ApplicationActionInvocationRequestFrameV2
  >;
  readonly executionAuthority: CanonicalApplicationActionExecutionAuthorityV1;
  readonly invocationId: string;
}

export type ApplicationActionInvocationLifecycleV1 =
  | "admitted"
  | "executing"
  | "completed"
  | "failed"
  | "uncertain"
  | "cancelled";

export interface ApplicationActionInvocationProjectionV1 {
  readonly scopeId: ScopeId;
  readonly requestKey: string;
  readonly invocationId: string;
  readonly requestIdentitySha256: Uint8Array;
  readonly applicationRevisionId: string;
  readonly candidateSha256: Uint8Array;
  readonly actionFunctionPath: string;
  readonly actionBindingSha256: Uint8Array;
  readonly executionIdentitySha256: Uint8Array;
  readonly compatibilityDate: string;
  readonly hostPolicySha256: Uint8Array;
  readonly arguments: ExecutionEvidenceBodyReferenceV1;
  readonly lifecycle: ApplicationActionInvocationLifecycleV1;
  readonly executionGeneration: bigint;
  readonly randomSeedSha256: Uint8Array | null;
  readonly invocationTime: Date | null;
  readonly executionDeadline: Date | null;
  readonly lastEffectOrdinal: bigint;
  readonly cancellationRequestedAt: Date | null;
  readonly result: ExecutionEvidenceBodyReferenceV1 | null;
  readonly terminalCode: string | null;
  readonly admittedAt: Date;
  readonly updatedAt: Date;
  readonly terminalAt: Date | null;
}

export interface ApplicationAuthorityActionInvocationProjection
  extends Omit<
    ApplicationActionInvocationProjectionV1,
    "applicationRevisionId" | "candidateSha256" | "actionBindingSha256"
  > {
  readonly executionAuthorityGeneration: "application_v1";
  readonly executionAuthority: CanonicalApplicationActionExecutionAuthorityV1;
}

export interface DirectActionExecutionSubjectCapabilityV1 {
  readonly _DirectActionExecutionSubjectCapabilityV1: unique symbol;
}

interface DirectActionSubjectStateV1 {
  readonly scopeId: ScopeId;
  readonly requestKey: string;
  readonly invocationId: string;
  readonly requestIdentitySha256: Uint8Array;
  readonly subjectIdentitySha256: Uint8Array;
  readonly executionGeneration: bigint;
}

export interface ClaimedApplicationActionExecutionV1 {
  readonly invocation: ApplicationActionInvocationProjectionV1;
  readonly subject: DirectActionExecutionSubjectCapabilityV1;
}

export interface ClaimedApplicationAuthorityActionExecution {
  readonly invocation: ApplicationAuthorityActionInvocationProjection;
  readonly subject: DirectActionExecutionSubjectCapabilityV1;
}

export type ExternalEffectAttemptStateV1 =
  | "prepared"
  | "failed_before_dispatch"
  | "dispatching"
  | "confirmed"
  | "uncertain";

export interface ExternalEffectAttemptProjectionV1 {
  readonly scopeId: ScopeId;
  readonly subjectKind: "direct_action" | "durable_task_attempt";
  readonly subjectIdentitySha256: Uint8Array;
  readonly subjectFence: bigint;
  readonly effectOrdinal: bigint;
  readonly effectKind: "outbound_http" | "child_mutation";
  readonly stableEffectKey: string;
  readonly requestIdentitySha256: Uint8Array;
  readonly state: ExternalEffectAttemptStateV1;
  readonly preparedAt: Date;
  readonly dispatchDeclaredAt: Date | null;
  readonly settledAt: Date | null;
  readonly terminalCode: string | null;
}

export type PrepareExternalEffectAttemptV1Input =
  | Readonly<{
      readonly effectKind: "outbound_http";
      readonly stableEffectKey: string;
      readonly requestIdentitySha256: Uint8Array;
      readonly request: ExecutionEvidenceBodyReferenceV1;
    }>
  | Readonly<{
      readonly effectKind: "child_mutation";
      readonly stableEffectKey: string;
      readonly requestIdentitySha256: Uint8Array;
      readonly childMutationRequestKey: string;
      readonly childMutationFunctionPath: string;
      readonly childMutationArgumentsSha256: Uint8Array;
    }>;

export type ConfirmExternalEffectAttemptV1Outcome =
  | Readonly<{
      readonly effectKind: "outbound_http";
      readonly response: ExecutionEvidenceBodyReferenceV1;
    }>
  | Readonly<{
      readonly effectKind: "child_mutation";
      readonly childMutationOutcomeSha256: Uint8Array;
    }>;

export type SettleApplicationActionInvocationV1Outcome =
  | Readonly<{
      readonly lifecycle: "completed";
      readonly result: ExecutionEvidenceBodyReferenceV1;
    }>
  | Readonly<{
      readonly lifecycle: "failed" | "uncertain" | "cancelled";
      readonly terminalCode: string;
    }>;

export class ApplicationActionAuthorityInputV1Error extends Data.TaggedError(
  "ApplicationActionAuthorityInputV1Error",
)<{ readonly operation: string; readonly field: string }> {}

export class ApplicationActionAuthorityStaleV1Error extends Data.TaggedError(
  "ApplicationActionAuthorityStaleV1Error",
)<{
  readonly reason:
    | "scope"
    | "epoch"
    | "storageGenerationFence"
    | "physicalLocator";
}> {}

export class ApplicationActionRequestKeyConflictV1Error extends Data.TaggedError(
  "ApplicationActionRequestKeyConflictV1Error",
)<{ readonly requestKey: string }> {}

export class ApplicationActionLifecycleConflictV1Error extends Data.TaggedError(
  "ApplicationActionLifecycleConflictV1Error",
)<{
  readonly operation: string;
  readonly expected: string;
  readonly actual: string;
}> {}

export class ApplicationActionAuthorityCorruptionV1Error extends Data.TaggedError(
  "ApplicationActionAuthorityCorruptionV1Error",
)<{ readonly detail: string }> {}

export class ApplicationActionAuthorityIntegrationV1Error
  extends Data.TaggedError("ApplicationActionAuthorityIntegrationV1Error")<{
    readonly operation: string;
    readonly cause: unknown;
  }> {}

export class InvalidDirectActionExecutionSubjectV1Error
  extends Data.TaggedError("InvalidDirectActionExecutionSubjectV1Error")<{
    readonly reason: "notIssued" | "revoked";
  }> {}

export class ApplicationActionInvocationMissingV1Error extends Data.TaggedError(
  "ApplicationActionInvocationMissingV1Error",
)<{ readonly requestKey: string }> {}

export type ApplicationActionAuthorityV1Error<HashError> =
  | ApplicationActionAuthorityInputV1Error
  | ApplicationActionAuthorityStaleV1Error
  | ApplicationActionRequestKeyConflictV1Error
  | ApplicationActionLifecycleConflictV1Error
  | ApplicationActionAuthorityCorruptionV1Error
  | ApplicationActionAuthorityIntegrationV1Error
  | InvalidDirectActionExecutionSubjectV1Error
  | ApplicationActionInvocationMissingV1Error
  | HashError;

const subjectStates = new WeakMap<
  DirectActionExecutionSubjectCapabilityV1,
  DirectActionSubjectStateV1
>();

export const admitDirectActionInvocationV1 = Effect.fn(
  "ApplicationActionAuthority.admitDirectActionInvocationV1",
)(function* <HashError>(
  input: AdmitApplicationActionInvocationV1Input,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  Readonly<{
    readonly disposition: "inserted" | "replayed";
    readonly invocation: ApplicationActionInvocationProjectionV1;
  }>,
  ApplicationActionAuthorityV1Error<HashError>
> {
  const invocationId = yield* requireUuid(input.invocationId, "admit", "invocationId");
  const requestCanonicalBytes = copyBytes(input.request.canonicalBytes);
  const decodedRequest = yield* Effect.fromResult(
    decodeApplicationActionInvocationRequestV1(
      requestCanonicalBytes,
    ),
  ).pipe(
    Effect.mapError(() => new ApplicationActionAuthorityInputV1Error({
      operation: "admit",
      field: "request.canonicalBytes",
    })),
  );
  const request = decodedRequest.frame;
  if (request.scopeId !== context.authority.scopeId) {
    return yield* new ApplicationActionAuthorityStaleV1Error({ reason: "scope" });
  }
  const requestIdentitySha256 = yield* context.sha256.hash(
    copyBytes(requestCanonicalBytes),
  );
  const argument = request.arguments;
  return yield* runTransaction(context.target, "admit", tx => Effect.gen(function* () {
    yield* requireCurrentAuthority(tx, context);
    const inserted = yield* query(
      tx.insert(fxSystemApplicationActionInvocationsV1).values({
        scopeId: context.authority.scopeId,
        scopeEpoch: context.authority.epoch,
        storageGenerationFence: context.authority.storageGenerationFence,
        requestKey: request.requestKey,
        invocationId,
        requestIdentitySha256,
        actionBindingSha256: request.actionBindingSha256,
        applicationRevisionId: request.applicationRevisionId,
        candidateSha256: request.candidateSha256,
        actionFunctionPath: request.actionFunctionPath,
        executionIdentitySha256: request.executionIdentitySha256,
        compatibilityDate: request.compatibilityDate,
        hostPolicySha256: request.hostPolicySha256,
        argumentStoreIdentity: argument.storeIdentity,
        argumentCodecIdentity: argument.codecIdentity,
        argumentObjectKey: argument.objectKey,
        argumentByteLength: argument.byteLength,
        argumentSha256: argument.sha256,
        lifecycle: "admitted",
      }).onConflictDoNothing().returning(),
    );
    if (inserted[0] !== undefined) {
      yield* proofStep(context, "afterAdmissionInsert");
      return Object.freeze({
        disposition: "inserted" as const,
        invocation: yield* decodeInvocationRow(inserted[0]),
      });
    }
    const existing = yield* loadInvocationForUpdate(
      tx,
      context.authority.scopeId,
      request.requestKey,
    );
    if (!bytesEqualFullScan(existing.requestIdentitySha256, requestIdentitySha256)) {
      return yield* new ApplicationActionRequestKeyConflictV1Error({
        requestKey: request.requestKey,
      });
    }
    return Object.freeze({
      disposition: "replayed" as const,
      invocation: yield* decodeInvocationRow(existing),
    });
  }));
});

export const admitApplicationAuthorityActionInvocation = Effect.fn(
  "ApplicationActionAuthority.admitApplicationAuthorityActionInvocation",
)(function* <HashError>(
  input: AdmitApplicationAuthorityActionInvocationInput,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  Readonly<{
    readonly disposition: "inserted" | "replayed";
    readonly invocation: ApplicationAuthorityActionInvocationProjection;
  }>,
  ApplicationActionAuthorityV1Error<HashError>
> {
  const invocationId = yield* requireUuid(
    input.invocationId,
    "admitApplication",
    "invocationId",
  );
  const requestCanonicalBytes = copyBytes(input.request.canonicalBytes);
  const decodedRequest = yield* Effect.fromResult(
    decodeApplicationActionInvocationRequestV2(
      requestCanonicalBytes,
    ),
  ).pipe(Effect.mapError(() => new ApplicationActionAuthorityInputV1Error({
    operation: "admitApplication",
    field: "request.canonicalBytes",
  })));
  const executionAuthority = yield*
    canonicalizeApplicationActionExecutionAuthorityV1(
      input.executionAuthority.authorityJson,
    ).pipe(Effect.mapError(() =>
      new ApplicationActionAuthorityInputV1Error({
        operation: "admitApplication",
        field: "executionAuthority",
      })
    ));
  const request = decodedRequest.frame;
  if (
    request.scopeId !== context.authority.scopeId ||
    executionAuthority.authority.runtimeTarget.scopeId !== request.scopeId
  ) return yield* new ApplicationActionAuthorityStaleV1Error({ reason: "scope" });
  if (
    request.actionFunctionPath !==
      executionAuthority.authority.runtimeTarget.function.path ||
    !bytesEqualFullScan(
      request.executionAuthoritySha256,
      executionAuthority.sha256,
    )
  ) {
    return yield* new ApplicationActionAuthorityInputV1Error({
      operation: "admitApplication",
      field: "executionAuthority",
    });
  }
  const requestIdentitySha256 = yield* context.sha256.hash(
    copyBytes(requestCanonicalBytes),
  );
  const argument = request.arguments;
  return yield* runTransaction(
    context.target,
    "admitApplication",
    tx => Effect.gen(function* () {
      yield* requireCurrentAuthority(tx, context);
      const inserted = yield* query(
        tx.insert(fxSystemApplicationActionInvocationsV1).values({
          scopeId: context.authority.scopeId,
          scopeEpoch: context.authority.epoch,
          storageGenerationFence: context.authority.storageGenerationFence,
          requestKey: request.requestKey,
          invocationId,
          requestIdentitySha256,
          executionAuthorityGeneration: "application_v1",
          applicationExecutionAuthorityJson:
            executionAuthority.authority,
          applicationExecutionAuthorityCanonicalBytes:
            executionAuthority.canonicalBytes,
          applicationExecutionAuthoritySha256: executionAuthority.sha256,
          actionFunctionPath: request.actionFunctionPath,
          executionIdentitySha256: request.executionIdentitySha256,
          compatibilityDate: request.compatibilityDate,
          hostPolicySha256: request.hostPolicySha256,
          argumentStoreIdentity: argument.storeIdentity,
          argumentCodecIdentity: argument.codecIdentity,
          argumentObjectKey: argument.objectKey,
          argumentByteLength: argument.byteLength,
          argumentSha256: argument.sha256,
          lifecycle: "admitted",
        }).onConflictDoNothing().returning(),
      );
      if (inserted[0] !== undefined) {
        yield* proofStep(context, "afterAdmissionInsert");
        return Object.freeze({
          disposition: "inserted" as const,
          invocation: yield* decodeApplicationInvocationRow(inserted[0]),
        });
      }
      const existing = yield* loadInvocationForUpdate(
        tx,
        context.authority.scopeId,
        request.requestKey,
      );
      if (
        !bytesEqualFullScan(
          existing.requestIdentitySha256,
          requestIdentitySha256,
        )
      ) {
        return yield* new ApplicationActionRequestKeyConflictV1Error({
          requestKey: request.requestKey,
        });
      }
      return Object.freeze({
        disposition: "replayed" as const,
        invocation: yield* decodeApplicationInvocationRow(existing),
      });
    }),
  );
});

export const claimDirectActionExecutionV1 = Effect.fn(
  "ApplicationActionAuthority.claimDirectActionExecutionV1",
)(function* <HashError>(
  requestKey: string,
  executionDurationMilliseconds: number,
  randomSeedSha256: Uint8Array,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ClaimedApplicationActionExecutionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  yield* requireText(requestKey, "claim", "requestKey");
  if (!Number.isSafeInteger(executionDurationMilliseconds) || executionDurationMilliseconds < 1) {
    return yield* inputError("claim", "executionDurationMilliseconds");
  }
  const capturedRandomSeedSha256 = yield* requireDigest(
    randomSeedSha256,
    "claim",
    "randomSeedSha256",
  );
  return yield* Effect.uninterruptible(Effect.gen(function* () {
    const claimed = yield* runTransaction(context.target, "claim", tx => Effect.gen(function* () {
      yield* requireCurrentAuthority(tx, context);
      const row = yield* loadInvocationForUpdate(tx, context.authority.scopeId, requestKey);
      if (row.lifecycle !== "admitted") {
        return yield* lifecycleConflict("claim", "admitted", row.lifecycle);
      }
      const frame: ExternalEffectExecutionSubjectFrameV1 = Object.freeze({
        kind: "direct_action",
        scopeId: row.scopeId,
        invocationId: row.invocationId,
        requestIdentitySha256: copyBytes(row.requestIdentitySha256),
      });
      const encoded = yield* Effect.fromResult(
        encodeExternalEffectExecutionSubjectV1(frame),
      ).pipe(Effect.mapError(() =>
        new ApplicationActionAuthorityCorruptionV1Error({
          detail: "direct action subject encoding failed",
        })
      ));
      const subjectIdentitySha256 = yield* context.sha256.hash(
        encoded.canonicalBytes,
      );
      const updated = yield* query(tx.update(fxSystemApplicationActionInvocationsV1)
        .set({
          lifecycle: "executing",
          executionGeneration: sql`${fxSystemApplicationActionInvocationsV1.executionGeneration} + 1`,
          invocationTime: sql`current_timestamp`,
          executionDeadline: sql`current_timestamp + (${executionDurationMilliseconds} * interval '1 millisecond')`,
          randomSeedSha256: capturedRandomSeedSha256,
          updatedAt: sql`current_timestamp`,
        })
        .where(and(eq(fxSystemApplicationActionInvocationsV1.scopeId, context.authority.scopeId), eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey), eq(fxSystemApplicationActionInvocationsV1.lifecycle, "admitted")))
        .returning());
      if (updated[0] === undefined) return yield* lifecycleConflict("claim", "admitted", "concurrent_transition");
      yield* proofStep(context, "afterClaimUpdate");
      return Object.freeze({
        projection: yield* decodeInvocationRow(updated[0]),
        subjectIdentitySha256: copyBytes(subjectIdentitySha256),
      });
    }));
    const subject = Object.freeze({}) as DirectActionExecutionSubjectCapabilityV1;
    subjectStates.set(subject, Object.freeze({
      scopeId: claimed.projection.scopeId,
      requestKey: claimed.projection.requestKey,
      invocationId: claimed.projection.invocationId,
      requestIdentitySha256: copyBytes(claimed.projection.requestIdentitySha256),
      subjectIdentitySha256: copyBytes(claimed.subjectIdentitySha256),
      executionGeneration: claimed.projection.executionGeneration,
    }));
    return Object.freeze({ invocation: claimed.projection, subject });
  }));
});

export const claimApplicationAuthorityActionExecution = Effect.fn(
  "ApplicationActionAuthority.claimApplicationAuthorityActionExecution",
)(function* <HashError>(
  requestKey: string,
  executionDurationMilliseconds: number,
  randomSeedSha256: Uint8Array,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ClaimedApplicationAuthorityActionExecution,
  ApplicationActionAuthorityV1Error<HashError>
> {
  yield* requireText(requestKey, "claimApplication", "requestKey");
  if (
    !Number.isSafeInteger(executionDurationMilliseconds) ||
    executionDurationMilliseconds < 1
  ) return yield* inputError(
    "claimApplication",
    "executionDurationMilliseconds",
  );
  const capturedRandomSeedSha256 = yield* requireDigest(
    randomSeedSha256,
    "claimApplication",
    "randomSeedSha256",
  );
  return yield* Effect.uninterruptible(Effect.gen(function* () {
    const claimed = yield* runTransaction(
      context.target,
      "claimApplication",
      tx => Effect.gen(function* () {
        yield* requireCurrentAuthority(tx, context);
        const row = yield* loadInvocationForUpdate(
          tx,
          context.authority.scopeId,
          requestKey,
        );
        if (row.lifecycle !== "admitted") {
          return yield* lifecycleConflict(
            "claimApplication",
            "admitted",
            row.lifecycle,
          );
        }
        yield* decodeApplicationInvocationRow(row);
        const frame: ExternalEffectExecutionSubjectFrameV1 = Object.freeze({
          kind: "direct_action",
          scopeId: row.scopeId,
          invocationId: row.invocationId,
          requestIdentitySha256: copyBytes(row.requestIdentitySha256),
        });
        const encoded = yield* Effect.fromResult(
          encodeExternalEffectExecutionSubjectV1(frame),
        ).pipe(Effect.mapError(() =>
          new ApplicationActionAuthorityCorruptionV1Error({
            detail: "Application direct action subject encoding failed",
          })
        ));
        const subjectIdentitySha256 = yield* context.sha256.hash(
          encoded.canonicalBytes,
        );
        const updated = yield* query(
          tx.update(fxSystemApplicationActionInvocationsV1).set({
            lifecycle: "executing",
            executionGeneration:
              sql`${fxSystemApplicationActionInvocationsV1.executionGeneration} + 1`,
            invocationTime: sql`current_timestamp`,
            executionDeadline:
              sql`current_timestamp + (${executionDurationMilliseconds} * interval '1 millisecond')`,
            randomSeedSha256: capturedRandomSeedSha256,
            updatedAt: sql`current_timestamp`,
          }).where(and(
            eq(
              fxSystemApplicationActionInvocationsV1.scopeId,
              context.authority.scopeId,
            ),
            eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey),
            eq(fxSystemApplicationActionInvocationsV1.lifecycle, "admitted"),
            eq(
              fxSystemApplicationActionInvocationsV1.executionAuthorityGeneration,
              "application_v1",
            ),
          )).returning(),
        );
        if (updated[0] === undefined) {
          return yield* lifecycleConflict(
            "claimApplication",
            "admitted_application_v1",
            "concurrent_transition",
          );
        }
        yield* proofStep(context, "afterClaimUpdate");
        return Object.freeze({
          projection: yield* decodeApplicationInvocationRow(updated[0]),
          subjectIdentitySha256: copyBytes(subjectIdentitySha256),
        });
      }),
    );
    const subject = Object.freeze({}) as DirectActionExecutionSubjectCapabilityV1;
    subjectStates.set(subject, Object.freeze({
      scopeId: claimed.projection.scopeId,
      requestKey: claimed.projection.requestKey,
      invocationId: claimed.projection.invocationId,
      requestIdentitySha256: copyBytes(
        claimed.projection.requestIdentitySha256,
      ),
      subjectIdentitySha256: copyBytes(claimed.subjectIdentitySha256),
      executionGeneration: claimed.projection.executionGeneration,
    }));
    return Object.freeze({ invocation: claimed.projection, subject });
  }));
});

export function revokeDirectActionExecutionSubjectV1(
  subject: DirectActionExecutionSubjectCapabilityV1,
): void {
  subjectStates.delete(subject);
}

export const prepareExternalEffectAttemptV1 = Effect.fn(
  "ApplicationActionAuthority.prepareExternalEffectAttemptV1",
)(function* <HashError>(
  subjectInput: DirectActionExecutionSubjectCapabilityV1,
  input: PrepareExternalEffectAttemptV1Input,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  const subject = yield* claimSubject(subjectInput, context.authority.scopeId);
  yield* requireText(input.stableEffectKey, "prepareEffect", "stableEffectKey");
  const requestIdentitySha256 = yield* requireDigest(
    input.requestIdentitySha256,
    "prepareEffect",
    "requestIdentitySha256",
  );
  const outboundRequest = input.effectKind === "outbound_http"
    ? yield* requireBodyReference(
        input.request,
        "outbound_http_request",
        "prepareEffect",
        "request",
      )
    : null;
  const childMutationArgumentsSha256 = input.effectKind === "child_mutation"
    ? yield* requireDigest(
        input.childMutationArgumentsSha256,
        "prepareEffect",
        "childMutation",
      )
    : null;
  if (
    input.effectKind === "child_mutation" &&
    (!boundedText(input.childMutationRequestKey) ||
      !boundedText(input.childMutationFunctionPath))
  ) return yield* inputError("prepareEffect", "childMutation");
  return yield* runTransaction(context.target, "prepareEffect", tx => Effect.gen(function* () {
    yield* requireCurrentAuthority(tx, context);
    const parent = yield* loadInvocationForUpdate(tx, subject.scopeId, subject.requestKey);
    yield* requireSubjectMatchesRow(subject, parent);
    if (parent.lifecycle !== "executing") {
      return yield* lifecycleConflict("prepareEffect", "executing", parent.lifecycle);
    }
    const nextOrdinal = parent.lastEffectOrdinal + 1n;
    const updated = yield* query(tx.update(fxSystemApplicationActionInvocationsV1)
      .set({ lastEffectOrdinal: nextOrdinal, updatedAt: sql`current_timestamp` })
      .where(and(eq(fxSystemApplicationActionInvocationsV1.scopeId, subject.scopeId), eq(fxSystemApplicationActionInvocationsV1.requestKey, subject.requestKey), eq(fxSystemApplicationActionInvocationsV1.executionGeneration, subject.executionGeneration), eq(fxSystemApplicationActionInvocationsV1.lifecycle, "executing")))
      .returning({ lastEffectOrdinal: fxSystemApplicationActionInvocationsV1.lastEffectOrdinal }));
    if (updated[0]?.lastEffectOrdinal !== nextOrdinal) {
      return yield* lifecycleConflict("prepareEffect", "executing_current_fence", "concurrent_transition");
    }
    yield* proofStep(context, "afterEffectOrdinalUpdate");
    const row = yield* query(tx.insert(fxSystemExternalEffectAttemptsV1).values({
      scopeId: subject.scopeId,
      subjectKind: "direct_action",
      subjectIdentitySha256: subject.subjectIdentitySha256,
      subjectFence: subject.executionGeneration,
      effectOrdinal: nextOrdinal,
      effectKind: input.effectKind,
      stableEffectKey: input.stableEffectKey,
      requestIdentitySha256,
      ...(input.effectKind === "outbound_http"
        ? {
            requestStoreIdentity: outboundRequest!.storeIdentity,
            requestCodecIdentity: outboundRequest!.codecIdentity,
            requestObjectKey: outboundRequest!.objectKey,
            requestByteLength: outboundRequest!.byteLength,
            requestSha256: outboundRequest!.sha256,
          }
        : {
            childMutationRequestKey: input.childMutationRequestKey,
            childMutationFunctionPath: input.childMutationFunctionPath,
            childMutationArgumentsSha256: childMutationArgumentsSha256!,
          }),
      state: "prepared",
    }).returning());
    if (row[0] === undefined) return yield* corruption("effect insert returned no row");
    yield* proofStep(context, "afterEffectInsert");
    return yield* decodeEffectRow(row[0]);
  }));
});

export const declareExternalEffectDispatchV1 = transitionEffect(
  "declareDispatch",
  "prepared",
  "dispatching",
);

export const failExternalEffectBeforeDispatchV1 = <HashError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  terminalCode: string,
  context: ApplicationActionAuthorityContextV1<HashError>,
) => transitionEffect(
  "failBeforeDispatch",
  "prepared",
  "failed_before_dispatch",
)(subject, effectOrdinal, context, terminalCode);

export const markExternalEffectUncertainV1 = <HashError>(
  subject: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  terminalCode: string,
  context: ApplicationActionAuthorityContextV1<HashError>,
) => transitionEffect(
  "markUncertain",
  "dispatching",
  "uncertain",
)(subject, effectOrdinal, context, terminalCode);

export const confirmExternalEffectAttemptV1 = Effect.fn(
  "ApplicationActionAuthority.confirmExternalEffectAttemptV1",
)(function* <HashError>(
  subjectInput: DirectActionExecutionSubjectCapabilityV1,
  effectOrdinal: bigint,
  outcome: ConfirmExternalEffectAttemptV1Outcome,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ExternalEffectAttemptProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  const subject = yield* claimSubject(subjectInput, context.authority.scopeId);
  yield* requireOrdinal(effectOrdinal, "confirmEffect");
  const response = outcome.effectKind === "outbound_http"
    ? yield* requireBodyReference(
        outcome.response,
        "outbound_http_response",
        "confirmEffect",
        "response",
      )
    : null;
  const childMutationOutcomeSha256 = outcome.effectKind === "child_mutation"
    ? yield* requireDigest(
        outcome.childMutationOutcomeSha256,
        "confirmEffect",
        "childMutationOutcomeSha256",
      )
    : null;
  return yield* runTransaction(context.target, "confirmEffect", tx => Effect.gen(function* () {
    yield* requireCurrentAuthority(tx, context);
    const parent = yield* loadInvocationForUpdate(
      tx,
      subject.scopeId,
      subject.requestKey,
    );
    yield* requireSubjectMatchesRow(subject, parent);
    if (parent.lifecycle !== "executing") {
      return yield* lifecycleConflict(
        "confirmEffect",
        "executing",
        parent.lifecycle,
      );
    }
    const current = yield* loadEffectForUpdate(tx, subject, effectOrdinal);
    if (current.state !== "dispatching") return yield* lifecycleConflict("confirmEffect", "dispatching", current.state);
    if (current.effectKind !== outcome.effectKind) return yield* inputError("confirmEffect", "effectKind");
    const rows = yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
      state: "confirmed",
      settledAt: sql`current_timestamp`,
      ...(outcome.effectKind === "outbound_http"
        ? {
            responseStoreIdentity: response!.storeIdentity,
            responseCodecIdentity: response!.codecIdentity,
            responseObjectKey: response!.objectKey,
            responseByteLength: response!.byteLength,
            responseSha256: response!.sha256,
          }
        : { childMutationOutcomeSha256: childMutationOutcomeSha256! }),
    }).where(effectWhere(subject, effectOrdinal, "dispatching")).returning());
    if (rows[0] === undefined) return yield* lifecycleConflict("confirmEffect", "dispatching", "concurrent_transition");
    yield* proofStep(context, "afterEffectConfirmationUpdate");
    return yield* decodeEffectRow(rows[0]);
  }));
});

export const settleDirectActionInvocationV1 = Effect.fn(
  "ApplicationActionAuthority.settleDirectActionInvocationV1",
)(function* <HashError>(
  subjectInput: DirectActionExecutionSubjectCapabilityV1,
  outcome: SettleApplicationActionInvocationV1Outcome,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  const subject = yield* claimSubject(subjectInput, context.authority.scopeId);
  const result = outcome.lifecycle === "completed"
    ? yield* requireBodyReference(
        outcome.result,
        "action_result",
        "settle",
        "result",
      )
    : null;
  if (outcome.lifecycle !== "completed" && !boundedText(outcome.terminalCode)) {
    return yield* inputError("settle", "terminalCode");
  }
  const projection = yield* runTransaction(context.target, "settle", tx => Effect.gen(function* () {
    yield* requireCurrentAuthority(tx, context);
    const row = yield* loadInvocationForUpdate(tx, subject.scopeId, subject.requestKey);
    yield* requireSubjectMatchesRow(subject, row);
    if (row.lifecycle !== "executing") return yield* lifecycleConflict("settle", "executing", row.lifecycle);
    const effectStates = yield* query(tx.select({ state: fxSystemExternalEffectAttemptsV1.state })
      .from(fxSystemExternalEffectAttemptsV1)
      .where(and(
        eq(fxSystemExternalEffectAttemptsV1.scopeId, subject.scopeId),
        eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
        eq(fxSystemExternalEffectAttemptsV1.subjectIdentitySha256, subject.subjectIdentitySha256),
        eq(fxSystemExternalEffectAttemptsV1.subjectFence, subject.executionGeneration),
      )));
    if (effectStates.some(effect => effect.state === "prepared")) {
      return yield* lifecycleConflict(
        "settle",
        "no_prepared_effects",
        "prepared_effect_pending",
      );
    }
    const possibleDispatch = effectStates.some(
      effect => effect.state === "dispatching" || effect.state === "uncertain",
    );
    if (possibleDispatch && outcome.lifecycle !== "uncertain") {
      return yield* lifecycleConflict("settle", "uncertain_after_possible_dispatch", outcome.lifecycle);
    }
    if (outcome.lifecycle === "uncertain") {
      yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
        state: "uncertain",
        terminalCode: outcome.terminalCode,
        settledAt: sql`current_timestamp`,
      }).where(and(
        eq(fxSystemExternalEffectAttemptsV1.scopeId, subject.scopeId),
        eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
          subject.subjectIdentitySha256,
        ),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectFence,
          subject.executionGeneration,
        ),
        eq(fxSystemExternalEffectAttemptsV1.state, "dispatching"),
      )).returning({
        effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
      }));
      yield* proofStep(context, "afterSettlementEffectUpdate");
    }
    const rows = yield* query(tx.update(fxSystemApplicationActionInvocationsV1).set({
      lifecycle: outcome.lifecycle,
      terminalAt: sql`current_timestamp`,
      updatedAt: sql`current_timestamp`,
      ...(outcome.lifecycle === "completed"
        ? {
            resultStoreIdentity: result!.storeIdentity,
            resultCodecIdentity: result!.codecIdentity,
            resultObjectKey: result!.objectKey,
            resultByteLength: result!.byteLength,
            resultSha256: result!.sha256,
          }
        : { terminalCode: outcome.terminalCode }),
    }).where(and(
      eq(fxSystemApplicationActionInvocationsV1.scopeId, subject.scopeId),
      eq(fxSystemApplicationActionInvocationsV1.requestKey, subject.requestKey),
      eq(fxSystemApplicationActionInvocationsV1.executionGeneration, subject.executionGeneration),
      eq(fxSystemApplicationActionInvocationsV1.lifecycle, "executing"),
    )).returning());
    if (rows[0] === undefined) return yield* lifecycleConflict("settle", "executing_current_fence", "concurrent_transition");
    yield* proofStep(context, "afterSettlementUpdate");
    return yield* decodeInvocationRow(rows[0]);
  }));
  revokeDirectActionExecutionSubjectV1(subjectInput);
  return projection;
});

export const settleApplicationAuthorityActionInvocation = Effect.fn(
  "ApplicationActionAuthority.settleApplicationAuthorityActionInvocation",
)(function* <HashError>(
  subjectInput: DirectActionExecutionSubjectCapabilityV1,
  outcome: SettleApplicationActionInvocationV1Outcome,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationAuthorityActionInvocationProjection,
  ApplicationActionAuthorityV1Error<HashError>
> {
  const subject = yield* claimSubject(subjectInput, context.authority.scopeId);
  const result = outcome.lifecycle === "completed"
    ? yield* requireBodyReference(outcome.result, "action_result", "settleApplication", "result")
    : null;
  if (outcome.lifecycle !== "completed" && !boundedText(outcome.terminalCode)) {
    return yield* inputError("settleApplication", "terminalCode");
  }
  const projection = yield* runTransaction(
    context.target,
    "settleApplication",
    tx => Effect.gen(function* () {
      yield* requireCurrentAuthority(tx, context);
      const row = yield* loadInvocationForUpdate(
        tx,
        subject.scopeId,
        subject.requestKey,
      );
      yield* requireSubjectMatchesRow(subject, row);
      yield* decodeApplicationInvocationRow(row);
      if (row.lifecycle !== "executing") {
        return yield* lifecycleConflict(
          "settleApplication",
          "executing",
          row.lifecycle,
        );
      }
      const effectStates = yield* query(
        tx.select({ state: fxSystemExternalEffectAttemptsV1.state })
          .from(fxSystemExternalEffectAttemptsV1).where(and(
            eq(fxSystemExternalEffectAttemptsV1.scopeId, subject.scopeId),
            eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
            eq(
              fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
              subject.subjectIdentitySha256,
            ),
            eq(
              fxSystemExternalEffectAttemptsV1.subjectFence,
              subject.executionGeneration,
            ),
          )),
      );
      if (effectStates.some(effect => effect.state === "prepared")) {
        return yield* lifecycleConflict(
          "settleApplication",
          "no_prepared_effects",
          "prepared_effect_pending",
        );
      }
      const possibleDispatch = effectStates.some(effect =>
        effect.state === "dispatching" || effect.state === "uncertain"
      );
      if (possibleDispatch && outcome.lifecycle !== "uncertain") {
        return yield* lifecycleConflict(
          "settleApplication",
          "uncertain_after_possible_dispatch",
          outcome.lifecycle,
        );
      }
      if (outcome.lifecycle === "uncertain") {
        yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
          state: "uncertain",
          terminalCode: outcome.terminalCode,
          settledAt: sql`current_timestamp`,
        }).where(and(
          eq(fxSystemExternalEffectAttemptsV1.scopeId, subject.scopeId),
          eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
          eq(
            fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
            subject.subjectIdentitySha256,
          ),
          eq(
            fxSystemExternalEffectAttemptsV1.subjectFence,
            subject.executionGeneration,
          ),
          eq(fxSystemExternalEffectAttemptsV1.state, "dispatching"),
        )).returning({
          effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
        }));
        yield* proofStep(context, "afterSettlementEffectUpdate");
      }
      const rows = yield* query(
        tx.update(fxSystemApplicationActionInvocationsV1).set({
          lifecycle: outcome.lifecycle,
          terminalAt: sql`current_timestamp`,
          updatedAt: sql`current_timestamp`,
          ...(outcome.lifecycle === "completed"
            ? {
                resultStoreIdentity: result!.storeIdentity,
                resultCodecIdentity: result!.codecIdentity,
                resultObjectKey: result!.objectKey,
                resultByteLength: result!.byteLength,
                resultSha256: result!.sha256,
              }
            : { terminalCode: outcome.terminalCode }),
        }).where(and(
          eq(fxSystemApplicationActionInvocationsV1.scopeId, subject.scopeId),
          eq(
            fxSystemApplicationActionInvocationsV1.requestKey,
            subject.requestKey,
          ),
          eq(
            fxSystemApplicationActionInvocationsV1.executionGeneration,
            subject.executionGeneration,
          ),
          eq(fxSystemApplicationActionInvocationsV1.lifecycle, "executing"),
          eq(
            fxSystemApplicationActionInvocationsV1.executionAuthorityGeneration,
            "application_v1",
          ),
        )).returning(),
      );
      if (rows[0] === undefined) {
        return yield* lifecycleConflict(
          "settleApplication",
          "executing_current_fence",
          "concurrent_transition",
        );
      }
      yield* proofStep(context, "afterSettlementUpdate");
      return yield* decodeApplicationInvocationRow(rows[0]);
    }),
  );
  revokeDirectActionExecutionSubjectV1(subjectInput);
  return projection;
});

export const requestDirectActionCancellationV1 = Effect.fn(
  "ApplicationActionAuthority.requestCancellationV1",
)(function* <HashError>(
  requestKey: string,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  yield* requireText(requestKey, "cancel", "requestKey");
  return yield* runTransaction(context.target, "cancel", tx => Effect.gen(function* () {
    yield* requireCurrentAuthority(tx, context);
    const row = yield* loadInvocationForUpdate(tx, context.authority.scopeId, requestKey);
    if (row.lifecycle !== "admitted" && row.lifecycle !== "executing") {
      return yield* decodeInvocationRow(row);
    }
    const rows = yield* query(tx.update(fxSystemApplicationActionInvocationsV1).set(
      row.lifecycle === "admitted"
        ? { lifecycle: "cancelled", cancellationRequestedAt: sql`current_timestamp`, terminalCode: "cancelled_before_execution", terminalAt: sql`current_timestamp`, updatedAt: sql`current_timestamp` }
        : { cancellationRequestedAt: sql`current_timestamp`, updatedAt: sql`current_timestamp` },
    ).where(and(eq(fxSystemApplicationActionInvocationsV1.scopeId, context.authority.scopeId), eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey), eq(fxSystemApplicationActionInvocationsV1.lifecycle, row.lifecycle))).returning());
    if (rows[0] === undefined) return yield* lifecycleConflict("cancel", row.lifecycle, "concurrent_transition");
    yield* proofStep(context, "afterCancellationUpdate");
    return yield* decodeInvocationRow(rows[0]);
  }));
});

export const requestApplicationAuthorityActionCancellation = Effect.fn(
  "ApplicationActionAuthority.requestApplicationAuthorityCancellation",
)(function* <HashError>(
  requestKey: string,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationAuthorityActionInvocationProjection,
  ApplicationActionAuthorityV1Error<HashError>
> {
  yield* requireText(requestKey, "cancelApplication", "requestKey");
  return yield* runTransaction(
    context.target,
    "cancelApplication",
    tx => Effect.gen(function* () {
      yield* requireCurrentAuthority(tx, context);
      const row = yield* loadInvocationForUpdate(
        tx,
        context.authority.scopeId,
        requestKey,
      );
      yield* decodeApplicationInvocationRow(row);
      if (row.lifecycle !== "admitted" && row.lifecycle !== "executing") {
        return yield* decodeApplicationInvocationRow(row);
      }
      const rows = yield* query(
        tx.update(fxSystemApplicationActionInvocationsV1).set(
          row.lifecycle === "admitted"
            ? {
                lifecycle: "cancelled",
                cancellationRequestedAt: sql`current_timestamp`,
                terminalCode: "cancelled_before_execution",
                terminalAt: sql`current_timestamp`,
                updatedAt: sql`current_timestamp`,
              }
            : {
                cancellationRequestedAt: sql`current_timestamp`,
                updatedAt: sql`current_timestamp`,
              },
        ).where(and(
          eq(
            fxSystemApplicationActionInvocationsV1.scopeId,
            context.authority.scopeId,
          ),
          eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey),
          eq(fxSystemApplicationActionInvocationsV1.lifecycle, row.lifecycle),
          eq(
            fxSystemApplicationActionInvocationsV1.executionAuthorityGeneration,
            "application_v1",
          ),
        )).returning(),
      );
      if (rows[0] === undefined) {
        return yield* lifecycleConflict(
          "cancelApplication",
          row.lifecycle,
          "concurrent_transition",
        );
      }
      yield* proofStep(context, "afterCancellationUpdate");
      return yield* decodeApplicationInvocationRow(rows[0]);
    }),
  );
});

export const recoverExpiredDirectActionExecutionV1 = Effect.fn(
  "ApplicationActionAuthority.recoverExpiredExecutionV1",
)(function* <HashError>(
  requestKey: string,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  yield* requireText(requestKey, "recover", "requestKey");
  return yield* runTransaction(context.target, "recover", tx => Effect.gen(function* () {
    yield* requireCurrentAuthority(tx, context);
    const row = yield* loadInvocationForUpdate(tx, context.authority.scopeId, requestKey);
    if (row.lifecycle !== "executing") return yield* lifecycleConflict("recover", "executing", row.lifecycle);
    const expired = yield* query(tx.select({ expired: sql<boolean>`${row.executionDeadline} <= current_timestamp` }).from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, context.authority.scopeId)).limit(1));
    if (expired[0]?.expired !== true) return yield* lifecycleConflict("recover", "expired", "not_expired");
    const subjectFrame: ExternalEffectExecutionSubjectFrameV1 = Object.freeze({
      kind: "direct_action",
      scopeId: row.scopeId,
      invocationId: row.invocationId,
      requestIdentitySha256: copyBytes(row.requestIdentitySha256),
    });
    const encodedSubject = yield* Effect.fromResult(
      encodeExternalEffectExecutionSubjectV1(subjectFrame),
    ).pipe(Effect.mapError(() =>
      new ApplicationActionAuthorityCorruptionV1Error({
        detail: "stored direct action subject could not be encoded",
      })
    ));
    const subjectIdentitySha256 = yield* context.sha256.hash(
      encodedSubject.canonicalBytes,
    );
    const possible = yield* query(tx.select({ state: fxSystemExternalEffectAttemptsV1.state }).from(fxSystemExternalEffectAttemptsV1).where(and(
      eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
      eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
      eq(
        fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
        subjectIdentitySha256,
      ),
      eq(fxSystemExternalEffectAttemptsV1.subjectFence, row.executionGeneration),
      sql`${fxSystemExternalEffectAttemptsV1.state} in ('dispatching', 'confirmed', 'uncertain')`,
    )).limit(1));
    if (possible[0] !== undefined) {
      yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
        state: "failed_before_dispatch",
        terminalCode: "parent_execution_expired_before_dispatch",
        settledAt: sql`current_timestamp`,
      }).where(and(
        eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
        eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
          subjectIdentitySha256,
        ),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectFence,
          row.executionGeneration,
        ),
        eq(fxSystemExternalEffectAttemptsV1.state, "prepared"),
      )).returning({
        effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
      }));
      yield* proofStep(context, "afterRecoveryPreparedEffectUpdate");
      yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
        state: "uncertain",
        terminalCode: "parent_execution_expired_after_possible_dispatch",
        settledAt: sql`current_timestamp`,
      }).where(and(
        eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
        eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
          subjectIdentitySha256,
        ),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectFence,
          row.executionGeneration,
        ),
        eq(fxSystemExternalEffectAttemptsV1.state, "dispatching"),
      )).returning({
        effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
      }));
      yield* proofStep(context, "afterRecoveryDispatchingEffectUpdate");
      const uncertain = yield* query(tx.update(fxSystemApplicationActionInvocationsV1).set({ lifecycle: "uncertain", terminalCode: "execution_expired_after_possible_dispatch", terminalAt: sql`current_timestamp`, updatedAt: sql`current_timestamp` }).where(and(eq(fxSystemApplicationActionInvocationsV1.scopeId, context.authority.scopeId), eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey), eq(fxSystemApplicationActionInvocationsV1.lifecycle, "executing"), eq(fxSystemApplicationActionInvocationsV1.executionGeneration, row.executionGeneration))).returning());
      if (uncertain[0] === undefined) return yield* lifecycleConflict("recover", "executing_current_fence", "concurrent_transition");
      yield* proofStep(context, "afterRecoveryParentUpdate");
      return yield* decodeInvocationRow(uncertain[0]);
    }
    yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({ state: "failed_before_dispatch", terminalCode: "parent_execution_expired_before_dispatch", settledAt: sql`current_timestamp` }).where(and(
      eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
      eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
      eq(
        fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
        subjectIdentitySha256,
      ),
      eq(fxSystemExternalEffectAttemptsV1.subjectFence, row.executionGeneration),
      eq(fxSystemExternalEffectAttemptsV1.state, "prepared"),
    )).returning({
      effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
    }));
    yield* proofStep(context, "afterRecoveryPreparedEffectUpdate");
    const recovered = yield* query(tx.update(fxSystemApplicationActionInvocationsV1).set(
      row.cancellationRequestedAt === null
        ? {
            lifecycle: "admitted",
            invocationTime: null,
            executionDeadline: null,
            randomSeedSha256: null,
            updatedAt: sql`current_timestamp`,
          }
        : {
            lifecycle: "cancelled",
            terminalCode: "cancelled_before_dispatch_recovery",
            terminalAt: sql`current_timestamp`,
            updatedAt: sql`current_timestamp`,
          },
    ).where(and(eq(fxSystemApplicationActionInvocationsV1.scopeId, context.authority.scopeId), eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey), eq(fxSystemApplicationActionInvocationsV1.lifecycle, "executing"), eq(fxSystemApplicationActionInvocationsV1.executionGeneration, row.executionGeneration))).returning());
    if (recovered[0] === undefined) return yield* lifecycleConflict("recover", "executing_current_fence", "concurrent_transition");
    yield* proofStep(context, "afterRecoveryParentUpdate");
    return yield* decodeInvocationRow(recovered[0]);
  }));
});

export const recoverExpiredApplicationAuthorityActionExecution = Effect.fn(
  "ApplicationActionAuthority.recoverExpiredApplicationAuthorityExecution",
)(function* <HashError>(
  requestKey: string,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationAuthorityActionInvocationProjection,
  ApplicationActionAuthorityV1Error<HashError>
> {
  yield* requireText(requestKey, "recoverApplication", "requestKey");
  return yield* runTransaction(
    context.target,
    "recoverApplication",
    tx => Effect.gen(function* () {
      yield* requireCurrentAuthority(tx, context);
      const row = yield* loadInvocationForUpdate(
        tx,
        context.authority.scopeId,
        requestKey,
      );
      yield* decodeApplicationInvocationRow(row);
      if (row.lifecycle !== "executing") {
        return yield* lifecycleConflict(
          "recoverApplication",
          "executing",
          row.lifecycle,
        );
      }
      const expired = yield* query(tx.select({
        expired: sql<boolean>`${row.executionDeadline} <= current_timestamp`,
      }).from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        context.authority.scopeId,
      )).limit(1));
      if (expired[0]?.expired !== true) {
        return yield* lifecycleConflict(
          "recoverApplication",
          "expired",
          "not_expired",
        );
      }
      const subjectFrame: ExternalEffectExecutionSubjectFrameV1 =
        Object.freeze({
          kind: "direct_action",
          scopeId: row.scopeId,
          invocationId: row.invocationId,
          requestIdentitySha256: copyBytes(row.requestIdentitySha256),
        });
      const encodedSubject = yield* Effect.fromResult(
        encodeExternalEffectExecutionSubjectV1(subjectFrame),
      ).pipe(Effect.mapError(() =>
        new ApplicationActionAuthorityCorruptionV1Error({
          detail: "stored Application direct action subject could not be encoded",
        })
      ));
      const subjectIdentitySha256 = yield* context.sha256.hash(
        encodedSubject.canonicalBytes,
      );
      const possible = yield* query(tx.select({
        state: fxSystemExternalEffectAttemptsV1.state,
      }).from(fxSystemExternalEffectAttemptsV1).where(and(
        eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
        eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
          subjectIdentitySha256,
        ),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectFence,
          row.executionGeneration,
        ),
        sql`${fxSystemExternalEffectAttemptsV1.state} in ('dispatching', 'confirmed', 'uncertain')`,
      )).limit(1));
      if (possible[0] !== undefined) {
        yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
          state: "failed_before_dispatch",
          terminalCode: "parent_execution_expired_before_dispatch",
          settledAt: sql`current_timestamp`,
        }).where(and(
          eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
          eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
          eq(
            fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
            subjectIdentitySha256,
          ),
          eq(
            fxSystemExternalEffectAttemptsV1.subjectFence,
            row.executionGeneration,
          ),
          eq(fxSystemExternalEffectAttemptsV1.state, "prepared"),
        )).returning({
          effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
        }));
        yield* proofStep(context, "afterRecoveryPreparedEffectUpdate");
        yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
          state: "uncertain",
          terminalCode: "parent_execution_expired_after_possible_dispatch",
          settledAt: sql`current_timestamp`,
        }).where(and(
          eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
          eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
          eq(
            fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
            subjectIdentitySha256,
          ),
          eq(
            fxSystemExternalEffectAttemptsV1.subjectFence,
            row.executionGeneration,
          ),
          eq(fxSystemExternalEffectAttemptsV1.state, "dispatching"),
        )).returning({
          effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
        }));
        yield* proofStep(context, "afterRecoveryDispatchingEffectUpdate");
        const uncertain = yield* query(
          tx.update(fxSystemApplicationActionInvocationsV1).set({
            lifecycle: "uncertain",
            terminalCode: "execution_expired_after_possible_dispatch",
            terminalAt: sql`current_timestamp`,
            updatedAt: sql`current_timestamp`,
          }).where(and(
            eq(
              fxSystemApplicationActionInvocationsV1.scopeId,
              context.authority.scopeId,
            ),
            eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey),
            eq(fxSystemApplicationActionInvocationsV1.lifecycle, "executing"),
            eq(
              fxSystemApplicationActionInvocationsV1.executionGeneration,
              row.executionGeneration,
            ),
            eq(
              fxSystemApplicationActionInvocationsV1.executionAuthorityGeneration,
              "application_v1",
            ),
          )).returning(),
        );
        if (uncertain[0] === undefined) {
          return yield* lifecycleConflict(
            "recoverApplication",
            "executing_current_fence",
            "concurrent_transition",
          );
        }
        yield* proofStep(context, "afterRecoveryParentUpdate");
        return yield* decodeApplicationInvocationRow(uncertain[0]);
      }
      yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
        state: "failed_before_dispatch",
        terminalCode: "parent_execution_expired_before_dispatch",
        settledAt: sql`current_timestamp`,
      }).where(and(
        eq(fxSystemExternalEffectAttemptsV1.scopeId, context.authority.scopeId),
        eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
          subjectIdentitySha256,
        ),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectFence,
          row.executionGeneration,
        ),
        eq(fxSystemExternalEffectAttemptsV1.state, "prepared"),
      )).returning({
        effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal,
      }));
      yield* proofStep(context, "afterRecoveryPreparedEffectUpdate");
      const recovered = yield* query(
        tx.update(fxSystemApplicationActionInvocationsV1).set(
          row.cancellationRequestedAt === null
            ? {
                lifecycle: "admitted",
                invocationTime: null,
                executionDeadline: null,
                randomSeedSha256: null,
                updatedAt: sql`current_timestamp`,
              }
            : {
                lifecycle: "cancelled",
                terminalCode: "cancelled_before_dispatch_recovery",
                terminalAt: sql`current_timestamp`,
                updatedAt: sql`current_timestamp`,
              },
        ).where(and(
          eq(
            fxSystemApplicationActionInvocationsV1.scopeId,
            context.authority.scopeId,
          ),
          eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey),
          eq(fxSystemApplicationActionInvocationsV1.lifecycle, "executing"),
          eq(
            fxSystemApplicationActionInvocationsV1.executionGeneration,
            row.executionGeneration,
          ),
          eq(
            fxSystemApplicationActionInvocationsV1.executionAuthorityGeneration,
            "application_v1",
          ),
        )).returning(),
      );
      if (recovered[0] === undefined) {
        return yield* lifecycleConflict(
          "recoverApplication",
          "executing_current_fence",
          "concurrent_transition",
        );
      }
      yield* proofStep(context, "afterRecoveryParentUpdate");
      return yield* decodeApplicationInvocationRow(recovered[0]);
    }),
  );
});

export const inspectDirectActionInvocationV1 = Effect.fn(
  "ApplicationActionAuthority.inspectV1",
)(function* <HashError>(
  requestKey: string,
  context: ApplicationActionAuthorityContextV1<HashError>,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  ApplicationActionAuthorityV1Error<HashError>
> {
  yield* requireText(requestKey, "inspect", "requestKey");
  return yield* runTransaction(context.target, "inspect", tx => Effect.gen(function* () {
    yield* requireCurrentAuthority(tx, context);
    return yield* decodeInvocationRow(
      yield* loadInvocationForUpdate(tx, context.authority.scopeId, requestKey),
    );
  }));
});

function transitionEffect(
  operation: string,
  expected: ExternalEffectAttemptStateV1,
  next: ExternalEffectAttemptStateV1,
) {
  return Effect.fn(`ApplicationActionAuthority.${operation}`)(function* <HashError>(
    subjectInput: DirectActionExecutionSubjectCapabilityV1,
    effectOrdinal: bigint,
    context: ApplicationActionAuthorityContextV1<HashError>,
    terminalCode?: string,
  ): Effect.fn.Return<ExternalEffectAttemptProjectionV1, ApplicationActionAuthorityV1Error<HashError>> {
    const subject = yield* claimSubject(subjectInput, context.authority.scopeId);
    yield* requireOrdinal(effectOrdinal, operation);
    if ((next === "failed_before_dispatch" || next === "uncertain")) {
      yield* requireText(terminalCode, operation, "terminalCode");
    }
    return yield* runTransaction(context.target, operation, tx => Effect.gen(function* () {
      yield* requireCurrentAuthority(tx, context);
      const parent = yield* loadInvocationForUpdate(
        tx,
        subject.scopeId,
        subject.requestKey,
      );
      yield* requireSubjectMatchesRow(subject, parent);
      if (parent.lifecycle !== "executing") {
        return yield* lifecycleConflict(operation, "executing", parent.lifecycle);
      }
      const current = yield* loadEffectForUpdate(tx, subject, effectOrdinal);
      if (current.state !== expected) return yield* lifecycleConflict(operation, expected, current.state);
      const rows = yield* query(tx.update(fxSystemExternalEffectAttemptsV1).set({
        state: next,
        ...(next === "dispatching" ? { dispatchDeclaredAt: sql`current_timestamp` } : {}),
        ...(next === "failed_before_dispatch" || next === "uncertain"
          ? { settledAt: sql`current_timestamp`, terminalCode }
          : {}),
      }).where(effectWhere(subject, effectOrdinal, expected)).returning());
      if (rows[0] === undefined) return yield* lifecycleConflict(operation, expected, "concurrent_transition");
      yield* proofStep(context, "afterEffectTransitionUpdate");
      return yield* decodeEffectRow(rows[0]);
    }));
  });
}

type InvocationRow = typeof fxSystemApplicationActionInvocationsV1.$inferSelect;
type EffectRow = typeof fxSystemExternalEffectAttemptsV1.$inferSelect;

function loadInvocationForUpdate(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  requestKey: string,
): Effect.Effect<InvocationRow, ApplicationActionInvocationMissingV1Error | ApplicationActionAuthorityIntegrationV1Error> {
  return query(tx.select().from(fxSystemApplicationActionInvocationsV1).where(and(
    eq(fxSystemApplicationActionInvocationsV1.scopeId, scopeId),
    eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey),
  )).for("update").limit(1)).pipe(Effect.flatMap(rows =>
    rows[0] === undefined
      ? Effect.fail(new ApplicationActionInvocationMissingV1Error({ requestKey }))
      : Effect.succeed(rows[0])
  ));
}

function loadEffectForUpdate(
  tx: AppRowTransaction,
  subject: DirectActionSubjectStateV1,
  effectOrdinal: bigint,
): Effect.Effect<EffectRow, ApplicationActionAuthorityCorruptionV1Error | ApplicationActionAuthorityIntegrationV1Error> {
  return query(tx.select().from(fxSystemExternalEffectAttemptsV1)
    .where(effectWhere(subject, effectOrdinal)).for("update").limit(1)).pipe(
      Effect.flatMap(rows => rows[0] === undefined
        ? corruption("external effect attempt is missing")
        : Effect.succeed(rows[0])),
    );
}

function effectWhere(
  subject: DirectActionSubjectStateV1,
  effectOrdinal: bigint,
  state?: ExternalEffectAttemptStateV1,
) {
  return and(
    eq(fxSystemExternalEffectAttemptsV1.scopeId, subject.scopeId),
    eq(fxSystemExternalEffectAttemptsV1.subjectKind, "direct_action"),
    eq(fxSystemExternalEffectAttemptsV1.subjectIdentitySha256, subject.subjectIdentitySha256),
    eq(fxSystemExternalEffectAttemptsV1.subjectFence, subject.executionGeneration),
    eq(fxSystemExternalEffectAttemptsV1.effectOrdinal, effectOrdinal),
    ...(state === undefined ? [] : [eq(fxSystemExternalEffectAttemptsV1.state, state)]),
  );
}

function requireCurrentAuthority(
  tx: AppRowTransaction,
  context: ApplicationActionAuthorityContextV1<unknown>,
): Effect.Effect<void, ApplicationActionAuthorityStaleV1Error | ApplicationActionAuthorityCorruptionV1Error | ApplicationActionAuthorityIntegrationV1Error> {
  const authority = context.authority;
  if (!scopePhysicalLocatorsEqual(
    context.target.physicalLocator,
    authority.physicalLocator,
  )) {
    return Effect.fail(new ApplicationActionAuthorityStaleV1Error({
      reason: "physicalLocator",
    }));
  }
  return query(tx.select({
    epoch: fxSystemScopeClocks.epoch,
    storageGeneration: fxSystemScopeClocks.storageGeneration,
    storageGenerationFence: fxSystemScopeClocks.storageGenerationFence,
  }).from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, authority.scopeId)).for("update").limit(1)).pipe(
    Effect.flatMap(rows => {
      const row = rows[0];
      if (row === undefined || row.storageGeneration !== "flarexdb_v1") {
        return Effect.fail(new ApplicationActionAuthorityStaleV1Error({ reason: "scope" }));
      }
      if (row.epoch !== authority.epoch) return Effect.fail(new ApplicationActionAuthorityStaleV1Error({ reason: "epoch" }));
      if (row.storageGenerationFence !== authority.storageGenerationFence) {
        return Effect.fail(new ApplicationActionAuthorityStaleV1Error({ reason: "storageGenerationFence" }));
      }
      return Effect.void;
    }),
  );
}

function claimSubject(
  value: unknown,
  scopeId: ScopeId,
): Effect.Effect<DirectActionSubjectStateV1, InvalidDirectActionExecutionSubjectV1Error | ApplicationActionAuthorityStaleV1Error> {
  if (typeof value !== "object" || value === null) {
    return Effect.fail(new InvalidDirectActionExecutionSubjectV1Error({ reason: "notIssued" }));
  }
  const state = subjectStates.get(value as DirectActionExecutionSubjectCapabilityV1);
  if (state === undefined) return Effect.fail(new InvalidDirectActionExecutionSubjectV1Error({ reason: "revoked" }));
  return state.scopeId === scopeId
    ? Effect.succeed(state)
    : Effect.fail(new ApplicationActionAuthorityStaleV1Error({ reason: "scope" }));
}

function requireSubjectMatchesRow(
  subject: DirectActionSubjectStateV1,
  row: InvocationRow,
): Effect.Effect<void, ApplicationActionAuthorityCorruptionV1Error> {
  return row.invocationId === subject.invocationId &&
      row.executionGeneration === subject.executionGeneration &&
      bytesEqualFullScan(
        row.requestIdentitySha256,
        subject.requestIdentitySha256,
      )
    ? Effect.void
    : corruption("subject capability no longer matches its parent row");
}

function decodeInvocationRow(row: InvocationRow): Effect.Effect<ApplicationActionInvocationProjectionV1, ApplicationActionAuthorityCorruptionV1Error> {
  if (
    row.executionAuthorityGeneration !== "legacy_candidate_bound_v1" ||
    !isNonBlankString(row.applicationRevisionId) ||
    !isUint8ArrayWithByteLength(row.candidateSha256, 32) ||
    !isUint8ArrayWithByteLength(row.actionBindingSha256, 32) ||
    row.applicationExecutionAuthorityJson !== null ||
    row.applicationExecutionAuthorityCanonicalBytes !== null ||
    row.applicationExecutionAuthoritySha256 !== null
  ) return corruption("invocation row contains invalid legacy authority");
  const applicationRevisionId = row.applicationRevisionId;
  const candidateSha256 = copyBytes(row.candidateSha256);
  const actionBindingSha256 = copyBytes(row.actionBindingSha256);
  return decodeCommonInvocationRow(row).pipe(Effect.map(common => Object.freeze({
    ...common,
    applicationRevisionId,
    candidateSha256,
    actionBindingSha256,
  })));
}

function decodeApplicationInvocationRow(
  row: InvocationRow,
): Effect.Effect<
  ApplicationAuthorityActionInvocationProjection,
  ApplicationActionAuthorityCorruptionV1Error
> {
  if (
    row.executionAuthorityGeneration !== "application_v1" ||
    row.applicationRevisionId !== null || row.candidateSha256 !== null ||
    row.actionBindingSha256 !== null ||
    row.applicationExecutionAuthorityJson === null ||
    !isUint8Array(row.applicationExecutionAuthorityCanonicalBytes) ||
    row.applicationExecutionAuthorityCanonicalBytes.byteLength < 1 ||
    row.applicationExecutionAuthorityCanonicalBytes.byteLength > 131_072 ||
    !isUint8ArrayWithByteLength(
      row.applicationExecutionAuthoritySha256,
      32,
    )
  ) return corruption("invocation row contains invalid Application authority");
  const storedBytes = row.applicationExecutionAuthorityCanonicalBytes;
  const storedSha256 = row.applicationExecutionAuthoritySha256;
  return Effect.gen(function* () {
    const executionAuthority = yield*
      canonicalizeApplicationActionExecutionAuthorityV1(
        row.applicationExecutionAuthorityJson,
      ).pipe(Effect.mapError(() =>
        new ApplicationActionAuthorityCorruptionV1Error({
          detail: "invocation contains malformed Application authority",
        })
      ));
    if (
      !bytesEqualFullScan(storedBytes, executionAuthority.canonicalBytes) ||
      !bytesEqualFullScan(storedSha256, executionAuthority.sha256) ||
      row.scopeId !== executionAuthority.authority.runtimeTarget.scopeId ||
      row.actionFunctionPath !==
        executionAuthority.authority.runtimeTarget.function.path
    ) return yield* corruption("invocation Application authority is inconsistent");
    const common = yield* decodeCommonInvocationRow(row);
    return Object.freeze({
      ...common,
      executionAuthorityGeneration: "application_v1" as const,
      executionAuthority,
    });
  });
}

function decodeCommonInvocationRow(
  row: InvocationRow,
): Effect.Effect<
  Omit<
    ApplicationActionInvocationProjectionV1,
    "applicationRevisionId" | "candidateSha256" | "actionBindingSha256"
  >,
  ApplicationActionAuthorityCorruptionV1Error
> {
  const admittedAt = databaseDate(row.admittedAt);
  const updatedAt = databaseDate(row.updatedAt);
  const invocationTime = nullableDatabaseDate(row.invocationTime);
  const executionDeadline = nullableDatabaseDate(row.executionDeadline);
  const cancellationRequestedAt = nullableDatabaseDate(row.cancellationRequestedAt);
  const terminalAt = nullableDatabaseDate(row.terminalAt);
  if (admittedAt === undefined || updatedAt === undefined || invocationTime === undefined || executionDeadline === undefined || cancellationRequestedAt === undefined || terminalAt === undefined) {
    return corruption("invocation row contains an invalid timestamp");
  }
  if (
    !isUint8ArrayWithByteLength(row.requestIdentitySha256, 32) ||
    !isUint8ArrayWithByteLength(row.executionIdentitySha256, 32) ||
    !isUint8ArrayWithByteLength(row.hostPolicySha256, 32) ||
    (row.randomSeedSha256 !== null &&
      !isUint8ArrayWithByteLength(row.randomSeedSha256, 32)) ||
    (row.lifecycle === "executing" && row.randomSeedSha256 === null)
  ) return corruption("invocation row contains an invalid authority digest");
  const argumentsReference = Effect.fromResult(
    decodeExecutionEvidenceBodyReferenceV1({
      storeIdentity: row.argumentStoreIdentity,
      kind: "action_arguments",
      codecIdentity: row.argumentCodecIdentity,
      objectKey: row.argumentObjectKey,
      byteLength: row.argumentByteLength,
      sha256: row.argumentSha256,
    }),
  ).pipe(Effect.mapError(() =>
    new ApplicationActionAuthorityCorruptionV1Error({
      detail: "invocation contains an invalid argument reference",
    })
  ));
  const result: Effect.Effect<
    ExecutionEvidenceBodyReferenceV1 | null,
    ApplicationActionAuthorityCorruptionV1Error
  > = row.lifecycle === "completed"
    ? row.resultStoreIdentity === null || row.resultCodecIdentity === null ||
        row.resultObjectKey === null || row.resultByteLength === null ||
        row.resultSha256 === null
      ? corruption("completed invocation is missing its result reference")
      : Effect.fromResult(decodeExecutionEvidenceBodyReferenceV1({
          storeIdentity: row.resultStoreIdentity,
          kind: "action_result",
          codecIdentity: row.resultCodecIdentity,
          objectKey: row.resultObjectKey,
          byteLength: row.resultByteLength,
          sha256: row.resultSha256,
        })).pipe(Effect.mapError(() =>
          new ApplicationActionAuthorityCorruptionV1Error({
            detail: "completed invocation contains an invalid result reference",
          })
        ))
    : Effect.succeed(null);
  return Effect.gen(function* () {
    const argumentsValue = yield* argumentsReference;
    const resultValue = yield* result;
    return Object.freeze({
    scopeId: row.scopeId,
    requestKey: row.requestKey,
    invocationId: row.invocationId,
    requestIdentitySha256: copyBytes(row.requestIdentitySha256),
    actionFunctionPath: row.actionFunctionPath,
    executionIdentitySha256: copyBytes(row.executionIdentitySha256),
    compatibilityDate: row.compatibilityDate,
    hostPolicySha256: copyBytes(row.hostPolicySha256),
    arguments: argumentsValue,
    lifecycle: row.lifecycle,
    executionGeneration: row.executionGeneration,
    randomSeedSha256: row.randomSeedSha256 === null
      ? null
      : copyBytes(row.randomSeedSha256),
    invocationTime,
    executionDeadline,
    lastEffectOrdinal: row.lastEffectOrdinal,
    cancellationRequestedAt,
    result: resultValue,
    terminalCode: row.terminalCode,
    admittedAt,
    updatedAt,
    terminalAt,
    });
  });
}

function decodeEffectRow(row: EffectRow): Effect.Effect<ExternalEffectAttemptProjectionV1, ApplicationActionAuthorityCorruptionV1Error> {
  const preparedAt = databaseDate(row.preparedAt);
  const dispatchDeclaredAt = nullableDatabaseDate(row.dispatchDeclaredAt);
  const settledAt = nullableDatabaseDate(row.settledAt);
  if (preparedAt === undefined || dispatchDeclaredAt === undefined || settledAt === undefined) return corruption("effect row contains an invalid timestamp");
  return Effect.succeed(Object.freeze({
    scopeId: row.scopeId,
    subjectKind: row.subjectKind,
    subjectIdentitySha256: copyBytes(row.subjectIdentitySha256),
    subjectFence: row.subjectFence,
    effectOrdinal: row.effectOrdinal,
    effectKind: row.effectKind,
    stableEffectKey: row.stableEffectKey,
    requestIdentitySha256: copyBytes(row.requestIdentitySha256),
    state: row.state,
    preparedAt,
    dispatchDeclaredAt,
    settledAt,
    terminalCode: row.terminalCode,
  }));
}

function requireBodyReference(
  value: unknown,
  expectedKind: ExecutionEvidenceBodyReferenceV1["kind"],
  operation: string,
  field: string,
): Effect.Effect<
  ExecutionEvidenceBodyReferenceV1,
  ApplicationActionAuthorityInputV1Error
> {
  return Effect.fromResult(decodeExecutionEvidenceBodyReferenceV1(value)).pipe(
    Effect.mapError(() =>
      new ApplicationActionAuthorityInputV1Error({ operation, field })
    ),
    Effect.filterOrFail(
      reference => reference.kind === expectedKind,
      () => new ApplicationActionAuthorityInputV1Error({
        operation,
        field: `${field}.kind`,
      }),
    ),
  );
}

function databaseDate(value: unknown): Date | undefined {
  const date = copyFiniteDate(value);
  if (date !== undefined) return date;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function nullableDatabaseDate(value: unknown): Date | null | undefined {
  return value === null ? null : databaseDate(value);
}

function requireText(value: unknown, operation: string, field: string) {
  return boundedText(value) ? Effect.succeed(value) : inputError(operation, field);
}

function requireUuid(value: unknown, operation: string, field: string) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? Effect.succeed(value)
    : inputError(operation, field);
}

function requireDigest(value: unknown, operation: string, field: string) {
  return isDigest(value) ? Effect.succeed(copyBytes(value)) : inputError(operation, field);
}

function requireOrdinal(value: unknown, operation: string) {
  return typeof value === "bigint" && value >= 1n
    ? Effect.succeed(value)
    : inputError(operation, "effectOrdinal");
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && isNonBlankString(value) && !value.includes("\0") && UTF8.encode(value).byteLength <= MAX_TEXT_BYTES;
}

function isDigest(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, 32);
}

function inputError(operation: string, field: string) {
  return Effect.fail(new ApplicationActionAuthorityInputV1Error({ operation, field }));
}

function proofStep(
  context: ApplicationActionAuthorityContextV1<unknown>,
  step: ApplicationActionAuthorityTransactionStepV1,
): Effect.Effect<void> {
  return Effect.sync(() => context.proofAfterTransactionStep?.(step));
}

function lifecycleConflict(operation: string, expected: string, actual: string) {
  return Effect.fail(new ApplicationActionLifecycleConflictV1Error({ operation, expected, actual }));
}

function corruption(detail: string) {
  return Effect.fail(new ApplicationActionAuthorityCorruptionV1Error({ detail }));
}

function query<Row>(queryValue: PromiseLike<ReadonlyArray<Row>>): Effect.Effect<ReadonlyArray<Row>, ApplicationActionAuthorityIntegrationV1Error> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => queryValue,
    catch: cause => new ApplicationActionAuthorityIntegrationV1Error({ operation: "query", cause }),
  }));
}

interface StartedTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

function runTransaction<Value, Failure>(
  target: LocatedApplicationActionAuthorityTargetV1,
  operation: string,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.Effect<Value, Failure | ApplicationActionAuthorityIntegrationV1Error> {
  return Effect.uninterruptibleMask(() => Effect.gen(function* () {
    const started = startLocatedEffectTransaction(target, work);
    const settled = yield* Effect.tryPromise({
      try: () => started.promise,
      catch: cause => cause,
    }).pipe(Effect.exit);
    if (Exit.isSuccess(settled)) return settled.value;
    const error = Cause.findErrorOption(settled.cause);
    if (error._tag === "None") {
      return yield* Effect.failCause(Cause.map(
        settled.cause,
        cause => new ApplicationActionAuthorityIntegrationV1Error({
          operation,
          cause,
        }),
      ));
    }
    const cause = error.value;
    const callbackCause = started.callbackCause();
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === started.rollbackSignal &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(callbackCause);
    }
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(new ApplicationActionAuthorityIntegrationV1Error({
          operation,
          cause,
        })),
      ));
    }
    return yield* new ApplicationActionAuthorityIntegrationV1Error({ operation, cause });
  }));
}

/** The single audited Effect runtime bridge for the Drizzle callback owner. */
function startLocatedEffectTransaction<Value, Failure>(
  target: LocatedApplicationActionAuthorityTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedTransaction<Value, Failure> {
  let callbackCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error("AAV-A1 transaction rolled back.");
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      callbackCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => callbackCause,
  });
}
