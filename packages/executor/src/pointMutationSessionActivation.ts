import type {
  PointMutationSessionActivationPersistenceV1,
  PointMutationSessionActivationEffectErrorV1,
  PointMutationSessionActivationResultV1,
  PointMutationSessionAttemptLoadEffectErrorV1,
  PointMutationSessionAttemptLoadPersistenceV1,
  PointMutationSessionAttemptLoadResultV1,
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationEffectErrorV1,
  PointMutationSessionAttemptTerminalizationPersistenceV1,
  PointMutationSessionAttemptTerminalizationResultV1,
  PreparedPointMutationSessionActivationV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
} from "flarex-protocol/transaction-grant";
import {
  FlarexDbV1StorageGenerationSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  type FlarexDbV1StorageGeneration,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  decodeCatalogSchemaVersionId,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
  type TransactionRequestKeyV1,
} from
  "flarex-protocol/transaction-session";
import { Effect, Result } from "effect";

import {
  getLoadedPointMutationSessionAttemptInspectionV1,
  registerLoadedPointMutationSessionAttemptStateV1,
} from "./pointMutationSessionAttemptState";
import {
  decodePointMutationSessionAttemptSelectorV1Result,
  InvalidPointMutationSessionAttemptSelectorV1Error,
  type PointMutationSessionAttemptSelectorIssueV1,
} from "./pointMutationSessionAttemptSelector";
import {
  inspectAdmittedPointMutationStartResultV1,
  type AdmittedPointMutationStartInspectionV1,
  type AdmittedPointMutationStartV1,
  type InvalidAdmittedPointMutationStartV1Error,
} from "./transactionGrant";
import {
  InvalidPointMutationExecutionClaimV1Error,
  type PointMutationExecutionClaimV1,
  type PointMutationExecutionScopeV1,
  type PointMutationExecutionClaimAdmissionV1,
  type PointMutationExecutionClaimIssuerV1,
} from "./pointMutationExecutionClaim";
import {
  getActivatedPointMutationSessionStateV1,
  registerActivatedPointMutationSessionStateV1,
} from "./pointMutationSessionActivationState";
import {
  capturePointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionAttemptTerminalizationContractV1Error,
  type PointMutationSessionAttemptTerminalizationContractIssueV1,
} from "./pointMutationSessionAttemptTerminalizationContract";

const activatedPointMutationSessionBrand: unique symbol = Symbol(
  "FlarexExecutor/ActivatedPointMutationSessionV1",
);

/** Private B1 capability. It carries no caller-authored session authority. */
export interface ActivatedPointMutationSessionV1 {
  readonly [activatedPointMutationSessionBrand]: true;
}

export type ActivatedPointMutationSessionInspectionV1 =
  PointMutationSessionActivationResultV1;

const loadedPointMutationSessionAttemptBrand: unique symbol = Symbol(
  "FlarexExecutor/LoadedPointMutationSessionAttemptV1",
);

/** Private B2a capability. WeakMap membership, not structure, is proof. */
export interface LoadedPointMutationSessionAttemptV1 {
  readonly [loadedPointMutationSessionAttemptBrand]: true;
}

export interface PointMutationSessionAttemptSelectorWireV1 {
  readonly deploymentId: string;
  readonly scopeId: string;
  readonly sessionId: string;
  readonly attemptFence: string;
}

export interface LoadedPointMutationSessionAttemptInspectionV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  /** Snapshot observed during load; consumers must revalidate current liveness. */
  readonly snapshotToken: SnapshotToken;
  /** Immutable schema artifact pinned by the authoritative exact attempt. */
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export class InvalidActivatedPointMutationSessionV1Error extends Error {
  readonly _tag = "InvalidActivatedPointMutationSessionV1Error" as const;
  readonly name = "InvalidActivatedPointMutationSessionV1Error";

  constructor() {
    super("Value is not a process-local activated point-mutation session.");
  }
}

export class ActivatedPointMutationSessionBusyV1Error extends Error {
  readonly _tag = "ActivatedPointMutationSessionBusyV1Error" as const;
  readonly name = "ActivatedPointMutationSessionBusyV1Error";

  constructor() {
    super("The point-mutation attempt already has a live execution owner.");
  }
}

export {
  InvalidPointMutationSessionAttemptSelectorV1Error,
  type PointMutationSessionAttemptSelectorIssueV1,
};

export class InvalidLoadedPointMutationSessionAttemptV1Error extends Error {
  readonly _tag = "InvalidLoadedPointMutationSessionAttemptV1Error" as const;
  readonly name = "InvalidLoadedPointMutationSessionAttemptV1Error";

  constructor() {
    super("Value is not a process-local loaded point-mutation attempt.");
  }
}

