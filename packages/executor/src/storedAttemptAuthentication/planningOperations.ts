import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";

import {
  loadPointCommitUniqueConstraintEligibilityV1Effect,
  type AppUniqueConstraintSetEligibilityResultV1,
  type LoadPointCommitUniqueConstraintEligibilityV1Error,
} from "@flarex/persistence-postgres/point-commit-transaction";

import type { PointMutationTargetFunctionMetadataV1 } from
  "flarex-protocol/point-mutation-start";

import type { PointMutationExecutionScopeV1 } from
  "../pointMutationExecutionClaim";
import type {
  AuthenticatedCommitAuthorityStateV1,
  AuthenticatedStoredAttemptStateV1,
  StoredAttemptAuthenticationV1,
  StoredAttemptSessionScalarsPortV1,
  StoredPointCommitPlanningV1,
} from "../storedAttemptAuthentication";
import type { TransactionGrantVerificationKernelV1 } from
  "../transactionGrantVerificationKernel";
import type { ApplicationMutationGrantVerificationKernelV1 } from
  "../applicationMutationGrantVerificationKernel";
import {
  InvalidAuthenticatedStoredAttemptV1Error,
  StoredCommitAuthorityCorruptionV1Error,
  StoredCommitAuthorityPersistenceV1Error,
  type StoredCommitAuthorityAuthenticationConfigV1,
  type StoredCommitAuthorityEvidenceAuthorityPortV1,
} from "./commitAuthorityModel";
import {
  capturePinnedFunctionSelector,
  isLegacyCommitAuthorityVerificationStateV1,
  requireLoadedCommitAuthorityEvidenceEffect,
  verifyCommitAuthorityEvidenceEffect,
  verifyPinnedFunctionMetadataEffect,
  type VerifiedCommitAuthorityEvidenceV1,
} from "./commitAuthorityVerification";
import {
  CommitInputAuthorityCorruptionV1Error,
  InvalidAuthenticatedCommitAuthorityV1Error,
  verifyCommitInputStateEffect,
  type VerifiedCommitInputStateV1,
} from "./commitInputVerification";
import type {
  PointCommitScalarProvenanceV1,
  PreparedPointCommitCapabilityStateV1,
  StoredPointMutationCapabilityVaultV1,
  VerifiedCommitCapabilityStateV1,
} from "./capabilityState";
import {
  serializePrivateCapabilityStateForTestV1,
} from "./capabilityState";
import {
  InvalidVerifiedCommitInputV1Error,
  PointCommitUniqueConstraintEligibilityV1Error,
  planPointCommitStateV1,
  type PointCommitPlannerCapabilitiesV1,
  type PreparedPointCommitStateV1,
} from "./pointCommitPlanning";
import type { AuthenticatedStoredAttemptV1 } from
  "./authenticationOperations";
import { captureAuthorityPort } from "./authenticationVerification";
import { detachVerifiedGrant } from "./verifiedGrantEvidence";

const authenticatedCommitAuthorityBrand: unique symbol = Symbol(
  "FlarexExecutor/AuthenticatedCommitAuthorityV1",
);

/** Private C04B1 authority only; this is not VerifiedCommitInput. */
export interface AuthenticatedCommitAuthorityV1 {
  readonly [authenticatedCommitAuthorityBrand]: true;
}

const verifiedCommitInputBrand: unique symbol = Symbol(
  "FlarexExecutor/VerifiedCommitInputV1",
);

/** Private C04B2 proof capability; production activation remains deferred. */
export interface VerifiedCommitInputV1 {
  readonly [verifiedCommitInputBrand]: true;
}

const preparedPointCommitBrand: unique symbol = Symbol(
  "FlarexExecutor/PreparedPointCommitV1",
);

export class InvalidPreparedPointCommitV1Error extends Data.TaggedError(
  "InvalidPreparedPointCommitV1Error",
)<{
  readonly reason:
    | "alreadyFinishing"
    | "notFinishing"
    | "notRunning"
    | "executionClaimUnavailable"
    | "notSameFactory";
}> {}

/** Private C04C1 logical point plan; this carries no SQL authority. */
export interface PreparedPointCommitV1 {
  readonly [preparedPointCommitBrand]: true;
}

const finishingPreparedPointCommitBrand: unique symbol = Symbol(
  "FlarexExecutor/FinishingPreparedPointCommitV1",
);

