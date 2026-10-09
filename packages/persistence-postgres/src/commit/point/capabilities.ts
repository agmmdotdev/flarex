import type {
  PointFiniteCommitCommand,
  PointFiniteAttemptResolutionCommand,
  PointFiniteCommitPublisherPort,
  PointCommitRollbackProofPortV1,
  RunningRelationConflictRequestEvidenceV1,
  RunningRelationConflictEvidenceV1,
} from "./contracts";
import type { FiniteAttemptNonacceptanceProof } from "../../execution/finiteAttemptAnchor";
import { PointMutationAttemptReplacementFiniteEntryError } from "./errors";
import type { PointFiniteTerminalRefusal } from "./errors";
import type { AppUniqueConstraintSetEligibilityPortV1 } from "../../storage/unique/appUniqueConstraintSetBuildV1";

const finitePublishers = new WeakSet<object>();

const finiteSettlementRefusals = new WeakMap<
  object,
  Readonly<{ kind: "publication"; command: PointFiniteCommitCommand }>
  | Readonly<{
      kind: "replacement";
      command: PointFiniteAttemptResolutionCommand;
      proof: FiniteAttemptNonacceptanceProof
    }>
>();

export function isPointFiniteReplacementTerminalRefusal(
  failure: unknown,
  command: PointFiniteAttemptResolutionCommand,
  proof: FiniteAttemptNonacceptanceProof
): failure is PointMutationAttemptReplacementFiniteEntryError {
  if (!(failure instanceof PointMutationAttemptReplacementFiniteEntryError))
    return false;
  const emitted = finiteSettlementRefusals.get(failure);
  return emitted?.kind === "replacement" &&
    emitted.proof === proof &&
    emitted.command.authorityPins === command.authorityPins &&
    emitted.command.session === command.session &&
    emitted.command.executionClaim === command.executionClaim;
}

export const isPointFiniteCommitPublisherPort = (
  candidate: unknown
): candidate is PointFiniteCommitPublisherPort =>
  typeof candidate === "object" &&
  candidate !== null &&
  finitePublishers.has(candidate);

export const recoveredRunningRelationConflictEvidenceBrand: unique symbol =
  Symbol("FlarexPersistence/RecoveredRunningRelationConflictEvidence",);

export interface RecoveredRunningRelationConflictEvidence {
  readonly [recoveredRunningRelationConflictEvidenceBrand]: true;
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
}

const pointCommitDeveloperIndexMaintenancePortsV1 = new WeakSet<object>();

const pointCommitUniqueConstraintMaintenancePortsV1 = new WeakSet<object>();

const pointCommitApplicationRelationMaintenancePorts = new WeakSet<object>();

const pointCommitUniqueConstraintEligibilityPortsV1 = new WeakMap<
  object,
  AppUniqueConstraintSetEligibilityPortV1
>();

export function hasPointCommitApplicationRelationMaintenance(
  value: unknown,
): boolean {
  return typeof value === "object" &&
    value !== null &&
    pointCommitApplicationRelationMaintenancePorts.has(value);
}

export function hasPointCommitDeveloperIndexMaintenanceV1(
  value: unknown,
): boolean {
  return typeof value === "object" &&
    value !== null &&
    pointCommitDeveloperIndexMaintenancePortsV1.has(value);
}

export function hasPointCommitUniqueConstraintMaintenanceV1(
  value: unknown,
): boolean {
  return typeof value === "object" &&
    value !== null &&
    pointCommitUniqueConstraintMaintenancePortsV1.has(value);
}

export function hasPointCommitUniqueConstraintEligibilityV1(
  value: unknown,
): boolean {
  return typeof value === "object" &&
    value !== null &&
    pointCommitUniqueConstraintEligibilityPortsV1.has(value);
}

/** Called only after the constructor's original composition checks. */
export function registerFinitePointCommitPublisher(
  port: PointFiniteCommitPublisherPort,
): void {
  finitePublishers.add(port);
}

export function recordFinitePublicationTerminalRefusal(
  error: PointFiniteTerminalRefusal,
  command: PointFiniteCommitCommand,
): void {
  finiteSettlementRefusals.set(error, { kind: "publication", command });
}

export function recordFiniteReplacementTerminalRefusal(
  error: PointMutationAttemptReplacementFiniteEntryError,
  command: PointFiniteAttemptResolutionCommand,
  proof: FiniteAttemptNonacceptanceProof,
): void {
  finiteSettlementRefusals.set(error, { kind: "replacement", command, proof });
}

export function findFiniteSettlementRefusal(error: PointFiniteTerminalRefusal) {
  return finiteSettlementRefusals.get(error);
}

export function registerDeveloperIndexMaintenance(
  port: PointCommitRollbackProofPortV1,
): void {
  pointCommitDeveloperIndexMaintenancePortsV1.add(port);
}

export function registerUniqueConstraintMaintenance(
  port: PointCommitRollbackProofPortV1,
): void {
  pointCommitUniqueConstraintMaintenancePortsV1.add(port);
}

export function registerApplicationRelationMaintenance(
  port: PointCommitRollbackProofPortV1,
): void {
  pointCommitApplicationRelationMaintenancePorts.add(port);
}

export function registerUniqueConstraintEligibility(
  port: PointCommitRollbackProofPortV1,
  eligibility: AppUniqueConstraintSetEligibilityPortV1,
): void {
  pointCommitUniqueConstraintEligibilityPortsV1.set(port, eligibility);
}

export function findPointCommitUniqueConstraintEligibility(
  // oxlint-disable-next-line flarex/no-object-parameters -- REVIEW: authority - this source-only WeakMap lookup takes an already guarded object identity; callers retain their original typeof/null checks and authentication comes from the singular registry.
  port: object,
) {
  return pointCommitUniqueConstraintEligibilityPortsV1.get(port);
}