export class PointMutationSessionAttemptLoadContractV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptLoadContractV1Error" as const;
  readonly name = "PointMutationSessionAttemptLoadContractV1Error";

  constructor() {
    super("Attempt-load persistence returned authority outside its selector.");
  }
}

export {
  PointMutationSessionAttemptTerminalizationContractV1Error,
  type PointMutationSessionAttemptTerminalizationContractIssueV1,
};

export interface PointMutationSessionActivationV1 {
  readonly activate: (
    admittedStart: AdmittedPointMutationStartV1,
  ) => Effect.Effect<
    ActivatedPointMutationSessionV1,
    PointMutationSessionActivationExecutionV1Error
  >;
}

export type PointMutationSessionActivationExecutionV1Error =
  | InvalidAdmittedPointMutationStartV1Error
  | PointMutationSessionActivationEffectErrorV1;

export interface PointMutationSessionAttemptLoadingV1 {
  readonly load: (
    selector: unknown,
  ) => Effect.Effect<
    LoadedPointMutationSessionAttemptV1,
    PointMutationSessionAttemptLoadingExecutionV1Error
  >;
}

export type PointMutationSessionAttemptLoadingExecutionV1Error =
  | InvalidPointMutationSessionAttemptSelectorV1Error
  | PointMutationSessionAttemptLoadEffectErrorV1
  | PointMutationSessionAttemptLoadContractV1Error;

export interface PointMutationSessionAttemptTerminalizationV1 {
  readonly abort: (
    attempt: LoadedPointMutationSessionAttemptV1,
    executionClaim: PointMutationExecutionScopeV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationExecutionV1Error
  >;
  readonly expire: (
    selector: unknown,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationExecutionV1Error
  >;
}

export type PointMutationSessionAttemptTerminalizationExecutionV1Error =
  | InvalidLoadedPointMutationSessionAttemptV1Error
  | InvalidPointMutationExecutionClaimV1Error
  | InvalidPointMutationSessionAttemptSelectorV1Error
  | PointMutationSessionAttemptTerminalizationEffectErrorV1
  | PointMutationSessionAttemptTerminalizationContractV1Error;

export function createPointMutationSessionActivationV1(
  persistence: Pick<
    PointMutationSessionActivationPersistenceV1,
    "activateEffect"
  >,
  executionClaims: PointMutationExecutionClaimIssuerV1,
): PointMutationSessionActivationV1 {
  const activate: PointMutationSessionActivationV1["activate"] = Effect.fn(
    "ExecutorPointMutationSessionActivation.activate",
  )(function* (admittedStart) {
    const admitted = yield* Effect.fromResult(
      inspectAdmittedPointMutationStartResultV1(admittedStart),
    );
    const prepared = preparePersistenceActivation(admitted);
    const retainedPrepared = snapshotPreparedActivation(prepared);
    const result = yield* persistence.activateEffect(prepared);
    const handle = Object.freeze({
      [activatedPointMutationSessionBrand]: true as const,
    });
    const executionClaim = result.status === "created"
      ? executionClaims.mint({
          selector: Object.freeze({
            deploymentId: result.anchor.deploymentId,
            scopeId: result.anchor.scopeId,
            sessionId: result.anchor.sessionId,
            attemptFence: result.anchor.attemptFence,
          }),
          observation: result.executionClaim,
          mode: "execute",
        })
      : undefined;
    registerActivatedPointMutationSessionStateV1(handle, Object.freeze({
      inspection: result,
      prepared: retainedPrepared,
      ...(executionClaim === undefined ? {} : { executionClaim }),
    }));
    return handle;
  });

  return Object.freeze({ activate });
}

export function createPointMutationSessionAttemptLoadingV1(
  persistence: PointMutationSessionAttemptLoadPersistenceV1,
): PointMutationSessionAttemptLoadingV1 {
  const load = Effect.fn("ExecutorPointMutationSessionAttemptLoading.load")(
    function* (
      input: unknown,
    ): Effect.fn.Return<
      LoadedPointMutationSessionAttemptV1,
      PointMutationSessionAttemptLoadingExecutionV1Error
    > {
      const selector = yield* Effect.fromResult(
        decodePointMutationSessionAttemptSelectorV1Result(input),
      );
      const result = yield* persistence.loadEffect(selector);
      const captured = yield* Effect.fromResult(
        captureLoadedAttemptInspection(selector, result),
      );
      const handle = Object.freeze({
        [loadedPointMutationSessionAttemptBrand]: true as const,
      });
      registerLoadedPointMutationSessionAttemptStateV1(
        handle,
        captured.inspection,
        captured.requestKey,
        captured.attemptFacet,
      );
      return handle;
    },
  );

  return Object.freeze({ load });
}

export function createPointMutationSessionAttemptTerminalizationV1(
  persistence: PointMutationSessionAttemptTerminalizationPersistenceV1,
  executionClaims: PointMutationExecutionClaimAdmissionV1,
): PointMutationSessionAttemptTerminalizationV1 {
  const abort = Effect.fn("ExecutorPointMutationSessionTerminalization.abort")(
    function* (
      attempt: LoadedPointMutationSessionAttemptV1,
      executionClaim: PointMutationExecutionScopeV1,
    ): Effect.fn.Return<
      PointMutationSessionAttemptTerminalizationResultV1,
      PointMutationSessionAttemptTerminalizationExecutionV1Error
    > {
      const inspection = yield* Effect.fromResult(
        inspectLoadedPointMutationSessionAttemptResultV1(attempt),
      );
      const claim = yield* Effect.fromResult(
        executionClaims.inspect(executionClaim, "execute"),
      );
      if (!loadedAttemptMatchesClaimSelector(inspection, claim.selector)) {
        return yield* Effect.fail(
          new InvalidPointMutationExecutionClaimV1Error({
            reason: "notSameFactory",
          }),
        );
      }
      const result = yield* persistence.abortEffect({
        selector: inspection.selector,
        expectedSnapshotToken: inspection.snapshotToken,
        executionClaim: Object.freeze({
          claimOwner: claim.observation.claimOwner,
          claimFence: claim.observation.claimFence,
        }),
      });
      yield* Effect.fromResult(
        executionClaims.consume(executionClaim, "execute"),
      );
      return yield* Effect.fromResult(
        capturePointMutationSessionAttemptTerminalizationResultV1(
          inspection.selector,
          result,
        ),
      );
    },
  );

  const expire = Effect.fn(
    "ExecutorPointMutationSessionTerminalization.expire",
  )(function* (
    input: unknown,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationExecutionV1Error
  > {
    const selector = yield* Effect.fromResult(
      decodePointMutationSessionAttemptSelectorV1Result(input),
    );
    const result = yield* persistence.expireEffect(selector);
    return yield* Effect.fromResult(
      capturePointMutationSessionAttemptTerminalizationResultV1(
        selector,
        result,
      ),
    );
  });

  return Object.freeze({ abort, expire });
}

export function inspectActivatedPointMutationSessionV1(
  value: unknown,
): ActivatedPointMutationSessionInspectionV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidActivatedPointMutationSessionV1Error();
  }
  const state = getActivatedPointMutationSessionStateV1(value);
  if (state === undefined) {
    throw new InvalidActivatedPointMutationSessionV1Error();
  }
  return state.inspection;
}

export function pointMutationExecutionClaimV1FromActivated(
  value: ActivatedPointMutationSessionV1,
): PointMutationExecutionClaimV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidActivatedPointMutationSessionV1Error();
  }
  const state = getActivatedPointMutationSessionStateV1(value);
  if (state === undefined) {
    throw new InvalidActivatedPointMutationSessionV1Error();
  }
  if (state.executionClaim === undefined) {
    throw new ActivatedPointMutationSessionBusyV1Error();
  }
  return state.executionClaim;
}