/** Private C05 continuation; C05-A/C05-B feed only the O07-B publisher. */
export interface FinishingPreparedPointCommitV1
  extends PreparedPointCommitV1 {
  readonly [finishingPreparedPointCommitBrand]: true;
}

const PROCESS_LOCAL_CAPABILITY: true = true;

export interface StoredPointCommitPlanningOperationDependenciesV1 {
  readonly base: StoredAttemptAuthenticationV1;
  readonly configuration: StoredCommitAuthorityAuthenticationConfigV1;
  readonly grantKernel: TransactionGrantVerificationKernelV1;
  readonly applicationGrantKernel?:
    ApplicationMutationGrantVerificationKernelV1 | undefined;
  readonly developerIndexMaintenance: boolean;
  readonly uniqueConstraintMaintenance: boolean;
  readonly uniqueConstraintEligibility: boolean;
  readonly pointCommitCandidate: unknown;
  readonly authenticatedStates: StoredPointMutationCapabilityVaultV1[
    "authenticatedStates"
  ];
  readonly commitAuthorityStates: StoredPointMutationCapabilityVaultV1[
    "commitAuthorityStates"
  ];
  readonly verifiedCommitInputStates: StoredPointMutationCapabilityVaultV1[
    "verifiedCommitInputStates"
  ];
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
}

