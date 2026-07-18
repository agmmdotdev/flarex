import type {
  ScopeId,
} from "flarex-protocol/storage-authority";
import type {
  TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import type {
  TransactionAuthorizationRevocationEpoch,
} from "flarex-protocol/transaction-session";
import { Data, Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityPortError,
  type LocatedScopeClockReader,
  type ScopeClockTargetReaderResolver,
  type ScopeMetadataReader,
  type ScopeProvisioningReceiptReader,
  type TrustedScopeAuthorityError,
} from "./scopeAuthorityResolution";
import {
  getScopeClock,
  requireScopeAuthorizationRevocationEpochInTransaction,
  type ScopeAuthorizationRevocationEpochReadError,
  ScopeClockCorruptionError,
  ScopeClockNotFoundError,
} from "./scopeClock";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";

export interface LocatedScopeAuthorizationEpochTarget
  extends LocatedScopeClockReader {
  readonly requireCurrentAuthorizationRevocationEpochEffect: (
    scopeId: ScopeId,
  ) => Effect.Effect<
    TransactionAuthorizationRevocationEpoch,
    LocatedScopeAuthorizationEpochReadError
  >;
}

export interface CurrentScopeAuthorizationEpochResolutionPorts {
  readonly scopeMetadata: ScopeMetadataReader;
  readonly provisioningReceipts: ScopeProvisioningReceiptReader;
  readonly scopeEpochTargets: ScopeClockTargetReaderResolver;
}

export interface CurrentScopeAuthorizationEpoch {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ScopeId;
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

export type CurrentScopeAuthorizationEpochResolutionFailure =
  | {
      readonly reason: "scopeAuthorizationEpochTargetInvalid";
      readonly scopeId: ScopeId;
      readonly physicalLocator: ScopePhysicalLocator;
      readonly invalidReason:
        "requireCurrentAuthorizationRevocationEpochMissing";
    }
  | {
      readonly reason: "scopeAuthorizationEpochMissing";
      readonly scopeId: ScopeId;
      readonly physicalLocator: ScopePhysicalLocator;
    };

export class CurrentScopeAuthorizationEpochResolutionError extends Error {
  readonly _tag = "CurrentScopeAuthorizationEpochResolutionError" as const;

  constructor(
    readonly failure: CurrentScopeAuthorizationEpochResolutionFailure,
  ) {
    super(currentScopeAuthorizationEpochResolutionFailureMessage(failure));
    this.name = "CurrentScopeAuthorizationEpochResolutionError";
  }
}

export class CurrentScopeAuthorizationEpochPortError extends Data.TaggedError(
  "CurrentScopeAuthorizationEpochPortError",
)<{
  readonly operation: "authorizationEpochRead";
  readonly cause: unknown;
}> {}

export type LocatedScopeAuthorizationEpochReadError =
  | ScopeAuthorizationRevocationEpochReadError
  | CurrentScopeAuthorizationEpochPortError;

export type CurrentScopeAuthorizationEpochError =
  | TrustedScopeAuthorityError
  | CurrentScopeAuthorizationEpochResolutionError
  | CurrentScopeAuthorizationEpochPortError
  | ScopeClockCorruptionError;

/**
 * Resolves deployment -> scope -> verified physical target before reading the
 * private S07-A epoch from that exact target. The result is a point-in-time
 * authority snapshot; O03-B must recheck it inside session activation.
 */
export const resolveCurrentScopeAuthorizationEpochEffect = Effect.fn(
  "ScopeAuthorizationEpoch.resolveCurrent",
)(function* (
  deploymentId: TransactionGrantDeploymentIdV1,
  ports: CurrentScopeAuthorizationEpochResolutionPorts,
): Effect.fn.Return<
  CurrentScopeAuthorizationEpoch,
  CurrentScopeAuthorizationEpochError
> {
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    deploymentId,
    {
      scopeMetadata: ports.scopeMetadata,
      provisioningReceipts: ports.provisioningReceipts,
      scopeClockTargets: ports.scopeEpochTargets,
    },
  ).pipe(
    Effect.catchTag(
      "TrustedScopeAuthorityPortError",
      preserveLocatedClockCorruption,
    ),
  );
  const target = yield* Effect.fromResult(
    requireScopeAuthorizationEpochTargetResult(
      located.target,
      located.authority.scopeId,
      located.authority.physicalLocator,
    ),
  );
  const authorizationRevocationEpoch = yield*
    target.requireCurrentAuthorizationRevocationEpochEffect(
      located.authority.scopeId,
    ).pipe(
      Effect.catchTag("ScopeClockNotFoundError", () =>
        Effect.fail(currentEpochResolutionError({
          reason: "scopeAuthorizationEpochMissing",
          scopeId: located.authority.scopeId,
          physicalLocator: located.authority.physicalLocator,
        }))),
    );

  return Object.freeze({
    deploymentId,
    scopeId: located.authority.scopeId,
    authorizationRevocationEpoch,
  }) satisfies CurrentScopeAuthorizationEpoch;
});

function preserveLocatedClockCorruption(
  failure: TrustedScopeAuthorityPortError,
): Effect.Effect<
  never,
  TrustedScopeAuthorityPortError | ScopeClockCorruptionError
> {
  if (
    failure.operation === "scopeClockRead" &&
    failure.cause instanceof ScopeClockCorruptionError
  ) {
    return Effect.fail(failure.cause);
  }
  return Effect.fail(failure);
}

function requireScopeAuthorizationEpochTargetResult(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
  physicalLocator: ScopePhysicalLocator,
): Result.Result<
  LocatedScopeAuthorizationEpochTarget,
  CurrentScopeAuthorizationEpochResolutionError
> {
  if (!hasCurrentAuthorizationRevocationEpochReader(target)) {
    return Result.fail(currentEpochResolutionError({
      reason: "scopeAuthorizationEpochTargetInvalid",
      scopeId,
      physicalLocator,
      invalidReason: "requireCurrentAuthorizationRevocationEpochMissing",
    }));
  }
  return Result.succeed(target);
}

function hasCurrentAuthorizationRevocationEpochReader(
  target: LocatedScopeClockReader,
): target is LocatedScopeAuthorizationEpochTarget {
  return typeof Reflect.get(
    target,
    "requireCurrentAuthorizationRevocationEpochEffect",
  ) === "function";
}

function currentEpochResolutionError(
  failure: CurrentScopeAuthorizationEpochResolutionFailure,
): CurrentScopeAuthorizationEpochResolutionError {
  return new CurrentScopeAuthorizationEpochResolutionError(failure);
}

function currentScopeAuthorizationEpochResolutionFailureMessage(
  failure: CurrentScopeAuthorizationEpochResolutionFailure,
): string {
  switch (failure.reason) {
    case "scopeAuthorizationEpochTargetInvalid":
      return `Scope ${failure.scopeId} authorization-epoch target is invalid: ${failure.invalidReason}`;
    case "scopeAuthorizationEpochMissing":
      return `Current authorization epoch is missing for scope ${failure.scopeId}`;
  }
}

export function createLocatedScopeAuthorizationEpochTarget(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
): LocatedScopeAuthorizationEpochTarget {
  const capturedLocator = captureScopePhysicalLocator(physicalLocator);
  const requireCurrentAuthorizationRevocationEpochEffect = Effect.fn(
    "ScopeAuthorizationEpochTarget.requireCurrent",
  )((scopeId: ScopeId): Effect.Effect<
    TransactionAuthorizationRevocationEpoch,
    LocatedScopeAuthorizationEpochReadError
  > =>
    Effect.uninterruptible(
      Effect.tryPromise({
        try: () => db.transaction((tx) =>
          requireScopeAuthorizationRevocationEpochInTransaction(tx, scopeId)
        ),
        catch: (cause) => new CurrentScopeAuthorizationEpochPortError({
          operation: "authorizationEpochRead",
          cause,
        }),
      }),
    ).pipe(
      Effect.flatMap((result) => Effect.fromResult(result)),
    ));
  return Object.freeze({
    physicalLocator: capturedLocator,
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    requireCurrentAuthorizationRevocationEpochEffect,
  }) satisfies LocatedScopeAuthorizationEpochTarget;
}