export function pointMutationSessionAttemptSelectorV1FromActivated(
  activated: ActivatedPointMutationSessionV1,
): PointMutationSessionAttemptSelectorWireV1 {
  const anchor = inspectActivatedPointMutationSessionV1(activated).anchor;
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence.toString(),
  });
}

export function inspectLoadedPointMutationSessionAttemptV1(
  value: unknown,
): LoadedPointMutationSessionAttemptInspectionV1 {
  return Result.getOrThrow(
    inspectLoadedPointMutationSessionAttemptResultV1(value),
  );
}

function inspectLoadedPointMutationSessionAttemptResultV1(
  value: unknown,
): Result.Result<
  LoadedPointMutationSessionAttemptInspectionV1,
  InvalidLoadedPointMutationSessionAttemptV1Error
> {
  if (typeof value !== "object" || value === null) {
    return Result.fail(new InvalidLoadedPointMutationSessionAttemptV1Error());
  }
  const inspection = getLoadedPointMutationSessionAttemptInspectionV1(value);
  if (inspection === undefined) {
    return Result.fail(new InvalidLoadedPointMutationSessionAttemptV1Error());
  }
  return Result.succeed(inspection);
}

function loadedAttemptMatchesClaimSelector(
  inspection: LoadedPointMutationSessionAttemptInspectionV1,
  selector: PointMutationSessionAttemptSelectorV1,
): boolean {
  return selector.deploymentId === inspection.selector.deploymentId &&
    selector.scopeId === inspection.selector.scopeId &&
    selector.sessionId === inspection.selector.sessionId &&
    selector.attemptFence === inspection.selector.attemptFence;
}

