import { isNonArrayRecord as isUnknownRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type {
  SplitScopeAuthorityProvisioningReceipt,
} from "./scopeAuthorityProvisioningReceiptTypes";
import type { ScopeClockRecord } from "./scopeClock";
import { ScopeDeploymentAmbiguousError, type ScopeMetadataRecord } from "./scopeMetadata";
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

export interface ExactScopeMetadataReader {
  getScopeMetadata(scopeId: ScopeId): Promise<ScopeMetadataRecord | null>;
}

export interface ScopeProvisioningReceiptReader {
  getScopeAuthorityProvisioningReceipt(
    scopeId: ScopeId,
  ): Promise<SplitScopeAuthorityProvisioningReceipt | null>;
}

export type ScopeAuthorityClock = Pick<ScopeClockRecord,
  "scopeId" | "storageGeneration" | "storageGenerationFence" | "epoch" | "lastCommitSeq">;

export interface ScopeClockReader {
  getCurrentClock(scopeId: ScopeId): Promise<ScopeAuthorityClock | null>;
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

export interface ExactTrustedScopeAuthorityResolutionPorts<
  Target extends LocatedScopeClockReader = LocatedScopeClockReader,
> extends Omit<TrustedScopeAuthorityResolutionPorts<Target>, "scopeMetadata"> {
  readonly scopeMetadata: ExactScopeMetadataReader;
}

export interface TrustedScopeSelection {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
}

/**
 * Captures a dynamic authority directory without losing method receivers.
 * Consumers retain their own domain-specific configuration and resolution
 * policy; this helper owns only the shared authority-port mechanics.
 */
export function captureTrustedScopeAuthorityResolutionPorts<
  Target extends LocatedScopeClockReader,
>(
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): TrustedScopeAuthorityResolutionPorts<Target> {
  const scopeMetadataOwner = ports.scopeMetadata;
  const getScopeMetadataByDeploymentId =
    scopeMetadataOwner.getScopeMetadataByDeploymentId;
  const receiptOwner = ports.provisioningReceipts;
  const getScopeAuthorityProvisioningReceipt =
    receiptOwner.getScopeAuthorityProvisioningReceipt;
  const targetOwner = ports.scopeClockTargets;
  const resolve = targetOwner.resolve;
  return Object.freeze({
    scopeMetadata: Object.freeze({
      getScopeMetadataByDeploymentId: (deploymentId: string) =>
        getScopeMetadataByDeploymentId.call(scopeMetadataOwner, deploymentId),
    }),
    provisioningReceipts: Object.freeze({
      getScopeAuthorityProvisioningReceipt: (scopeId: ScopeId) =>
        getScopeAuthorityProvisioningReceipt.call(receiptOwner, scopeId),
    }),
    scopeClockTargets: Object.freeze({
      resolve: (physicalLocator: ScopePhysicalLocator) =>
        resolve.call(targetOwner, physicalLocator),
    }),
  });
}

export function captureExactTrustedScopeAuthorityResolutionPorts<
  Target extends LocatedScopeClockReader,
>(ports: ExactTrustedScopeAuthorityResolutionPorts<Target>): ExactTrustedScopeAuthorityResolutionPorts<Target> {
  const metadata = ports.scopeMetadata;
  const getScopeMetadata = metadata.getScopeMetadata;
  const receipts = ports.provisioningReceipts;
  const getReceipt = receipts.getScopeAuthorityProvisioningReceipt;
  const targets = ports.scopeClockTargets;
  const resolveTarget = targets.resolve;
  return Object.freeze({
    scopeMetadata: Object.freeze({
      getScopeMetadata: (scopeId: ScopeId) => getScopeMetadata.call(metadata, scopeId),
    }),
    provisioningReceipts: Object.freeze({
      getScopeAuthorityProvisioningReceipt: (scopeId: ScopeId) =>
        getReceipt.call(receipts, scopeId),
    }),
    scopeClockTargets: Object.freeze({
      resolve: (locator: ScopePhysicalLocator) => resolveTarget.call(targets, locator),
    }),
  });
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
      readonly reason: "scopeMetadataAmbiguous";
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
    catch: (cause) => cause instanceof ScopeDeploymentAmbiguousError &&
        cause.deploymentId === deploymentId
      ? resolutionError({ reason: "scopeMetadataAmbiguous", deploymentId })
      : new TrustedScopeAuthorityPortError({ operation: "scopeMetadataRead", cause }),
  });
  if (scope === null) {
    return yield* Effect.fail(
      resolutionError({ reason: "scopeMetadataMissing", deploymentId }),
    );
  }
  return yield* resolveLocatedScopeMetadataEffect(scope, deploymentId, ports);
});

/** The selection must be minted by trusted session or grant composition. */
export const resolveLocatedTrustedScopeAuthorityByIdEffect = Effect.fn(
  "ScopeAuthority.resolveLocatedTrustedById",
)(function* <Target extends LocatedScopeClockReader>(
  selection: TrustedScopeSelection,
  ports: ExactTrustedScopeAuthorityResolutionPorts<Target>,
): Effect.fn.Return<LocatedTrustedScopeAuthority<Target>, TrustedScopeAuthorityError> {
  const scope = yield* Effect.tryPromise({
    try: () => ports.scopeMetadata.getScopeMetadata(selection.scopeId),
    catch: (cause) => new TrustedScopeAuthorityPortError({
      operation: "scopeMetadataRead",
      cause,
    }),
  });
  if (scope === null || scope.scopeId !== selection.scopeId) {
    return yield* Effect.fail(resolutionError({
      reason: "scopeMetadataMissing",
      deploymentId: selection.deploymentId,
    }));
  }
  return yield* resolveLocatedScopeMetadataEffect(scope, selection.deploymentId, ports);
});