export function makeStoredPointCommitPlanningOperationsV1(
  dependencies: StoredPointCommitPlanningOperationDependenciesV1,
): StoredPointCommitPlanningV1 {
  const {
    base,
    configuration,
    grantKernel,
    applicationGrantKernel,
    developerIndexMaintenance,
    uniqueConstraintMaintenance,
    uniqueConstraintEligibility,
    pointCommitCandidate,
    authenticatedStates,
    commitAuthorityStates,
    verifiedCommitInputStates,
    preparedPointCommitStates,
  } = dependencies;

  const authenticateCommitAuthority = Effect.fn(
    "StoredAttemptAuthentication.authenticateCommitAuthority",
  )(function* (attempt: AuthenticatedStoredAttemptV1) {
    const storedAttempt = lookupSameFactoryAuthenticatedState(
      authenticatedStates,
      attempt,
    );
    if (storedAttempt === undefined) {
      return yield* Effect.fail(
        new InvalidAuthenticatedStoredAttemptV1Error({
          reason: "notSameFactory",
        }),
      );
    }
    const loadResult = yield* configuration.evidenceLoader.loadEffect(
        captureCommitAuthorityPort(storedAttempt),
      ).pipe(Effect.mapError((error) =>
        new StoredCommitAuthorityPersistenceV1Error({ cause: error.cause })
      ));
    const evidence = yield* requireLoadedCommitAuthorityEvidenceEffect(
      loadResult,
    );
    const verifiedEvidence = yield* verifyCommitAuthorityEvidenceEffect(
      storedAttempt,
      evidence,
      grantKernel,
      applicationGrantKernel,
    );
    let functionMetadata: PointMutationTargetFunctionMetadataV1 | undefined;
    if (verifiedEvidence.executionAuthorityGeneration ===
      "legacy_dynamic_worker_v1") {
      if (!isLegacyCommitAuthorityVerificationStateV1(storedAttempt)) {
        return yield* Effect.fail(new StoredCommitAuthorityCorruptionV1Error({
          reason: "sessionEvidenceInvalid",
        }));
      }
      const metadataUnknown = yield* configuration.functionMetadata.load(
        capturePinnedFunctionSelector(storedAttempt),
      );
      functionMetadata = yield* verifyPinnedFunctionMetadataEffect(
        storedAttempt,
        metadataUnknown,
      );
    }
    const state = deepDetachCommitAuthorityState(
      storedAttempt,
      verifiedEvidence,
      functionMetadata,
    );
    const handle: AuthenticatedCommitAuthorityV1 = Object.freeze({
      [authenticatedCommitAuthorityBrand]: PROCESS_LOCAL_CAPABILITY,
    });
    commitAuthorityStates.set(handle, state);
    return handle;
  });

  const verifyCommitInput: StoredPointCommitPlanningV1["verifyCommitInput"] =
    Effect.fn("StoredAttemptAuthentication.verifyCommitInput")(
      function* (authority) {
        const state = lookupCommitAuthorityState(
          commitAuthorityStates,
          authority,
        );
        if (state === undefined) {
          return yield* Effect.fail(
            new InvalidAuthenticatedCommitAuthorityV1Error({
              reason: "notSameFactory",
            }),
          );
        }
        const verified = yield* verifyCommitInputStateEffect({
          authority: state.storedAttempt.authority,
          session: state.storedAttempt.session,
          sealIdentity: state.storedAttempt.sealIdentity,
          journal: state.storedAttempt.journal,
          points: state.storedAttempt.points,
          successfulResult: state.storedAttempt.successfulResult,
          schemaManifest: state.schemaManifest,
          functionValidationAuthority: state.functionValidationAuthority,
        });
        const handle: VerifiedCommitInputV1 = Object.freeze({
          [verifiedCommitInputBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        verifiedCommitInputStates.set(handle, Object.freeze({
          input: verified,
          provenance: capturePointCommitScalarProvenance(
            state.storedAttempt,
          ),
          executionAuthority: state,
        } satisfies VerifiedCommitCapabilityStateV1));
        return handle;
      },
    );

  const planPointCommit: StoredPointCommitPlanningV1["planPointCommit"] =
    Effect.fn("StoredAttemptAuthentication.planPointCommit")(
      function* (input) {
        const state = lookupVerifiedCommitInputState(
          verifiedCommitInputStates,
          input,
        );
        if (state === undefined) {
          return yield* Effect.fail(new InvalidVerifiedCommitInputV1Error({
            reason: "notSameFactory",
          }));
        }
        const baseCapabilities: PointCommitPlannerCapabilitiesV1 = Object.freeze({
          ...(developerIndexMaintenance
            ? { developerIndexMaintenance: "c08-a-v1" as const }
            : {}),
        });
        let planned: PreparedPointCommitStateV1;
        if (!uniqueConstraintMaintenance) {
          planned = yield* Effect.fromResult(
            planPointCommitStateV1(state.input, baseCapabilities),
          );
        } else {
          const eligibilityIndependentPlan = yield* Effect.fromResult(
            planPointCommitStateV1(state.input, Object.freeze({
              ...baseCapabilities,
              uniqueConstraints: Object.freeze({
                status: "eligible" as const,
                tableIds: [] as const,
              }),
            })),
          );
          if (eligibilityIndependentPlan.rowIntents.length === 0) {
            planned = eligibilityIndependentPlan;
          } else {
            const uniqueConstraints = !uniqueConstraintEligibility
              ? Object.freeze({ status: "unavailable" as const })
              : yield* loadPointCommitUniqueConstraintEligibilityV1Effect(
                pointCommitCandidate,
                Object.freeze({
                  deploymentId: state.input.authorityPins.deploymentId,
                  scopeId: state.input.authorityPins.scopeId,
                  schemaVersionId: state.input.authorityPins.schemaVersionId,
                }),
              ).pipe(
                Effect.map(mapUniqueConstraintEligibilityForPlanning),
                Effect.mapError(mapUniqueConstraintEligibilityFailure),
              );
            planned = yield* Effect.fromResult(
              planPointCommitStateV1(state.input, Object.freeze({
                ...baseCapabilities,
                uniqueConstraints,
              })),
            );
          }
        }
        const handle = makePreparedPointCommitHandleV1();
        preparedPointCommitStates.set(handle, Object.freeze({
          plan: planned,
          provenance: state.provenance,
          executionAuthority: state.executionAuthority,
        } satisfies PreparedPointCommitCapabilityStateV1));
        return handle;
      },
    );

  return Object.freeze({
    ...base,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    isCommitAuthorityAuthenticated: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      commitAuthorityStates.has(value),
    remainsCommitAuthorityStateUnchangedForTest: (
      value: AuthenticatedCommitAuthorityV1,
      action: () => void,
    ): boolean => {
      const state = requireCommitAuthorityState(
        commitAuthorityStates,
        value,
      );
      const before = serializeCommitAuthorityStateForTest(state);
      action();
      return before === serializeCommitAuthorityStateForTest(state);
    },
    isCommitInputVerified: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      verifiedCommitInputStates.has(value),
    remainsVerifiedCommitInputStateUnchangedForTest: (
      value: VerifiedCommitInputV1,
      action: () => void,
    ): boolean => {
      const state = requireVerifiedCommitInputState(
        verifiedCommitInputStates,
        value,
      );
      const before = serializeVerifiedCommitInputStateForTest(state.input);
      action();
      return before === serializeVerifiedCommitInputStateForTest(state.input);
    },
    isPointCommitPrepared: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      preparedPointCommitStates.has(value),
    arePreparedPointCommitStatesEquivalentForTest: (
      left: PreparedPointCommitV1,
      right: PreparedPointCommitV1,
    ): boolean => {
      const leftState = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        left,
      );
      const rightState = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        right,
      );
      return leftState !== undefined &&
        rightState !== undefined &&
        serializePreparedPointCommitStateForTest(leftState.plan) ===
          serializePreparedPointCommitStateForTest(rightState.plan);
    },
  } satisfies StoredPointCommitPlanningV1);
}

function mapUniqueConstraintEligibilityForPlanning(
  result: AppUniqueConstraintSetEligibilityResultV1,
): NonNullable<PointCommitPlannerCapabilitiesV1["uniqueConstraints"]> {
  switch (result.status) {
    case "not_required":
      return Object.freeze({ status: "not_required" });
    case "not_ready":
      return Object.freeze({
        status: "not_ready",
        reason: result.reason,
        blocksAllTables: result.blocksAllTables,
        tableIds: Object.freeze([...result.tableIds]),
      });
    case "eligible":
      return Object.freeze({
        status: "eligible",
        tableIds: Object.freeze([...result.evidence.tableIds]),
      });
  }
}

function mapUniqueConstraintEligibilityFailure(
  cause: LoadPointCommitUniqueConstraintEligibilityV1Error,
): PointCommitUniqueConstraintEligibilityV1Error {
  const retryable = "retryable" in cause
    ? cause.retryable === true
    : cause._tag === "AppUniqueConstraintSetClosurePersistenceV1Error" ||
      cause._tag === "AppUniqueConstraintCatalogPersistenceError" ||
      cause._tag === "TrustedScopeAuthorityPortError" ||
      cause._tag === "ScopeAuthorizationRevocationEpochPersistenceError";
  return new PointCommitUniqueConstraintEligibilityV1Error({
    retryable,
    cause,
  });
}

export function makeFinishingPreparedPointCommitHandleV1():
  FinishingPreparedPointCommitV1 {
  return Object.freeze({
    [preparedPointCommitBrand]: PROCESS_LOCAL_CAPABILITY,
    [finishingPreparedPointCommitBrand]: PROCESS_LOCAL_CAPABILITY,
  });
}

function makePreparedPointCommitHandleV1(): PreparedPointCommitV1 {
  return Object.freeze({
    [preparedPointCommitBrand]: PROCESS_LOCAL_CAPABILITY,
  });
}

function lookupSameFactoryAuthenticatedState(
  states: WeakMap<object, AuthenticatedStoredAttemptStateV1>,
  value: AuthenticatedStoredAttemptV1,
): AuthenticatedStoredAttemptStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function requireCommitAuthorityState(
  states: WeakMap<object, AuthenticatedCommitAuthorityStateV1>,
  value: AuthenticatedCommitAuthorityV1,
): AuthenticatedCommitAuthorityStateV1 {
  const state = lookupCommitAuthorityState(states, value);
  if (state === undefined) {
    throw new InvalidAuthenticatedStoredAttemptV1Error({
      reason: "notSameFactory",
    });
  }
  return state;
}

function lookupCommitAuthorityState(
  states: WeakMap<object, AuthenticatedCommitAuthorityStateV1>,
  value: AuthenticatedCommitAuthorityV1,
): AuthenticatedCommitAuthorityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function requireVerifiedCommitInputState(
  states: WeakMap<object, VerifiedCommitCapabilityStateV1>,
  value: VerifiedCommitInputV1,
): VerifiedCommitCapabilityStateV1 {
  const state = lookupVerifiedCommitInputState(states, value);
  if (state === undefined) {
    throw new InvalidAuthenticatedCommitAuthorityV1Error({
      reason: "notSameFactory",
    });
  }
  return state;
}

function lookupVerifiedCommitInputState(
  states: WeakMap<object, VerifiedCommitCapabilityStateV1>,
  value: VerifiedCommitInputV1,
): VerifiedCommitCapabilityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function lookupPreparedPointCommitState(
  states: WeakMap<object, PreparedPointCommitCapabilityStateV1>,
  value: PreparedPointCommitV1,
): PreparedPointCommitCapabilityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function captureCommitAuthorityPort(
  state: AuthenticatedStoredAttemptStateV1,
): StoredCommitAuthorityEvidenceAuthorityPortV1 {
  return Object.freeze({
    ...state.authority,
    snapshotToken: Object.freeze({ ...state.authority.snapshotToken }),
    session: Object.freeze(structuredClone(state.session)),
    sealIdentity: Object.freeze(structuredClone(state.sealIdentity)),
  });
}

function deepDetachCommitAuthorityState(
  storedAttempt: AuthenticatedStoredAttemptStateV1,
  evidence: VerifiedCommitAuthorityEvidenceV1,
  functionMetadata: PointMutationTargetFunctionMetadataV1 | undefined,
): AuthenticatedCommitAuthorityStateV1 {
  if (evidence.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
    if (functionMetadata === undefined) {
      throw new StoredCommitAuthorityCorruptionV1Error({
        reason: "sessionEvidenceInvalid",
      });
    }
    return Object.freeze({
      storedAttempt,
      executionAuthorityGeneration: "legacy_dynamic_worker_v1",
      databaseNowMilliseconds: evidence.databaseNowMilliseconds,
      argumentsJson: Object.freeze(structuredClone(evidence.argumentsJson)),
      argumentArraySemanticBytes: evidence.argumentArraySemanticBytes,
      verifiedGrant: detachVerifiedGrant(evidence.verifiedGrant),
      schemaManifest: Object.freeze(structuredClone(evidence.schemaManifest)),
      stableBindings: Object.freeze(structuredClone(evidence.stableBindings)),
      functionMetadata: Object.freeze(structuredClone(functionMetadata)),
      functionValidationAuthority: Object.freeze({
        path: functionMetadata.path,
        returnsValidator: structuredClone(functionMetadata.returnsValidator),
      }),
    });
  }
  if (functionMetadata !== undefined) {
    throw new StoredCommitAuthorityCorruptionV1Error({
      reason: "sessionEvidenceInvalid",
    });
  }
  return Object.freeze({
    storedAttempt,
    executionAuthorityGeneration: "application_v1",
    databaseNowMilliseconds: evidence.databaseNowMilliseconds,
    argumentsJson: Object.freeze(structuredClone(evidence.argumentsJson)),
    argumentArraySemanticBytes: evidence.argumentArraySemanticBytes,
    verifiedGrant: evidence.verifiedGrant,
    schemaManifest: Object.freeze(structuredClone(evidence.schemaManifest)),
    stableBindings: Object.freeze(structuredClone(evidence.stableBindings)),
    application: Object.freeze(structuredClone(evidence.application)),
    functionValidationAuthority: Object.freeze({
      path: evidence.application.runtimeTarget.function.path,
      returnsValidator: structuredClone(
        evidence.application.runtimeTarget.function.returns,
      ),
    }),
  });
}

function capturePointCommitScalarProvenance(
  storedAttempt: AuthenticatedStoredAttemptStateV1,
): PointCommitScalarProvenanceV1 {
  const session = storedAttempt.session;
  return Object.freeze({
    authority: captureAuthorityPort(storedAttempt.authority),
    executionClaim: storedAttempt.executionScope ?? null,
    session: Object.freeze({
      ...session,
      identityAccessPolicySha256:
        copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256:
        copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
    }),
  });
}

function serializeCommitAuthorityStateForTest(
  state: AuthenticatedCommitAuthorityStateV1,
): string {
  return serializePrivateCapabilityStateForTestV1(state, () =>
    new StoredCommitAuthorityCorruptionV1Error({
      reason: "sessionEvidenceInvalid",
    })
  );
}

function serializeVerifiedCommitInputStateForTest(
  state: VerifiedCommitInputStateV1,
): string {
  return serializePrivateCapabilityStateForTestV1(state, () =>
    new CommitInputAuthorityCorruptionV1Error({
      reason: "successfulResultInvalid",
    })
  );
}

function serializePreparedPointCommitStateForTest(
  state: PreparedPointCommitStateV1,
): string {
  return serializePrivateCapabilityStateForTestV1(
    state,
    () => new Error("Prepared point commit state could not be serialized."),
  );
}