function captureLoadedAttemptInspection(
  selector: PointMutationSessionAttemptSelectorV1,
  result: PointMutationSessionAttemptLoadResultV1,
): Result.Result<
  Readonly<{
    readonly inspection: LoadedPointMutationSessionAttemptInspectionV1;
    readonly requestKey: TransactionRequestKeyV1;
    readonly attemptFacet: PointMutationSessionAttemptLoadResultV1["attemptFacet"];
  }>,
  PointMutationSessionAttemptLoadContractV1Error
> {
  return Result.try({
    try: () => {
      const anchor = result.anchor;
      if (
        result.status !== "loaded" ||
        anchor.deploymentId !== selector.deploymentId ||
        anchor.scopeId !== selector.scopeId ||
        anchor.sessionId !== selector.sessionId ||
        anchor.attemptFence !== selector.attemptFence ||
        anchor.snapshotToken.scopeId !== selector.scopeId ||
        (result.attemptFacet.kind !== "pristineOpen" &&
          result.attemptFacet.kind !== "nonPristine")
      ) {
        throw new PointMutationSessionAttemptLoadContractV1Error();
      }
      const inspection = Object.freeze({
        selector,
        storageGeneration: FlarexDbV1StorageGenerationSchema.make(
          anchor.storageGeneration,
        ),
        storageGenerationFence: StorageGenerationFenceSchema.make(
          anchor.storageGenerationFence,
        ),
        snapshotToken: Object.freeze(
          SnapshotTokenSchema.make({
            scopeId: anchor.snapshotToken.scopeId,
            epoch: anchor.snapshotToken.epoch,
            commitSeq: anchor.snapshotToken.commitSeq,
          }),
        ),
        schemaVersionId: decodeCatalogSchemaVersionId(
          result.executionPin.schemaVersionId,
        ),
      });
      return Object.freeze({
        inspection,
        requestKey: TransactionRequestKeyV1Schema.make(anchor.requestKey),
        attemptFacet: Object.freeze({ kind: result.attemptFacet.kind }),
      });
    },
    catch: (cause) => cause instanceof
        PointMutationSessionAttemptLoadContractV1Error
      ? cause
      : new PointMutationSessionAttemptLoadContractV1Error(),
  });
}

function preparePersistenceActivation(
  admitted: AdmittedPointMutationStartInspectionV1,
): PreparedPointMutationSessionActivationV1 {
  const preparedStart = admitted.preparedStart;
  const pins = preparedStart.logicalPins;
  const grant = admitted.verifiedGrant.evidence;
  const payload = grant.payload;

  return Object.freeze({
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    evidence: Object.freeze({
      packageId: pins.packageId,
      artifactRuntime: pins.artifactRuntime,
      artifactId: pins.artifactId,
      sourcePackageHash: pins.sourcePackageHash,
      executionModule: pins.executionModule,
      functionPath: pins.functionPath,
      functionKind: pins.functionKind,
      schemaVersionId: pins.schemaVersionId,
      policyVersion: payload.policyVersion,
      identityAccessPolicySha256:
        transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
          payload.identityAccessPolicySha256,
        ),
      validatedArgsJson: preparedStart.validatedArguments.valueJson,
      validatedArgsValueCodecVersion:
        pins.validatedArgsValueCodecVersion,
      validatedArgsCanonicalBytes:
        preparedStart.validatedArguments.canonicalBytes,
      validatedArgsSha256: preparedStart.validatedArguments.sha256,
      authorizationGrantId: grant.authorizationGrantId,
      authorizationGrantJson: grant.authorizationGrantJson,
      authorizationGrantValueCodecVersion:
        grant.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalBytes:
        grant.authorizationGrantCanonicalBytes,
      authorizationGrantSha256: grant.authorizationGrantSha256,
      authorizationRevocationEpoch: grant.authorizationRevocationEpoch,
      authorizationGrantExpiresAt: new Date(
        grant.authorizationGrantExpiresAt,
      ),
      requestKey: pins.requestKey,
      requestSha256: preparedStart.requestEvidence.sha256,
    }),
  } satisfies PreparedPointMutationSessionActivationV1);
}

function snapshotPreparedActivation(
  value: PreparedPointMutationSessionActivationV1,
): PreparedPointMutationSessionActivationV1 {
  const snapshot = structuredClone(value);
  return Object.freeze({
    deploymentId: snapshot.deploymentId,
    scopeId: snapshot.scopeId,
    evidence: Object.freeze({ ...snapshot.evidence }),
  });
}
