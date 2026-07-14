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
  constructor(readonly failure: TrustedScopeAuthorityResolutionFailure) {
    super(trustedScopeAuthorityResolutionFailureMessage(failure));
    this.name = "TrustedScopeAuthorityResolutionError";
  }
}

interface ScopeAuthorityIntent {
  readonly deploymentId: ScopeMetadataRecord["deploymentId"];
  readonly scopeId: ScopeMetadataRecord["scopeId"];
  readonly physicalLocator: ScopePhysicalLocator;
}

interface UnknownLocatedScopeClockReader extends ScopeClockReader {
  readonly physicalLocator: unknown;
}

type PhysicalLocatorDecodeResult =
  | {
      readonly ok: true;
      readonly value: ScopePhysicalLocator;
    }
  | {
      readonly ok: false;
      readonly invalidReason: InvalidScopeClockTargetReason;
    };

/**
 * Resolves current data-plane authority from persisted control metadata and
 * the located scope clock. Missing or inconsistent metadata never implies the
 * legacy storage generation.
 */
export async function resolveTrustedScopeAuthority(
  deploymentId: string,
  ports: TrustedScopeAuthorityResolutionPorts,
): Promise<TrustedScopeAuthority> {
  return (
    await resolveLocatedTrustedScopeAuthority(deploymentId, ports)
  ).authority;
}

/**
 * Resolves the same trusted authority while retaining the exact validated
 * target instance selected by the placement resolver. Consumers with a richer
 * target capability can therefore perform a second authority read without
 * resolving or guessing the physical target again.
 */
export async function resolveLocatedTrustedScopeAuthority<
  Target extends LocatedScopeClockReader,
>(
  deploymentId: string,
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): Promise<LocatedTrustedScopeAuthority<Target>> {
  const scope =
    await ports.scopeMetadata.getScopeMetadataByDeploymentId(deploymentId);
  if (scope === null) {
    throw resolutionError({ reason: "scopeMetadataMissing", deploymentId });
  }
  const intent = captureScopeAuthorityIntent(scope);
  if (intent.deploymentId !== deploymentId) {
    throw resolutionError({
      reason: "scopeDeploymentMismatch",
      deploymentId,
      scopeId: intent.scopeId,
      actualDeploymentId: intent.deploymentId,
    });
  }

  switch (intent.physicalLocator.kind) {
    case "shared_database":
      return resolveScopeAuthorityAtTarget(
        intent,
        intent.physicalLocator,
        ports,
      );
    case "schema_per_scope":
    case "database_per_scope":
      return resolveSplitScopeAuthority(
        intent,
        intent.physicalLocator,
        ports,
      );
  }
}

async function resolveSplitScopeAuthority<
  Target extends LocatedScopeClockReader,
>(
  intent: ScopeAuthorityIntent,
  expectedLocator: SplitScopePhysicalLocator,
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): Promise<LocatedTrustedScopeAuthority<Target>> {
  const receipt =
    await ports.provisioningReceipts.getScopeAuthorityProvisioningReceipt(
      intent.scopeId,
    );
  if (receipt === null) {
    throw resolutionError({
      reason: "splitProvisioningReceiptMissing",
      scopeId: intent.scopeId,
    });
  }
  if (receipt.scopeId !== intent.scopeId) {
    throw resolutionError({
      reason: "splitProvisioningReceiptScopeMismatch",
      scopeId: intent.scopeId,
      actualScopeId: receipt.scopeId,
    });
  }
  if (receipt.state !== "ready") {
    throw resolutionError({
      reason: "splitProvisioningReceiptNotReady",
      scopeId: intent.scopeId,
      actualState: receipt.state,
    });
  }
  const receiptLocator = captureSplitPhysicalLocator(receipt.physicalLocator);
  if (!physicalLocatorsEqual(expectedLocator, receiptLocator)) {
    throw resolutionError({
      reason: "splitProvisioningReceiptPlacementMismatch",
      scopeId: intent.scopeId,
      expected: expectedLocator,
      actual: receiptLocator,
    });
  }

  return resolveScopeAuthorityAtTarget(intent, expectedLocator, ports);
}

async function resolveScopeAuthorityAtTarget<
  Target extends LocatedScopeClockReader,
>(
  intent: ScopeAuthorityIntent,
  expectedLocator: ScopePhysicalLocator,
  ports: TrustedScopeAuthorityResolutionPorts<Target>,
): Promise<LocatedTrustedScopeAuthority<Target>> {
  let unresolvedTarget: Target;
  try {
    unresolvedTarget = await ports.scopeClockTargets.resolve(expectedLocator);
  } catch (resolutionCause) {
    throw resolutionError({
      reason: "scopeClockTargetResolutionFailed",
      scopeId: intent.scopeId,
      physicalLocator: expectedLocator,
      resolutionCause,
    });
  }
  const target = requireScopeClockTarget(unresolvedTarget, intent.scopeId);
  const decodedLocator = decodePhysicalLocator(target.physicalLocator);
  if (!decodedLocator.ok) {
    throw resolutionError({
      reason: "scopeClockTargetInvalid",
      scopeId: intent.scopeId,
      invalidReason: decodedLocator.invalidReason,
    });
  }
  const actualLocator = decodedLocator.value;
  if (!physicalLocatorsEqual(expectedLocator, actualLocator)) {
    throw resolutionError({
      reason: "scopeClockTargetPlacementMismatch",
      scopeId: intent.scopeId,
      expected: expectedLocator,
      actual: actualLocator,
    });
  }

  return Object.freeze({
    authority: trustedAuthority(
      intent,
      expectedLocator,
      await target.getCurrentClock(intent.scopeId),
    ),
    target,
  }) satisfies LocatedTrustedScopeAuthority<Target>;
}

