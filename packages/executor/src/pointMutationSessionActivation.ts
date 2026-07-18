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
  PointMutationSessionTerminalLifecycleV1,
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
import { TransactionSessionIdV1Schema } from
  "flarex-protocol/transaction-session";
import { Effect, Result } from "effect";

import { isPlainRecord } from "./plainRecord";
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

const activatedPointMutationSessionBrand: unique symbol = Symbol(
  "FlarexExecutor/ActivatedPointMutationSessionV1",
);

/** Private B1 capability. It carries no caller-authored session authority. */
export interface ActivatedPointMutationSessionV1 {
  readonly [activatedPointMutationSessionBrand]: true;
}

export type ActivatedPointMutationSessionInspectionV1 =
  PointMutationSessionActivationResultV1;

const activatedSessionInspectionByHandle = new WeakMap<
  object,
  ActivatedPointMutationSessionInspectionV1
>();

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

const loadedAttemptInspectionByHandle = new WeakMap<
  object,
  LoadedPointMutationSessionAttemptInspectionV1
>();

export class InvalidActivatedPointMutationSessionV1Error extends Error {
  readonly name = "InvalidActivatedPointMutationSessionV1Error";

  constructor() {
    super("Value is not a process-local activated point-mutation session.");
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

export type PointMutationSessionAttemptTerminalizationContractIssueV1 =
  | { readonly reason: "selectorMismatch" }
  | { readonly reason: "invalidStatusOrLifecycle" }
  | { readonly reason: "invalidTerminalTimestamp" };

export class PointMutationSessionAttemptTerminalizationContractV1Error
  extends Error {
  readonly _tag =
    "PointMutationSessionAttemptTerminalizationContractV1Error" as const;
  readonly name =
    "PointMutationSessionAttemptTerminalizationContractV1Error";

  constructor(
    readonly issue: PointMutationSessionAttemptTerminalizationContractIssueV1,
  ) {
    super(
      `Attempt-terminalization persistence violated its contract: ${issue.reason}.`,
    );
  }
}

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
  | InvalidPointMutationSessionAttemptSelectorV1Error
  | PointMutationSessionAttemptTerminalizationEffectErrorV1
  | PointMutationSessionAttemptTerminalizationContractV1Error;

export function createPointMutationSessionActivationV1(
  persistence: Pick<
    PointMutationSessionActivationPersistenceV1,
    "activateEffect"
  >,
): PointMutationSessionActivationV1 {
  const activate: PointMutationSessionActivationV1["activate"] = Effect.fn(
    "ExecutorPointMutationSessionActivation.activate",
  )(function* (admittedStart) {
    const admitted = yield* Effect.fromResult(
      inspectAdmittedPointMutationStartResultV1(admittedStart),
    );
    const prepared = preparePersistenceActivation(admitted);
    const result = yield* persistence.activateEffect(prepared);
    const handle = Object.freeze({
      [activatedPointMutationSessionBrand]: true as const,
    });
    activatedSessionInspectionByHandle.set(handle, result);
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
      const inspection = yield* Effect.fromResult(
        captureLoadedAttemptInspection(selector, result),
      );
      const handle = Object.freeze({
        [loadedPointMutationSessionAttemptBrand]: true as const,
      });
      loadedAttemptInspectionByHandle.set(handle, inspection);
      return handle;
    },
  );

  return Object.freeze({ load });
}

export function createPointMutationSessionAttemptTerminalizationV1(
  persistence: PointMutationSessionAttemptTerminalizationPersistenceV1,
): PointMutationSessionAttemptTerminalizationV1 {
  const abort = Effect.fn("ExecutorPointMutationSessionTerminalization.abort")(
    function* (
      attempt: LoadedPointMutationSessionAttemptV1,
    ): Effect.fn.Return<
      PointMutationSessionAttemptTerminalizationResultV1,
      PointMutationSessionAttemptTerminalizationExecutionV1Error
    > {
      const inspection = yield* Effect.fromResult(
        inspectLoadedPointMutationSessionAttemptResultV1(attempt),
      );
      const result = yield* persistence.abortEffect({
        selector: inspection.selector,
        expectedSnapshotToken: inspection.snapshotToken,
      });
      return yield* Effect.fromResult(
        captureAttemptTerminalizationResult(inspection.selector, result),
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
      captureAttemptTerminalizationResult(selector, result),
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
  const inspection = activatedSessionInspectionByHandle.get(value);
  if (inspection === undefined) {
    throw new InvalidActivatedPointMutationSessionV1Error();
  }
  return inspection;
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
  const inspection = loadedAttemptInspectionByHandle.get(value);
  if (inspection === undefined) {
    return Result.fail(new InvalidLoadedPointMutationSessionAttemptV1Error());
  }
  return Result.succeed(inspection);
}

function captureLoadedAttemptInspection(
  selector: PointMutationSessionAttemptSelectorV1,
  result: PointMutationSessionAttemptLoadResultV1,
): Result.Result<
  LoadedPointMutationSessionAttemptInspectionV1,
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
        anchor.snapshotToken.scopeId !== selector.scopeId
      ) {
        throw new PointMutationSessionAttemptLoadContractV1Error();
      }
      return Object.freeze({
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
    },
    catch: (cause) => cause instanceof
        PointMutationSessionAttemptLoadContractV1Error
      ? cause
      : new PointMutationSessionAttemptLoadContractV1Error(),
  });
}

function captureAttemptTerminalizationResult(
  selector: PointMutationSessionAttemptSelectorV1,
  result: unknown,
): Result.Result<
  PointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionAttemptTerminalizationContractV1Error
> {
  if (!isPlainRecord(result)) {
    return Result.fail(
      terminalizationContractError("invalidStatusOrLifecycle"),
    );
  }
  return Result.gen(function* () {
    const status = yield* readTerminalizationDataProperty(
      result,
      "status",
      "invalidStatusOrLifecycle",
    );
    const terminalValue = yield* readTerminalizationDataProperty(
      result,
      "terminal",
      "invalidStatusOrLifecycle",
    );
    if (!isPlainRecord(terminalValue)) {
      return yield* Result.fail(
        terminalizationContractError("invalidStatusOrLifecycle"),
      );
    }
    const deploymentId = yield* readTerminalizationDataProperty(
      terminalValue,
      "deploymentId",
      "selectorMismatch",
    );
    const scopeId = yield* readTerminalizationDataProperty(
      terminalValue,
      "scopeId",
      "selectorMismatch",
    );
    const sessionId = yield* readTerminalizationDataProperty(
      terminalValue,
      "sessionId",
      "selectorMismatch",
    );
    const attemptFence = yield* readTerminalizationDataProperty(
      terminalValue,
      "attemptFence",
      "selectorMismatch",
    );
    if (
      deploymentId !== selector.deploymentId ||
      scopeId !== selector.scopeId ||
      sessionId !== selector.sessionId ||
      attemptFence !== selector.attemptFence
    ) {
      return yield* Result.fail(
        terminalizationContractError("selectorMismatch"),
      );
    }
    const lifecycle = yield* readTerminalizationDataProperty(
      terminalValue,
      "lifecycle",
      "invalidStatusOrLifecycle",
    );
    if (
      !isPointMutationSessionTerminalLifecycle(lifecycle) ||
      (status !== "terminalized" && status !== "observed")
    ) {
      return yield* Result.fail(
        terminalizationContractError("invalidStatusOrLifecycle"),
      );
    }
    const terminalizedAt = yield* readTerminalizationDataProperty(
      terminalValue,
      "terminalizedAt",
      "invalidTerminalTimestamp",
    );
    if (
      typeof terminalizedAt !== "string" ||
      !isCanonicalIsoTimestamp(terminalizedAt)
    ) {
      return yield* Result.fail(
        terminalizationContractError("invalidTerminalTimestamp"),
      );
    }
    switch (status) {
      case "terminalized": {
        if (lifecycle === "committed") {
          return yield* Result.fail(
            terminalizationContractError("invalidStatusOrLifecycle"),
          );
        }
        return Object.freeze({
          status: "terminalized" as const,
          terminal: Object.freeze({
            ...selector,
            lifecycle,
            terminalizedAt,
          }),
        });
      }
      case "observed":
        return Object.freeze({
          status: "observed" as const,
          terminal: Object.freeze({
            ...selector,
            lifecycle,
            terminalizedAt,
          }),
        });
    }
  });
}

function readTerminalizationDataProperty(
  input: Readonly<Record<string, unknown>>,
  field: string,
  invalidReason: PointMutationSessionAttemptTerminalizationContractIssueV1["reason"],
): Result.Result<
  unknown,
  PointMutationSessionAttemptTerminalizationContractV1Error
> {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !("value" in descriptor)
  ) {
    return Result.fail(terminalizationContractError(invalidReason));
  }
  return Result.succeed(descriptor.value);
}

function isPointMutationSessionTerminalLifecycle(
  value: unknown,
): value is PointMutationSessionTerminalLifecycleV1 {
  return value === "committed" || value === "aborted" || value === "expired";
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function terminalizationContractError(
  reason: PointMutationSessionAttemptTerminalizationContractIssueV1["reason"],
): PointMutationSessionAttemptTerminalizationContractV1Error {
  return new PointMutationSessionAttemptTerminalizationContractV1Error({
    reason,
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
