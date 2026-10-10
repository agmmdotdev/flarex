import { type TransactionExecutionClaimObservationV1 } from "../../../../src/execution/claims/transactionExecutionClaimModel";
import type {
  PointMutationSessionActivationPersistenceV1,
  PointMutationSessionActivationResultV1,
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptLoadPersistenceV1,
  PointMutationSessionAttemptLoadResultV1,
  PointMutationSessionAttemptAbortInputV1,
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationPersistenceV1,
  PointMutationSessionAttemptTerminalizationResultV1,
  PreparedPointMutationSessionActivationV1,
} from "../../../../src/execution/session/contracts";
import { runEffect } from "../../../support/effectTestRuntime";

const executionClaimsByAttempt = new Map<
  string,
  TransactionExecutionClaimObservationV1
>();

/** Explicit test runtime boundary for the Effect-native activation port. */
export async function activatePointMutationSession(
  persistence: PointMutationSessionActivationPersistenceV1,
  input: PreparedPointMutationSessionActivationV1,
): Promise<PointMutationSessionActivationResultV1> {
  const result = await runEffect(persistence.activateEffect(input));
  if (result.status === "created") {
    executionClaimsByAttempt.set(
      executionClaimAttemptKey(result.anchor),
      result.executionClaim,
    );
  }
  return result;
}

/** Records the actual owner-decoded claim from a trusted primitive storage fixture. */
export function rememberPrimitiveActivationClaim(anchor: PointMutationSessionAnchorV1, claim: TransactionExecutionClaimObservationV1): void {
  executionClaimsByAttempt.set(executionClaimAttemptKey(anchor), claim);
}

/** Returns only the exact server-created claim captured with this fixture. */
export function executionClaimForAnchor(
  anchor: PointMutationSessionAnchorV1,
): TransactionExecutionClaimObservationV1 {
  const claim = executionClaimsByAttempt.get(executionClaimAttemptKey(anchor));
  if (claim === undefined) {
    throw new Error("Execution-claim fixture evidence is missing.");
  }
  return claim;
}

/** Explicit test runtime boundary for the Effect-native attempt-load port. */
export function loadPointMutationSessionAttempt(
  persistence: PointMutationSessionAttemptLoadPersistenceV1,
  selector: PointMutationSessionAttemptSelectorV1,
): Promise<PointMutationSessionAttemptLoadResultV1> {
  return runEffect(persistence.loadEffect(selector));
}

/** Explicit test runtime boundary for the Effect-native attempt terminalizer. */
export function abortPointMutationSessionAttempt(
  persistence: PointMutationSessionAttemptTerminalizationPersistenceV1,
  input: PointMutationSessionAttemptAbortInputV1,
): Promise<PointMutationSessionAttemptTerminalizationResultV1> {
  return runEffect(persistence.abortEffect(input));
}

/** Explicit test runtime boundary for the Effect-native attempt terminalizer. */
export function expirePointMutationSessionAttempt(
  persistence: PointMutationSessionAttemptTerminalizationPersistenceV1,
  selector: PointMutationSessionAttemptSelectorV1,
): Promise<PointMutationSessionAttemptTerminalizationResultV1> {
  return runEffect(persistence.expireEffect(selector));
}

function executionClaimAttemptKey(anchor: PointMutationSessionAnchorV1): string {
  return [
    anchor.deploymentId,
    anchor.scopeId,
    anchor.sessionId,
    anchor.attemptFence.toString(),
  ].join("\u0000");
}