function trustedAuthority(
  intent: ScopeAuthorityIntent,
  physicalLocator: ScopePhysicalLocator,
  clock: ScopeClockRecord | null,
): TrustedScopeAuthority {
  if (clock === null) {
    throw resolutionError({
      reason: "scopeClockMissing",
      scopeId: intent.scopeId,
      physicalLocator,
    });
  }
  if (clock.scopeId !== intent.scopeId) {
    throw resolutionError({
      reason: "scopeClockScopeMismatch",
      scopeId: intent.scopeId,
      actualScopeId: clock.scopeId,
      physicalLocator,
    });
  }
  return Object.freeze({
    deploymentId: intent.deploymentId,
    scopeId: intent.scopeId,
    physicalLocator,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
    lastCommitSeq: clock.lastCommitSeq,
    lastOutboxSeq: clock.lastOutboxSeq,
  }) satisfies TrustedScopeAuthority;
}

function resolutionError(
  failure: TrustedScopeAuthorityResolutionFailure,
): TrustedScopeAuthorityResolutionError {
  return new TrustedScopeAuthorityResolutionError(failure);
}

function physicalLocatorsEqual(
  left: ScopePhysicalLocator,
  right: ScopePhysicalLocator,
): boolean {
  return (
    left.kind === right.kind &&
    left.databaseKey === right.databaseKey &&
    left.schemaName === right.schemaName
  );
}

function captureScopeAuthorityIntent(
  scope: ScopeMetadataRecord,
): ScopeAuthorityIntent {
  return Object.freeze({
    deploymentId: scope.deploymentId,
    scopeId: scope.scopeId,
    physicalLocator: capturePhysicalLocator(scope.physicalLocator),
  }) satisfies ScopeAuthorityIntent;
}

function requireScopeClockTarget<Target extends LocatedScopeClockReader>(
  value: Target,
  scopeId: ScopeId,
): Target {
  if (!isUnknownRecord(value)) {
    throw resolutionError({
      reason: "scopeClockTargetInvalid",
      scopeId,
      invalidReason: "targetNotObject",
    });
  }
  if (!hasGetCurrentClock(value)) {
    throw resolutionError({
      reason: "scopeClockTargetInvalid",
      scopeId,
      invalidReason: "getCurrentClockMissing",
    });
  }
  return value;
}

function decodePhysicalLocator(value: unknown): PhysicalLocatorDecodeResult {
  if (!isUnknownRecord(value)) {
    return { ok: false, invalidReason: "locatorNotObject" };
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("kind") ||
    !keys.includes("databaseKey") ||
    !keys.includes("schemaName")
  ) {
    return { ok: false, invalidReason: "locatorUnexpectedFields" };
  }
  if (
    typeof value.databaseKey !== "string" ||
    value.databaseKey.trim().length === 0
  ) {
    return { ok: false, invalidReason: "locatorDatabaseKeyInvalid" };
  }
  if (
    typeof value.schemaName !== "string" ||
    value.schemaName.trim().length === 0
  ) {
    return { ok: false, invalidReason: "locatorSchemaNameInvalid" };
  }

  switch (value.kind) {
    case "shared_database":
      return {
        ok: true,
        value: Object.freeze({
          kind: value.kind,
          databaseKey: value.databaseKey,
          schemaName: value.schemaName,
        }),
      };
    case "schema_per_scope":
      return {
        ok: true,
        value: Object.freeze({
          kind: value.kind,
          databaseKey: value.databaseKey,
          schemaName: value.schemaName,
        }),
      };
    case "database_per_scope":
      return {
        ok: true,
        value: Object.freeze({
          kind: value.kind,
          databaseKey: value.databaseKey,
          schemaName: value.schemaName,
        }),
      };
    default:
      return { ok: false, invalidReason: "locatorKindUnsupported" };
  }
}

function isUnknownRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasGetCurrentClock(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & UnknownLocatedScopeClockReader {
  return typeof value.getCurrentClock === "function";
}

function capturePhysicalLocator(
  locator: ScopePhysicalLocator,
): ScopePhysicalLocator {
  switch (locator.kind) {
    case "shared_database":
      return Object.freeze({
        kind: locator.kind,
        databaseKey: locator.databaseKey,
        schemaName: locator.schemaName,
      });
    case "schema_per_scope":
      return Object.freeze({
        kind: locator.kind,
        databaseKey: locator.databaseKey,
        schemaName: locator.schemaName,
      });
    case "database_per_scope":
      return Object.freeze({
        kind: locator.kind,
        databaseKey: locator.databaseKey,
        schemaName: locator.schemaName,
      });
  }
}

function captureSplitPhysicalLocator(
  locator: SplitScopePhysicalLocator,
): SplitScopePhysicalLocator {
  switch (locator.kind) {
    case "schema_per_scope":
      return Object.freeze({
        kind: locator.kind,
        databaseKey: locator.databaseKey,
        schemaName: locator.schemaName,
      });
    case "database_per_scope":
      return Object.freeze({
        kind: locator.kind,
        databaseKey: locator.databaseKey,
        schemaName: locator.schemaName,
      });
  }
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
