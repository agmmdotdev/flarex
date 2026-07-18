import { isNonArrayRecord as isUnknownRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type {
  SplitScopeAuthorityProvisioningReceipt,
} from "./scopeAuthorityProvisioningReceiptTypes";
import type { ScopeClockRecord } from "./scopeClock";
import type { ScopeMetadataRecord } from "./scopeMetadata";
import type {
  ScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "./scopeMetadataTypes";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "./scopePhysicalLocator";

export interface ScopeMetadataReader {
  getScopeMetadataByDeploymentId(
    deploymentId: string,
  ): Promise<ScopeMetadataRecord | null>;
}

export interface ScopeProvisioningReceiptReader {
  getScopeAuthorityProvisioningReceipt(
    scopeId: ScopeId,
  ): Promise<SplitScopeAuthorityProvisioningReceipt | null>;
}

export interface ScopeClockReader {
  getCurrentClock(scopeId: ScopeId): Promise<ScopeClockRecord | null>;
}

export interface LocatedScopeClockReader extends ScopeClockReader {
  readonly physicalLocator: ScopePhysicalLocator;
}

export interface ScopeClockTargetReaderResolver<
  Target extends LocatedScopeClockReader = LocatedScopeClockReader,
> {
  resolve(
    physicalLocator: ScopePhysicalLocator,
  ): Promise<Target>;
}

export interface TrustedScopeAuthorityResolutionPorts<
  Target extends LocatedScopeClockReader = LocatedScopeClockReader,
> {
  readonly scopeMetadata: ScopeMetadataReader;
  readonly provisioningReceipts: ScopeProvisioningReceiptReader;
  readonly scopeClockTargets: ScopeClockTargetReaderResolver<Target>;
}

export interface TrustedScopeAuthority {
  readonly deploymentId: ScopeMetadataRecord["deploymentId"];
  readonly scopeId: ScopeMetadataRecord["scopeId"];
  readonly physicalLocator: ScopePhysicalLocator;
  readonly storageGeneration: ScopeClockRecord["storageGeneration"];
  readonly storageGenerationFence:
    ScopeClockRecord["storageGenerationFence"];
  readonly epoch: ScopeClockRecord["epoch"];
  readonly lastCommitSeq: ScopeClockRecord["lastCommitSeq"];
  readonly lastOutboxSeq: ScopeClockRecord["lastOutboxSeq"];
}

export interface LocatedTrustedScopeAuthority<
  Target extends LocatedScopeClockReader = LocatedScopeClockReader,
> {
  readonly authority: TrustedScopeAuthority;
  readonly target: Target;
}

export type InvalidScopeClockTargetReason =
  | "targetNotObject"
  | "getCurrentClockMissing"
  | "locatorNotObject"
  | "locatorUnexpectedFields"
  | "locatorKindUnsupported"
  | "locatorDatabaseKeyInvalid"
  | "locatorSchemaNameInvalid";

export type TrustedScopeAuthorityResolutionFailure =
  | {
      readonly reason: "scopeMetadataMissing";
      readonly deploymentId: string;
    }
  | {
      readonly reason: "scopeDeploymentMismatch";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly actualDeploymentId: string;
    }
  | {
      readonly reason: "splitProvisioningReceiptMissing";
      readonly scopeId: ScopeId;
    }
  | {
      readonly reason: "splitProvisioningReceiptScopeMismatch";
      readonly scopeId: ScopeId;
      readonly actualScopeId: ScopeId;
    }
  | {
      readonly reason: "splitProvisioningReceiptNotReady";
      readonly scopeId: ScopeId;
      readonly actualState: "reserved";
    }
  | {
      readonly reason: "splitProvisioningReceiptPlacementMismatch";
      readonly scopeId: ScopeId;
      readonly expected: SplitScopePhysicalLocator;
      readonly actual: SplitScopePhysicalLocator;
    }
  | {
      readonly reason: "scopeClockTargetResolutionFailed";
      readonly scopeId: ScopeId;
      readonly physicalLocator: ScopePhysicalLocator;
      readonly resolutionCause: unknown;
    }
  | {
      readonly reason: "scopeClockTargetPlacementMismatch";
      readonly scopeId: ScopeId;
      readonly expected: ScopePhysicalLocator;
      readonly actual: ScopePhysicalLocator;
    }
  | {
      readonly reason: "scopeClockTargetInvalid";
      readonly scopeId: ScopeId;
      readonly invalidReason: InvalidScopeClockTargetReason;
    }
  | {
      readonly reason: "scopeClockMissing";
      readonly scopeId: ScopeId;
      readonly physicalLocator: ScopePhysicalLocator;
    }
  | {
      readonly reason: "scopeClockScopeMismatch";
      readonly scopeId: ScopeId;
      readonly actualScopeId: ScopeId;
      readonly physicalLocator: ScopePhysicalLocator;
    };

export class TrustedScopeAuthorityResolutionError extends Error {
  readonly _tag = "TrustedScopeAuthorityResolutionError" as const;

  constructor(readonly failure: TrustedScopeAuthorityResolutionFailure) {
    super(trustedScopeAuthorityResolutionFailureMessage(failure));
    this.name = "TrustedScopeAuthorityResolutionError";
  }
}

export type TrustedScopeAuthorityPortOperation =
  | "scopeMetadataRead"
  | "provisioningReceiptRead"
  | "scopeClockRead";

export class TrustedScopeAuthorityPortError extends Data.TaggedError(
  "TrustedScopeAuthorityPortError",
)<{
  readonly operation: TrustedScopeAuthorityPortOperation;
  readonly cause: unknown;
}> {}

export type TrustedScopeAuthorityError =
  | TrustedScopeAuthorityResolutionError
  | TrustedScopeAuthorityPortError;

interface ScopeAuthorityIntent {
  readonly deploymentId: ScopeMetadataRecord["deploymentId"];
  readonly scopeId: ScopeMetadataRecord["scopeId"];
  readonly physicalLocator: ScopePhysicalLocator;
}

interface UnknownLocatedScopeClockReader extends ScopeClockReader {
  readonly physicalLocator: unknown;
}

/**
 * Resolves current data-plane authority from persisted control metadata and
 * the located scope clock. Missing or inconsistent metadata never implies the
 * legacy storage generation.
 */
export const resolveTrustedScopeAuthorityEffect = Effect.fn(
  "ScopeAuthority.resolveTrusted",
)(function* (
  deploymentId: string,
  ports: TrustedScopeAuthorityResolutionPorts,
): Effect.fn.Return<
  TrustedScopeAuthority,
  TrustedScopeAuthorityError
> {
  return (yield* resolveLocatedTrustedScopeAuthorityEffect(
    deploymentId,
    ports,
  )).authority;
});

/**
 * Resolves the same trusted authority while retaining the exact validated
 * target instance selected by the placement resolver. Consumers with a richer
 * target capability can therefore perform a second authority read without
 * resolving or guessing the physical target again.
 */
export const resolveLocatedTrustedScopeAuthorityEffect = Effect.fn(
  "ScopeAuthority.resolveLocatedTrusted",
)(function* <Target extends LocatedScopeClockReader>(
  deploymentId: string,
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): Effect.fn.Return<
  LocatedTrustedScopeAuthority<Target>,
  TrustedScopeAuthorityError
> {
  const scope = yield* Effect.tryPromise({
    try: () =>
      ports.scopeMetadata.getScopeMetadataByDeploymentId(deploymentId),
    catch: (cause) => new TrustedScopeAuthorityPortError({
      operation: "scopeMetadataRead",
      cause,
    }),
  });
  if (scope === null) {
    return yield* Effect.fail(
      resolutionError({ reason: "scopeMetadataMissing", deploymentId }),
    );
  }
  const intent = captureScopeAuthorityIntent(scope);
  if (intent.deploymentId !== deploymentId) {
    return yield* Effect.fail(resolutionError({
      reason: "scopeDeploymentMismatch",
      deploymentId,
      scopeId: intent.scopeId,
      actualDeploymentId: intent.deploymentId,
    }));
  }

  switch (intent.physicalLocator.kind) {
    case "shared_database":
      return yield* resolveScopeAuthorityAtTarget(
        intent,
        intent.physicalLocator,
        ports,
      );
    case "schema_per_scope":
    case "database_per_scope":
      return yield* resolveSplitScopeAuthority(
        intent,
        intent.physicalLocator,
        ports,
      );
  }
});

/**
 * Temporary Promise compatibility boundary for transaction activation,
 * authorization-epoch resolution, point commit, stored-attempt evidence, and
 * commit-authority loading. Delete it when those callers consume
 * `resolveLocatedTrustedScopeAuthorityEffect` directly.
 */
export function resolveLocatedTrustedScopeAuthority<
  Target extends LocatedScopeClockReader,
>(
  deploymentId: string,
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): Promise<LocatedTrustedScopeAuthority<Target>> {
  return Effect.runPromise(
    resolveLocatedTrustedScopeAuthorityEffect(deploymentId, ports).pipe(
      Effect.mapError((error) =>
        error instanceof TrustedScopeAuthorityPortError
          ? error.cause
          : error
      ),
    ),
  );
}

const resolveSplitScopeAuthority = Effect.fn(
  "ScopeAuthority.resolveSplit",
)(function* <Target extends LocatedScopeClockReader>(
  intent: ScopeAuthorityIntent,
  expectedLocator: SplitScopePhysicalLocator,
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): Effect.fn.Return<
  LocatedTrustedScopeAuthority<Target>,
  TrustedScopeAuthorityError
> {
  const receipt = yield* Effect.tryPromise({
    try: () => ports.provisioningReceipts.getScopeAuthorityProvisioningReceipt(
      intent.scopeId,
    ),
    catch: (cause) => new TrustedScopeAuthorityPortError({
      operation: "provisioningReceiptRead",
      cause,
    }),
  });
  if (receipt === null) {
    return yield* Effect.fail(resolutionError({
      reason: "splitProvisioningReceiptMissing",
      scopeId: intent.scopeId,
    }));
  }
  if (receipt.scopeId !== intent.scopeId) {
    return yield* Effect.fail(resolutionError({
      reason: "splitProvisioningReceiptScopeMismatch",
      scopeId: intent.scopeId,
      actualScopeId: receipt.scopeId,
    }));
  }
  if (receipt.state !== "ready") {
    return yield* Effect.fail(resolutionError({
      reason: "splitProvisioningReceiptNotReady",
      scopeId: intent.scopeId,
      actualState: receipt.state,
    }));
  }
  const receiptLocator = captureScopePhysicalLocator(receipt.physicalLocator);
  if (!scopePhysicalLocatorsEqual(expectedLocator, receiptLocator)) {
    return yield* Effect.fail(resolutionError({
      reason: "splitProvisioningReceiptPlacementMismatch",
      scopeId: intent.scopeId,
      expected: expectedLocator,
      actual: receiptLocator,
    }));
  }

  return yield* resolveScopeAuthorityAtTarget(
    intent,
    expectedLocator,
    ports,
  );
});

const resolveScopeAuthorityAtTarget = Effect.fn(
  "ScopeAuthority.resolveAtTarget",
)(function* <Target extends LocatedScopeClockReader>(
  intent: ScopeAuthorityIntent,
  expectedLocator: ScopePhysicalLocator,
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): Effect.fn.Return<
  LocatedTrustedScopeAuthority<Target>,
  TrustedScopeAuthorityError
> {
  const unresolvedTarget = yield* Effect.tryPromise({
    try: () => ports.scopeClockTargets.resolve(expectedLocator),
    catch: (resolutionCause) => resolutionError({
      reason: "scopeClockTargetResolutionFailed",
      scopeId: intent.scopeId,
      physicalLocator: expectedLocator,
      resolutionCause,
    }),
  });
  const target = yield* Effect.fromResult(
    requireScopeClockTargetResult(unresolvedTarget, intent.scopeId),
  );
  const actualLocator = yield* Effect.fromResult(
    decodePhysicalLocatorResult(target.physicalLocator),
  ).pipe(
    Effect.mapError((invalidReason) => resolutionError({
      reason: "scopeClockTargetInvalid",
      scopeId: intent.scopeId,
      invalidReason,
    })),
  );
  if (!scopePhysicalLocatorsEqual(expectedLocator, actualLocator)) {
    return yield* Effect.fail(resolutionError({
      reason: "scopeClockTargetPlacementMismatch",
      scopeId: intent.scopeId,
      expected: expectedLocator,
      actual: actualLocator,
    }));
  }

  const clock = yield* Effect.tryPromise({
    try: () => target.getCurrentClock(intent.scopeId),
    catch: (cause) => new TrustedScopeAuthorityPortError({
      operation: "scopeClockRead",
      cause,
    }),
  });
  const authority = yield* Effect.fromResult(
    trustedAuthorityResult(intent, expectedLocator, clock),
  );

  return Object.freeze({
    authority,
    target,
  }) satisfies LocatedTrustedScopeAuthority<Target>;
});

function trustedAuthorityResult(
  intent: ScopeAuthorityIntent,
  physicalLocator: ScopePhysicalLocator,
  clock: ScopeClockRecord | null,
): Result.Result<
  TrustedScopeAuthority,
  TrustedScopeAuthorityResolutionError
> {
  if (clock === null) {
    return Result.fail(resolutionError({
      reason: "scopeClockMissing",
      scopeId: intent.scopeId,
      physicalLocator,
    }));
  }
  if (clock.scopeId !== intent.scopeId) {
    return Result.fail(resolutionError({
      reason: "scopeClockScopeMismatch",
      scopeId: intent.scopeId,
      actualScopeId: clock.scopeId,
      physicalLocator,
    }));
  }
  return Result.succeed(Object.freeze({
    deploymentId: intent.deploymentId,
    scopeId: intent.scopeId,
    physicalLocator,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
    lastCommitSeq: clock.lastCommitSeq,
    lastOutboxSeq: clock.lastOutboxSeq,
  }) satisfies TrustedScopeAuthority);
}

function resolutionError(
  failure: TrustedScopeAuthorityResolutionFailure,
): TrustedScopeAuthorityResolutionError {
  return new TrustedScopeAuthorityResolutionError(failure);
}

function captureScopeAuthorityIntent(
  scope: ScopeMetadataRecord,
): ScopeAuthorityIntent {
  return Object.freeze({
    deploymentId: scope.deploymentId,
    scopeId: scope.scopeId,
    physicalLocator: captureScopePhysicalLocator(scope.physicalLocator),
  }) satisfies ScopeAuthorityIntent;
}

function requireScopeClockTargetResult<
  Target extends LocatedScopeClockReader,
>(
  value: Target,
  scopeId: ScopeId,
): Result.Result<Target, TrustedScopeAuthorityResolutionError> {
  if (!isUnknownRecord(value)) {
    return Result.fail(resolutionError({
      reason: "scopeClockTargetInvalid",
      scopeId,
      invalidReason: "targetNotObject",
    }));
  }
  if (!hasGetCurrentClock(value)) {
    return Result.fail(resolutionError({
      reason: "scopeClockTargetInvalid",
      scopeId,
      invalidReason: "getCurrentClockMissing",
    }));
  }
  return Result.succeed(value);
}

function decodePhysicalLocatorResult(
  value: unknown,
): Result.Result<ScopePhysicalLocator, InvalidScopeClockTargetReason> {
  if (!isUnknownRecord(value)) {
    return Result.fail("locatorNotObject");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("kind") ||
    !keys.includes("databaseKey") ||
    !keys.includes("schemaName")
  ) {
    return Result.fail("locatorUnexpectedFields");
  }
  if (
    typeof value.databaseKey !== "string" ||
    value.databaseKey.trim().length === 0
  ) {
    return Result.fail("locatorDatabaseKeyInvalid");
  }
  if (
    typeof value.schemaName !== "string" ||
    value.schemaName.trim().length === 0
  ) {
    return Result.fail("locatorSchemaNameInvalid");
  }

  switch (value.kind) {
    case "shared_database":
      return Result.succeed(
        Object.freeze({
          kind: value.kind,
          databaseKey: value.databaseKey,
          schemaName: value.schemaName,
        }),
      );
    case "schema_per_scope":
      return Result.succeed(
        Object.freeze({
          kind: value.kind,
          databaseKey: value.databaseKey,
          schemaName: value.schemaName,
        }),
      );
    case "database_per_scope":
      return Result.succeed(
        Object.freeze({
          kind: value.kind,
          databaseKey: value.databaseKey,
          schemaName: value.schemaName,
        }),
      );
    default:
      return Result.fail("locatorKindUnsupported");
  }
}

function hasGetCurrentClock(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & UnknownLocatedScopeClockReader {
  return typeof value.getCurrentClock === "function";
}

function trustedScopeAuthorityResolutionFailureMessage(
  failure: TrustedScopeAuthorityResolutionFailure,
): string {
  switch (failure.reason) {
    case "scopeMetadataMissing":
      return `Trusted scope authority is missing for deployment ${failure.deploymentId}`;
    case "scopeDeploymentMismatch":
      return `Trusted scope ${failure.scopeId} belongs to deployment ${failure.actualDeploymentId}, not ${failure.deploymentId}`;
    case "splitProvisioningReceiptMissing":
      return `Split scope ${failure.scopeId} has no provisioning receipt`;
    case "splitProvisioningReceiptScopeMismatch":
      return `Split scope ${failure.scopeId} resolved provisioning receipt for ${failure.actualScopeId}`;
    case "splitProvisioningReceiptNotReady":
      return `Split scope ${failure.scopeId} is not ready`;
    case "splitProvisioningReceiptPlacementMismatch":
      return `Split scope ${failure.scopeId} provisioning placement does not match scope metadata`;
    case "scopeClockTargetResolutionFailed":
      return `Scope ${failure.scopeId} clock target resolution failed`;
    case "scopeClockTargetPlacementMismatch":
      return `Scope ${failure.scopeId} clock target placement does not match scope metadata`;
    case "scopeClockTargetInvalid":
      return `Scope ${failure.scopeId} clock target is invalid: ${failure.invalidReason}`;
    case "scopeClockMissing":
      return `Trusted scope clock is missing for scope ${failure.scopeId}`;
    case "scopeClockScopeMismatch":
      return `Trusted scope ${failure.scopeId} resolved clock for ${failure.actualScopeId}`;
  }
}