const resolveLocatedScopeMetadataEffect = Effect.fn(
  "ScopeAuthority.resolveLocatedMetadata",
)(function* <Target extends LocatedScopeClockReader>(
  scope: ScopeMetadataRecord,
  deploymentId: string,
  ports: Pick<TrustedScopeAuthorityResolutionPorts<Target>, "provisioningReceipts" | "scopeClockTargets">,
): Effect.fn.Return<LocatedTrustedScopeAuthority<Target>, TrustedScopeAuthorityError> {
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

const resolveSplitScopeAuthority = Effect.fn(
  "ScopeAuthority.resolveSplit",
)(function* <Target extends LocatedScopeClockReader>(
  intent: ScopeAuthorityIntent,
  expectedLocator: SplitScopePhysicalLocator,
  ports: Pick<TrustedScopeAuthorityResolutionPorts<Target>, "provisioningReceipts" | "scopeClockTargets">,
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
  yield* Effect.fromResult(requireSplitScopeReceiptResult(intent, expectedLocator, receipt));
  return yield* resolveScopeAuthorityAtTarget(intent, expectedLocator, ports);
});

function requireSplitScopeReceiptResult(intent: ScopeAuthorityIntent, expectedLocator: SplitScopePhysicalLocator,
  receipt: SplitScopeAuthorityProvisioningReceipt | null): Result.Result<void, TrustedScopeAuthorityResolutionError> {
  if (receipt === null) {
    return Result.fail(resolutionError({
      reason: "splitProvisioningReceiptMissing",
      scopeId: intent.scopeId,
    }));
  }
  if (receipt.scopeId !== intent.scopeId) {
    return Result.fail(resolutionError({
      reason: "splitProvisioningReceiptScopeMismatch",
      scopeId: intent.scopeId,
      actualScopeId: receipt.scopeId,
    }));
  }
  if (receipt.state !== "ready") {
    return Result.fail(resolutionError({
      reason: "splitProvisioningReceiptNotReady",
      scopeId: intent.scopeId,
      actualState: receipt.state,
    }));
  }
  const receiptLocator = captureScopePhysicalLocator(receipt.physicalLocator);
  if (!scopePhysicalLocatorsEqual(expectedLocator, receiptLocator)) {
    return Result.fail(resolutionError({
      reason: "splitProvisioningReceiptPlacementMismatch",
      scopeId: intent.scopeId,
      expected: expectedLocator,
      actual: receiptLocator,
    }));
  }

  return Result.succeed(undefined);
}

/** Reuses authority validation after the accepting kernel reads current
 * placement, receipt and clock under one installed PostgreSQL snapshot. */
export function resolveTrustedScopeAuthoritySnapshotResult(selection: TrustedScopeSelection,
  scope: ScopeMetadataRecord | null, receipt: SplitScopeAuthorityProvisioningReceipt | null,
  targetLocator: ScopePhysicalLocator, clock: ScopeAuthorityClock | null,
): Result.Result<TrustedScopeAuthority, TrustedScopeAuthorityResolutionError> {
  return Result.gen(function* () {
    const intent = yield* resolveTrustedScopePlacementSnapshotResult(selection, scope, receipt, targetLocator);
    return yield* trustedAuthorityResult(intent, targetLocator, clock);
  });
}

/** Placement validation has no sequencer or execution capability. Full and
 * compact installed owners reuse the same persisted selection/receipt rules. */
export function resolveTrustedScopePlacementSnapshotResult(selection: TrustedScopeSelection,
  scope: ScopeMetadataRecord | null, receipt: SplitScopeAuthorityProvisioningReceipt | null,
  targetLocator: ScopePhysicalLocator,
): Result.Result<Pick<TrustedScopeAuthority, "deploymentId" | "scopeId" | "physicalLocator">, TrustedScopeAuthorityResolutionError> {
  return Result.gen(function* () {
    if (scope === null || scope.scopeId !== selection.scopeId) return yield* Result.fail(resolutionError({
      reason: "scopeMetadataMissing", deploymentId: selection.deploymentId }));
    const intent = captureScopeAuthorityIntent(scope);
    if (intent.deploymentId !== selection.deploymentId) return yield* Result.fail(resolutionError({
      reason: "scopeDeploymentMismatch", deploymentId: selection.deploymentId,
      scopeId: intent.scopeId, actualDeploymentId: intent.deploymentId }));
    if (!scopePhysicalLocatorsEqual(intent.physicalLocator, targetLocator)) return yield* Result.fail(resolutionError({
      reason: "scopeClockTargetPlacementMismatch", scopeId: intent.scopeId,
      expected: intent.physicalLocator, actual: targetLocator }));
    if (intent.physicalLocator.kind !== "shared_database")
      yield* requireSplitScopeReceiptResult(intent, intent.physicalLocator, receipt);
    return intent;
  });
}

const resolveScopeAuthorityAtTarget = Effect.fn(
  "ScopeAuthority.resolveAtTarget",
)(function* <Target extends LocatedScopeClockReader>(
  intent: ScopeAuthorityIntent,
  expectedLocator: ScopePhysicalLocator,
  ports: Pick<TrustedScopeAuthorityResolutionPorts<Target>, "provisioningReceipts" | "scopeClockTargets">,
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
  clock: ScopeAuthorityClock | null,
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
  if (!isNonBlankString(value.databaseKey)) {
    return Result.fail("locatorDatabaseKeyInvalid");
  }
  if (!isNonBlankString(value.schemaName)) {
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
    case "scopeMetadataAmbiguous":
      return `Trusted scope authority for deployment ${failure.deploymentId} needs an exact scope ID`;
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
