import { Data, Effect, Result } from "effect";

import {
  decodeCommitEnvelopeV1Effect,
  requireStoredForSessionAttemptCommitEnvelopeV1Effect,
  type CommitProtocolV1Error,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import type { TransactionSessionLifecycleV1 } from
  "flarex-protocol/transaction-session";

import {
  inspectLoadedPointMutationSessionAttemptV1,
} from "../pointMutationSessionActivation";
import type {
  PointMutationExecutionClaimVaultV1,
  PointMutationExecutionScopeV1,
} from "../pointMutationExecutionClaim";
import type {
  AuthenticatedStoredAttemptStateV1,
  StoredAttemptAuthorityStateV1,
  StoredAttemptAuthenticationV1,
  StoredAttemptEvidenceAuthorityPortV1,
  StoredAttemptEvidenceLoaderPortV1,
  StoredAttemptEvidenceLoadResultPortV1,
  StoredAttemptEvidencePortV1,
  StoredAttemptStorageCorruptionReasonV1,
} from "../storedAttemptAuthentication";

const trustedStoredAttemptAuthorityBrand: unique symbol = Symbol(
  "FlarexExecutor/TrustedStoredAttemptAuthorityV1",
);

export interface TrustedStoredAttemptAuthorityV1 {
  readonly [trustedStoredAttemptAuthorityBrand]: true;
}

const authenticatedStoredAttemptBrand: unique symbol = Symbol(
  "FlarexExecutor/AuthenticatedStoredAttemptV1",
);

const PROCESS_LOCAL_CAPABILITY: true = true;

export interface AuthenticatedStoredAttemptV1 {
  readonly [authenticatedStoredAttemptBrand]: true;
}

export class InvalidStoredAttemptAuthorityV1Error extends Data.TaggedError(
  "InvalidStoredAttemptAuthorityV1Error",
)<{
  readonly reason:
    | "notProcessLocal"
    | "invalidLoadedAttempt"
    | "invalidExecutionClaim";
}> {}

export class StoredAttemptAlreadyCommittedV1Error extends Data.TaggedError(
  "StoredAttemptAlreadyCommittedV1Error",
)<{
  readonly updatedAtMilliseconds: number;
}> {}

export class StoredAttemptNotPlannableV1Error extends Data.TaggedError(
  "StoredAttemptNotPlannableV1Error",
)<{
  readonly reason: "lifecycle" | "rootNotSealed" | "expired";
  readonly lifecycle?: TransactionSessionLifecycleV1;
  readonly rootState?: "open" | "sealed" | "failed";
}> {}

export class StoredAttemptAuthorityMismatchV1Error extends Data.TaggedError(
  "StoredAttemptAuthorityMismatchV1Error",
)<{
  readonly reason:
    | "placementChanged"
    | "scopeChanged"
    | "attemptMissing"
    | "attemptReplaced"
    | "generationChanged"
    | "epochChanged"
    | "snapshotChanged"
    | "schemaChanged"
    | "revocationEpochChanged"
    | "executionClaimChanged";
}> {}

export class StoredAttemptEnvelopeMismatchV1Error extends Data.TaggedError(
  "StoredAttemptEnvelopeMismatchV1Error",
)<{
  readonly reason:
    | "attempt"
    | "protocol"
    | "sequence"
    | "journalDigest"
    | "successfulResult";
}> {}

export class StoredAttemptStorageCorruptionV1Error extends Data.TaggedError(
  "StoredAttemptStorageCorruptionV1Error",
)<{
  readonly reason: StoredAttemptStorageCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class StoredAttemptPersistenceV1Error extends Data.TaggedError(
  "StoredAttemptPersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export type StoredAttemptAuthenticationV1Error =
  | CommitProtocolV1Error
  | InvalidStoredAttemptAuthorityV1Error
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptEnvelopeMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
  | StoredAttemptPersistenceV1Error;

type StoredAttemptAuthorityCapabilityStateV1 = Readonly<{
  readonly authority: StoredAttemptAuthorityStateV1;
  readonly executionScope: PointMutationExecutionScopeV1;
}>;

export interface StoredAttemptAuthenticationOperationDependenciesV1 {
  readonly loader: StoredAttemptEvidenceLoaderPortV1;
  readonly executionClaims: PointMutationExecutionClaimVaultV1;
  readonly authorityStates: WeakMap<
    object,
    StoredAttemptAuthorityCapabilityStateV1
  >;
  readonly authenticatedStates: WeakMap<
    object,
    AuthenticatedStoredAttemptStateV1
  >;
  readonly captureAuthorityPort: (
    authority: StoredAttemptAuthorityStateV1,
  ) => StoredAttemptEvidenceAuthorityPortV1;
  readonly verifyCanonicalStoredEvidence: (
    authority: StoredAttemptAuthorityStateV1,
    evidence: StoredAttemptEvidencePortV1,
    executionScope?: PointMutationExecutionScopeV1,
  ) => Effect.Effect<
    AuthenticatedStoredAttemptStateV1,
    | StoredAttemptAuthorityMismatchV1Error
    | StoredAttemptStorageCorruptionV1Error
  >;
  readonly compareCallerEnvelopeWithVerifiedState: (
    envelope: StoredForSessionAttemptCommitEnvelopeV1,
    evidence: StoredAttemptEvidencePortV1,
    verified: AuthenticatedStoredAttemptStateV1,
  ) => Effect.Effect<
    StoredAttemptEnvelopeMismatchV1Error | undefined,
    StoredAttemptStorageCorruptionV1Error
  >;
  readonly serializeAuthenticatedStateForTest: (
    state: AuthenticatedStoredAttemptStateV1,
  ) => string;
}

export interface StoredAttemptAuthenticationOperationsV1 {
  readonly facade: StoredAttemptAuthenticationV1;
  readonly mintAuthenticatedStoredAttempt: (
    state: AuthenticatedStoredAttemptStateV1,
  ) => AuthenticatedStoredAttemptV1;
  readonly lookupAuthority: (
    authority: TrustedStoredAttemptAuthorityV1,
  ) => StoredAttemptAuthorityCapabilityStateV1 | undefined;
  readonly loadAndVerifyStoredEvidence: (
    authorityCapability: StoredAttemptAuthorityCapabilityStateV1,
  ) => Effect.Effect<
    Readonly<{
      readonly evidence: StoredAttemptEvidencePortV1;
      readonly verified: AuthenticatedStoredAttemptStateV1;
    }>,
    | StoredAttemptAlreadyCommittedV1Error
    | StoredAttemptNotPlannableV1Error
    | StoredAttemptAuthorityMismatchV1Error
    | StoredAttemptStorageCorruptionV1Error
    | StoredAttemptPersistenceV1Error
  >;
}

export const requireLoadedStoredAttemptEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.requireLoadedEvidence",
)(function* (
  result: StoredAttemptEvidenceLoadResultPortV1,
): Effect.fn.Return<
  StoredAttemptEvidencePortV1,
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
> {
  switch (result.kind) {
    case "loaded":
      return result.evidence;
    case "alreadyCommitted":
      return yield* Effect.fail(new StoredAttemptAlreadyCommittedV1Error({
        updatedAtMilliseconds: result.updatedAtMilliseconds,
      }));
    case "notPlannable":
      return yield* Effect.fail(new StoredAttemptNotPlannableV1Error({
        reason: result.reason,
        ...(result.lifecycle === undefined
          ? {}
          : { lifecycle: result.lifecycle }),
        ...(result.rootState === undefined
          ? {}
          : { rootState: result.rootState }),
      }));
    case "authorityMismatch":
      return yield* Effect.fail(new StoredAttemptAuthorityMismatchV1Error({
        reason: result.reason,
      }));
    case "corrupt":
      return yield* Effect.fail(new StoredAttemptStorageCorruptionV1Error({
        reason: result.reason,
        ...(result.cause === undefined ? {} : { cause: result.cause }),
      }));
  }
});

export function makeStoredAttemptAuthenticationOperationsV1(
  dependencies: StoredAttemptAuthenticationOperationDependenciesV1,
): StoredAttemptAuthenticationOperationsV1 {
  const {
    loader,
    executionClaims,
    authorityStates,
    authenticatedStates,
    captureAuthorityPort,
    verifyCanonicalStoredEvidence,
    compareCallerEnvelopeWithVerifiedState,
    serializeAuthenticatedStateForTest,
  } = dependencies;

  const mintAuthenticatedStoredAttempt = (
    state: AuthenticatedStoredAttemptStateV1,
  ): AuthenticatedStoredAttemptV1 => {
    const handle: AuthenticatedStoredAttemptV1 = Object.freeze({
      [authenticatedStoredAttemptBrand]: PROCESS_LOCAL_CAPABILITY,
    });
    authenticatedStates.set(handle, state);
    return handle;
  };

  const lookupAuthority = (
    authority: TrustedStoredAttemptAuthorityV1,
  ): StoredAttemptAuthorityCapabilityStateV1 | undefined =>
    typeof authority === "object" && authority !== null
      ? authorityStates.get(authority)
      : undefined;

  const deriveAuthority: StoredAttemptAuthenticationV1["deriveAuthority"] =
    Effect.fn("StoredAttemptAuthentication.deriveAuthority")(
      function* (attempt, executionClaim) {
        const inspection = yield* Effect.try({
          try: () => inspectLoadedPointMutationSessionAttemptV1(attempt),
          catch: () => new InvalidStoredAttemptAuthorityV1Error({
            reason: "invalidLoadedAttempt",
          }),
        });
        const claim = yield* Effect.fromResult(
          executionClaims.admission.inspectStoredAttempt(executionClaim).pipe(
            Result.mapError(() => new InvalidStoredAttemptAuthorityV1Error({
              reason: "invalidExecutionClaim",
            })),
          ),
        );
        if (
          claim.selector.deploymentId !== inspection.selector.deploymentId ||
          claim.selector.scopeId !== inspection.selector.scopeId ||
          claim.selector.sessionId !== inspection.selector.sessionId ||
          claim.selector.attemptFence !== inspection.selector.attemptFence
        ) {
          return yield* Effect.fail(
            new InvalidStoredAttemptAuthorityV1Error({
              reason: "invalidExecutionClaim",
            }),
          );
        }
        const state = Object.freeze({
          deploymentId: inspection.selector.deploymentId,
          scopeId: inspection.selector.scopeId,
          sessionId: inspection.selector.sessionId,
          attemptFence: inspection.selector.attemptFence,
          storageGeneration: inspection.storageGeneration,
          storageGenerationFence: inspection.storageGenerationFence,
          snapshotToken: Object.freeze({ ...inspection.snapshotToken }),
          schemaVersionId: inspection.schemaVersionId,
          executionClaim: Object.freeze({
            claimOwner: claim.observation.claimOwner,
            claimFence: claim.observation.claimFence,
          }),
        } satisfies StoredAttemptAuthorityStateV1);
        const handle: TrustedStoredAttemptAuthorityV1 = Object.freeze({
          [trustedStoredAttemptAuthorityBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        authorityStates.set(handle, Object.freeze({
          authority: state,
          executionScope: executionClaim,
        }));
        return handle;
      },
    );

  const loadAndVerifyStoredEvidence = Effect.fn(
    "StoredAttemptAuthentication.loadAndVerifyStoredEvidence",
  )(function* (authorityCapability: StoredAttemptAuthorityCapabilityStateV1) {
    const result = yield* loader.loadEffect(
      captureAuthorityPort(authorityCapability.authority),
    ).pipe(Effect.mapError((error) =>
      new StoredAttemptPersistenceV1Error({ cause: error.cause })
    ));
    const evidence = yield* requireLoadedStoredAttemptEvidenceEffect(result);
    const verified = yield* verifyCanonicalStoredEvidence(
      authorityCapability.authority,
      evidence,
      authorityCapability.executionScope,
    );
    return Object.freeze({ evidence, verified });
  });

  const authenticate: StoredAttemptAuthenticationV1["authenticate"] =
    Effect.fn("StoredAttemptAuthentication.authenticate")(
      function* (authority, input) {
        const decodedEnvelope = yield* decodeCommitEnvelopeV1Effect(input);
        const envelope = yield*
          requireStoredForSessionAttemptCommitEnvelopeV1Effect(
            decodedEnvelope,
          );
        const authorityCapability = lookupAuthority(authority);
        if (authorityCapability === undefined) {
          return yield* Effect.fail(
            new InvalidStoredAttemptAuthorityV1Error({
              reason: "notProcessLocal",
            }),
          );
        }
        const { evidence, verified } = yield* loadAndVerifyStoredEvidence(
          authorityCapability,
        );
        const envelopeMismatch = yield*
          compareCallerEnvelopeWithVerifiedState(
            envelope,
            evidence,
            verified,
          );
        if (envelopeMismatch !== undefined) {
          return yield* Effect.fail(envelopeMismatch);
        }
        return mintAuthenticatedStoredAttempt(verified);
      },
    );

  const facade: StoredAttemptAuthenticationV1 = Object.freeze({
    deriveAuthority,
    authenticate,
    isAuthenticated: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      authenticatedStates.has(value),
    remainsAuthenticatedStateUnchangedForTest: (
      value: AuthenticatedStoredAttemptV1,
      action: () => void,
    ): boolean => {
      const state = requireAuthenticatedState(authenticatedStates, value);
      const before = serializeAuthenticatedStateForTest(state);
      action();
      return before === serializeAuthenticatedStateForTest(state);
    },
  });

  return Object.freeze({
    facade,
    mintAuthenticatedStoredAttempt,
    lookupAuthority,
    loadAndVerifyStoredEvidence,
  });
}

function requireAuthenticatedState(
  states: WeakMap<object, AuthenticatedStoredAttemptStateV1>,
  value: AuthenticatedStoredAttemptV1,
): AuthenticatedStoredAttemptStateV1 {
  const state = typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
  if (state === undefined) {
    throw new InvalidStoredAttemptAuthorityV1Error({
      reason: "notProcessLocal",
    });
  }
  return state;
}
