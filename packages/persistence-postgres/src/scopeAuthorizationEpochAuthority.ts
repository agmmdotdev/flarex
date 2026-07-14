import type {
  ScopeId,
} from "flarex-protocol/storage-authority";
import type {
  TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import type {
  TransactionAuthorizationRevocationEpoch,
} from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  resolveLocatedTrustedScopeAuthority,
  type LocatedScopeClockReader,
  type ScopeClockTargetReaderResolver,
  type ScopeMetadataReader,
  type ScopeProvisioningReceiptReader,
} from "./scopeAuthorityResolution";
import {
  getScopeClock,
  requireScopeAuthorizationRevocationEpochInTransaction,
  ScopeClockNotFoundError,
} from "./scopeClock";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";

export interface LocatedScopeAuthorizationEpochTarget
  extends LocatedScopeClockReader {
  readonly requireCurrentAuthorizationRevocationEpoch: (
    scopeId: ScopeId,
  ) => Promise<TransactionAuthorizationRevocationEpoch>;
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
  constructor(
    readonly failure: CurrentScopeAuthorizationEpochResolutionFailure,
  ) {
    super(currentScopeAuthorizationEpochResolutionFailureMessage(failure));
    this.name = "CurrentScopeAuthorizationEpochResolutionError";
  }
}

/**
 * Resolves deployment -> scope -> verified physical target before reading the
 * private S07-A epoch from that exact target. The result is a point-in-time
 * authority snapshot; O03-B must recheck it inside session activation.
 */
export async function resolveCurrentScopeAuthorizationEpoch(
  deploymentId: TransactionGrantDeploymentIdV1,
  ports: CurrentScopeAuthorizationEpochResolutionPorts,
): Promise<CurrentScopeAuthorizationEpoch> {
  const located = await resolveLocatedTrustedScopeAuthority(deploymentId, {
    scopeMetadata: ports.scopeMetadata,
    provisioningReceipts: ports.provisioningReceipts,
    scopeClockTargets: ports.scopeEpochTargets,
  });
  const target = requireScopeAuthorizationEpochTarget(
    located.target,
    located.authority.scopeId,
    located.authority.physicalLocator,
  );
  let authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
  try {
    authorizationRevocationEpoch =
      await target.requireCurrentAuthorizationRevocationEpoch(
        located.authority.scopeId,
      );
  } catch (error) {
    if (error instanceof ScopeClockNotFoundError) {
      throw currentEpochResolutionError({
        reason: "scopeAuthorizationEpochMissing",
        scopeId: located.authority.scopeId,
        physicalLocator: located.authority.physicalLocator,
      });
    }
    throw error;
  }

  return Object.freeze({
    deploymentId,
    scopeId: located.authority.scopeId,
    authorizationRevocationEpoch,
  }) satisfies CurrentScopeAuthorizationEpoch;
}

function requireScopeAuthorizationEpochTarget(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
  physicalLocator: ScopePhysicalLocator,
): LocatedScopeAuthorizationEpochTarget {
  if (!hasCurrentAuthorizationRevocationEpochReader(target)) {
    throw currentEpochResolutionError({
      reason: "scopeAuthorizationEpochTargetInvalid",
      scopeId,
      physicalLocator,
      invalidReason: "requireCurrentAuthorizationRevocationEpochMissing",
    });
  }
  return target;
}

function hasCurrentAuthorizationRevocationEpochReader(
  target: LocatedScopeClockReader,
): target is LocatedScopeAuthorizationEpochTarget {
  return typeof Reflect.get(
    target,
    "requireCurrentAuthorizationRevocationEpoch",
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
  const capturedLocator = capturePhysicalLocator(physicalLocator);
  return Object.freeze({
    physicalLocator: capturedLocator,
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    requireCurrentAuthorizationRevocationEpoch: (scopeId: ScopeId) =>
      db.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
      ),
  }) satisfies LocatedScopeAuthorizationEpochTarget;
}

function capturePhysicalLocator(
  physicalLocator: ScopePhysicalLocator,
): ScopePhysicalLocator {
  switch (physicalLocator.kind) {
    case "shared_database":
    case "schema_per_scope":
    case "database_per_scope":
      return Object.freeze({
        kind: physicalLocator.kind,
        databaseKey: physicalLocator.databaseKey,
        schemaName: physicalLocator.schemaName,
      });
  }
}
