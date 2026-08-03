#!/usr/bin/env node
// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const suiteRelativePath =
  "integration/durable-task-compatibility/scenarios/v1/run-attempt-lifecycle.json";
const divergencesRelativePath =
  "integration/durable-task-compatibility/divergences/v1.json";
const sourceMapRelativePath =
  "roadmaps/durable-task-engine/preflight/source-map.run-attempt-v1.json";

const expectedSuiteVersion = "flarex.run-attempt-vector-suite.v1";
const expectedScenarioVersion = "flarex.run-attempt-scenario.v1";
const expectedReceiptVersion = "flarex.run-attempt-receipt.v1";
const expectedDivergenceVersion = "flarex.run-attempt-divergences.v1";
const expectedUpstreamCommit = "f10bc23785e569e5d917318cf2033aabdbe96a0b";
const expectedSymbolicEpochMs = 2_000_000_000_000;
const suiteKeys = new Set([
  "schemaVersion",
  "scenarioVersion",
  "receiptVersion",
  "upstreamCommit",
  "symbolicEpochMs",
  "inspectionCases",
  "effectCursorCases",
  "replayLinks",
  "vectors",
]);
const divergenceManifestKeys = new Set(["schemaVersion", "upstreamCommit", "differences"]);
const divergenceKeys = new Set(["scenarioId", "jsonPointer", "trigger", "flarex", "rationale", "owner"]);
const inspectionCaseKeys = new Set(["id", "projection"]);
const effectCursorCaseKeys = new Set(["scenarioId", "priorEffectCursor", "resultingEffectCursor"]);
const replayLinkKeys = new Set(["scenarioId", "originalScenarioId"]);
const effectKeys = new Set(["sequence", "kind"]);

const classifications = new Set([
  "parity",
  "flarex-authority",
  "outside-first-vertical",
]);
const phases = new Set([
  "ready",
  "attempt_granted",
  "executing",
  "retry_waiting",
  "terminal",
]);
const cancellations = new Set(["not_requested", "requested", "resolved"]);
const inspectionCaseContracts = new Map([
  ["ready-initial", ["ready", "initial", "not_requested", null, null]],
  ["ready-immediate-retry", ["ready", "immediate_retry", "not_requested", null, null]],
  ["attempt-granted", ["attempt_granted", "active_pre_heartbeat", "not_requested", null, null]],
  ["attempt-granted-pending-cancellation", ["attempt_granted", "active_pre_heartbeat", "requested", null, null]],
  ["executing", ["executing", "active_executing", "not_requested", null, null]],
  ["executing-pending-cancellation", ["executing", "active_executing", "requested", null, null]],
  ["retry-waiting", ["retry_waiting", "durable_retry", "not_requested", null, null]],
  ["terminal-succeeded", ["terminal", "terminal_succeeded", "not_requested", "succeeded", null]],
  ["terminal-failed", ["terminal", "terminal_failed", "not_requested", "failed", null]],
  ["terminal-succeeded-after-cancellation-request", ["terminal", "terminal_succeeded", "resolved", "succeeded", "superseded_by_completion"]],
  ["terminal-failed-after-cancellation-request", ["terminal", "terminal_failed", "resolved", "failed", "superseded_by_completion"]],
  ["terminal-cancelled-without-attempt", ["terminal", "terminal_cancelled", "resolved", "cancelled", "without_active_attempt"]],
  ["terminal-cancelled-acknowledged", ["terminal", "terminal_cancelled", "resolved", "cancelled", "acknowledged"]],
  ["terminal-cancelled-lease-expired", ["terminal", "terminal_cancelled", "resolved", "cancelled", "lease_expired"]],
]);
const inspectionProjectionKeys = new Set([
  "version",
  "observedAtMs",
  "stateVersion",
  "runId",
  "taskDefinitionRevisionId",
  "runVersion",
  "phase",
  "stateVariant",
  "cancellationKind",
  "cancellationGeneration",
  "attemptNumber",
  "leaseVersion",
  "heartbeatSequence",
  "eligibleAtMs",
  "retryNotBeforeMs",
  "retryCause",
  "terminalKind",
  "cancellationResolution",
  "resultCommitment",
  "failureClass",
]);
const operations = new Set([
  "startAttempt",
  "heartbeatAttempt",
  "completeAttempt",
  "requestCancellation",
  "handleLeaseExpiry",
  "inspectCurrentAttempt",
]);
const dispositions = new Set(["accepted", "idempotent", "current"]);
const vectorKeys = new Set(["id", "classification", "sourceEntryIndexes", "coverage", "initial", "command", "expected"]);
const initialKeys = new Set(["phase", "cancellation", "runVersion", "stateVariant"]);
const commandKeys = new Set(["operation", "identity"]);
const receiptExpectationKeys = new Set([
  "kind",
  "disposition",
  "outcomeKind",
  "currentReason",
  "transition",
  "acceptedRunVersion",
  "recordedAtMs",
  "evidenceKinds",
  "effects",
  "policy",
]);
const errorExpectationKeys = new Set([
  "kind",
  "errorTag",
  "safeReason",
  "transition",
  "acceptedRunVersion",
  "recordedAtMs",
  "evidenceKinds",
  "effects",
]);
const acceptedPolicyKeys = new Set([
  "decision",
  "eligibility",
  "delivery",
  "delaySource",
  "jitterUsed",
  "computeEscalated",
]);
const rejectedPolicyKeys = new Set([
  "decision",
  "reason",
  "terminalClassification",
]);
const retryCauses = new Set([
  "failed_completion",
  "lease_expired_before_heartbeat",
  "lease_expired_after_heartbeat",
]);
const terminalFailureClasses = new Set([
  "task_failure",
  "system_failure",
  "resource_exhaustion",
  "timed_out",
]);

const outcomeKindsByOperation = new Map([
  ["startAttempt", new Set(["attempt_granted", "current"])],
  ["heartbeatAttempt", new Set(["lease_renewed", "current"])],
  [
    "completeAttempt",
    new Set([
      "terminal_succeeded",
      "retry_scheduled",
      "terminal_failed",
      "terminal_cancelled",
      "current",
    ]),
  ],
  [
    "requestCancellation",
    new Set(["cancellation_requested", "terminal_cancelled", "current"]),
  ],
  [
    "handleLeaseExpiry",
    new Set([
      "retry_scheduled",
      "terminal_failed",
      "terminal_cancelled",
      "current",
    ]),
  ],
]);

const currentReasonsByOperation = new Map([
  [
    "startAttempt",
    new Set(["stale_run_version", "not_yet_eligible", "phase_not_startable"]),
  ],
  [
    "heartbeatAttempt",
    new Set([
      "phase_not_active",
      "stale_attempt",
      "stale_fence",
      "lease_expired",
      "heartbeat_not_advanced",
    ]),
  ],
  [
    "completeAttempt",
    new Set(["phase_not_active", "stale_attempt", "stale_fence", "lease_expired"]),
  ],
  ["requestCancellation", new Set(["already_requested", "already_terminal"])],
  [
    "handleLeaseExpiry",
    new Set([
      "phase_not_active",
      "stale_attempt",
      "stale_fence",
      "stale_lease_version",
      "lease_not_expired",
    ]),
  ],
]);

const transitionPlans = new Map([
  ["start_grant", ["attempt_granted", ["dispatch_attempt", "wake_lease_expiry", "publish_lifecycle_event", "notify_current_state"]]],
  ["first_heartbeat", ["heartbeat_accepted", ["cancel_obsolete_lease_wake", "wake_lease_expiry", "publish_lifecycle_event", "notify_current_state"]]],
  ["later_heartbeat", ["heartbeat_accepted", ["cancel_obsolete_lease_wake", "wake_lease_expiry", "notify_current_state"]]],
  ["active_cancellation_request", ["cancellation_requested", ["request_execution_cancellation", "publish_lifecycle_event", "notify_current_state"]]],
  ["cancellation_without_attempt", ["cancellation_resolved_without_attempt", ["publish_lifecycle_event", "notify_current_state"]]],
  ["completion_succeeded", ["completion_succeeded", ["cancel_obsolete_lease_wake", "release_queue_ownership", "publish_lifecycle_event", "notify_current_state"]]],
  ["completion_retry_immediate", ["completion_failed", ["cancel_obsolete_lease_wake", "release_queue_ownership", "continue_retry", "publish_lifecycle_event", "notify_current_state"]]],
  ["completion_retry_durable", ["completion_failed", ["cancel_obsolete_lease_wake", "release_queue_ownership", "wake_retry", "publish_lifecycle_event", "notify_current_state"]]],
  ["completion_terminal_failed", ["completion_failed", ["cancel_obsolete_lease_wake", "release_queue_ownership", "publish_lifecycle_event", "notify_current_state"]]],
  ["completion_cancellation_acknowledged", ["completion_cancellation_acknowledged", ["cancel_obsolete_lease_wake", "release_queue_ownership", "publish_lifecycle_event", "notify_current_state"]]],
  ["lease_expiry_retry", ["lease_expiry_recovered", ["release_queue_ownership", "wake_retry", "publish_lifecycle_event", "notify_current_state"]]],
  ["lease_expiry_terminal_failed", ["lease_expiry_recovered", ["release_queue_ownership", "publish_lifecycle_event", "notify_current_state"]]],
  ["lease_expiry_cancelled", ["lease_expiry_cancelled", ["release_queue_ownership", "publish_lifecycle_event", "notify_current_state"]]],
]);

const transitionContracts = new Map([
  ["start_grant", ["startAttempt", "attempt_granted"]],
  ["first_heartbeat", ["heartbeatAttempt", "lease_renewed"]],
  ["later_heartbeat", ["heartbeatAttempt", "lease_renewed"]],
  ["active_cancellation_request", ["requestCancellation", "cancellation_requested"]],
  ["cancellation_without_attempt", ["requestCancellation", "terminal_cancelled"]],
  ["completion_succeeded", ["completeAttempt", "terminal_succeeded"]],
  ["completion_retry_immediate", ["completeAttempt", "retry_scheduled"]],
  ["completion_retry_durable", ["completeAttempt", "retry_scheduled"]],
  ["completion_terminal_failed", ["completeAttempt", "terminal_failed"]],
  ["completion_cancellation_acknowledged", ["completeAttempt", "terminal_cancelled"]],
  ["lease_expiry_retry", ["handleLeaseExpiry", "retry_scheduled"]],
  ["lease_expiry_terminal_failed", ["handleLeaseExpiry", "terminal_failed"]],
  ["lease_expiry_cancelled", ["handleLeaseExpiry", "terminal_cancelled"]],
]);

const errorTags = new Set([
  "InvalidRunAttemptCommandError",
  "InvalidRunAttemptTransitionError",
  "StaleTaskRunVersionError",
  "StaleTaskExecutionFenceError",
  "ConflictingTaskAttemptCompletionError",
  "InvalidTaskCancellationAcknowledgementError",
  "TaskRunAttemptPolicyError",
  "TaskRunAttemptCounterExhaustedError",
  "TaskSystemRunAttemptUnavailableError",
  "TaskSystemRunAttemptCorruptionError",
  "TaskSystemRunAttemptStaleScopeAuthorityError",
  "TaskSystemRunAttemptTransientStoreError",
  "TaskSystemRunAttemptTerminalStoreError",
]);

const safeReasonsByErrorTag = new Map([
  ["InvalidRunAttemptCommandError", new Set(["invalid_command_without_raw_input", "outside_run_attempt_lifecycle_v1"])],
  ["InvalidRunAttemptTransitionError", new Set(["invalid_proposed_transition"])],
  ["StaleTaskRunVersionError", new Set(["invalid_accepted_run_version_basis"])],
  ["StaleTaskExecutionFenceError", new Set(["invalid_accepted_execution_fence"])],
  ["ConflictingTaskAttemptCompletionError", new Set(["completion_identity_conflict"])],
  ["InvalidTaskCancellationAcknowledgementError", new Set(["cancellation_not_requested", "generation_mismatch"])],
  ["TaskRunAttemptPolicyError", new Set(["invalid_or_overflowing_policy"])],
  ["TaskRunAttemptCounterExhaustedError", new Set(["requested_effect_sequence_exhausted"])],
  ["TaskSystemRunAttemptUnavailableError", new Set(["unavailable"])],
  ["TaskSystemRunAttemptCorruptionError", new Set(["invalid_aggregate", "completion_replay_invalid", "evidence_invalid", "effect_sequence_invalid"])],
  ["TaskSystemRunAttemptStaleScopeAuthorityError", new Set(["stale_scope_authority"])],
  ["TaskSystemRunAttemptTransientStoreError", new Set(["serialization_or_connection"])],
  ["TaskSystemRunAttemptTerminalStoreError", new Set(["constraint_or_configuration"])],
]);

const retryRejectionReasons = new Set([
  "cancellation_requested",
  "directive_do_not_retry",
  "attempt_limit_reached",
  "failure_never_retry",
  "oom_escalation_disabled",
  "oom_target_not_different",
]);

const requiredCoverage = new Set([
  "competing-start",
  "duplicate-start",
  "immediate-retry-then-success",
  "durable-retry",
  "no-retries-remaining",
  "non-retryable-failure",
  "oom-escalation",
  "oom-exhaustion",
  "executing-worker-loss",
  "pre-start-worker-loss",
  "pending-cancellation-acknowledgement",
  "pending-cancellation-expiry",
  "stale-heartbeat",
  "stale-lease-wake",
  "completion-expiry-race",
  "identical-completion-redelivery",
  "conflicting-completion-redelivery",
  "completion-replay-after-retry",
  "completion-replay-after-later-attempt",
  "failure-message-only-redelivery",
  "invalid-ack-no-request",
  "invalid-ack-wrong-generation",
  "inspection-all-phases",
  "inspection-cancellation-variants",
  "first-heartbeat-effects",
  "later-heartbeat-effects",
  "cancellation-suppresses-retry",
  "lease-recovery-keeps-current-wake",
  "effect-first-sequence",
  "effect-contiguity",
  "effect-replay-stability",
  "effect-sequence-overflow",
  "aggregate-acceptance-effect-cursor-agreement",
  "malformed-persisted-state",
  "malformed-completion-replay",
  "malformed-transition-evidence",
  "malformed-effect-sequence",
  "unavailable-scope-indistinguishability",
  "transient-store-no-partial-commit",
  "terminal-store-no-partial-commit",
  "command-redaction",
  "store-cause-redaction",
  "removed-trigger-fields-absent",
  "effect-delivery-not-authority",
  "database-time-authority",
  "retry-jitter-used",
  "override-delay-no-jitter",
  "forced-durable-failure-code",
  "durable-threshold",
]);

const forbiddenFieldNames = new Set([
  "organizationId",
  "projectId",
  "runtimeEnvironmentId",
  "deploymentId",
  "queueId",
  "workerId",
  "machineId",
  "redisKey",
  "prisma",
  "drizzle",
  "stack",
  "rawCause",
  "payload",
  "result",
  "metadata",
]);

if (isCliEntrypoint()) {
  const report = inspectDurableTaskLifecycleVectorsRepository(process.cwd());
  if (report.errors.length > 0) {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Durable task lifecycle vector check passed (${report.vectorCount} vectors, ${report.divergenceCount} named differences).`,
    );
  }
}

/**
 * @param {string} repoRoot
 * @returns {{ errors: string[]; vectorCount: number; divergenceCount: number }}
 */
export function inspectDurableTaskLifecycleVectorsRepository(repoRoot) {
  /** @type {string[]} */
  const errors = [];
  const suite = readJson(path.join(repoRoot, suiteRelativePath), suiteRelativePath, errors);
  const divergences = readJson(
    path.join(repoRoot, divergencesRelativePath),
    divergencesRelativePath,
    errors,
  );
  const sourceMap = readJson(
    path.join(repoRoot, sourceMapRelativePath),
    sourceMapRelativePath,
    errors,
  );
  if (errors.length > 0) return { errors, vectorCount: 0, divergenceCount: 0 };
  return analyzeDurableTaskLifecycleVectors({ suite, divergences, sourceMap });
}

/**
 * @param {{ suite: unknown; divergences: unknown; sourceMap: unknown }} input
 * @returns {{ errors: string[]; vectorCount: number; divergenceCount: number }}
 */
export function analyzeDurableTaskLifecycleVectors(input) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(input.suite)) {
    return { errors: ["vector suite must be an object."], vectorCount: 0, divergenceCount: 0 };
  }
  if (!isRecord(input.divergences)) {
    return { errors: ["divergence manifest must be an object."], vectorCount: 0, divergenceCount: 0 };
  }
  if (!isRecord(input.sourceMap) || !Array.isArray(input.sourceMap.entries)) {
    return { errors: ["source map must contain an entries array."], vectorCount: 0, divergenceCount: 0 };
  }

  const suite = input.suite;
  const divergences = input.divergences;
  checkExactKeys(suite, suiteKeys, "vector suite", errors);
  checkExactKeys(divergences, divergenceManifestKeys, "divergence manifest", errors);
  checkExactString(suite.schemaVersion, expectedSuiteVersion, "vector suite schemaVersion", errors);
  checkExactString(suite.scenarioVersion, expectedScenarioVersion, "vector suite scenarioVersion", errors);
  checkExactString(suite.receiptVersion, expectedReceiptVersion, "vector suite receiptVersion", errors);
  checkExactString(suite.upstreamCommit, expectedUpstreamCommit, "vector suite upstreamCommit", errors);
  if (suite.symbolicEpochMs !== expectedSymbolicEpochMs) {
    errors.push(`vector suite symbolicEpochMs must be ${expectedSymbolicEpochMs}.`);
  }
  checkExactString(divergences.schemaVersion, expectedDivergenceVersion, "divergence schemaVersion", errors);
  checkExactString(divergences.upstreamCommit, expectedUpstreamCommit, "divergence upstreamCommit", errors);
  if (input.sourceMap.upstreamCommit !== expectedUpstreamCommit) {
    errors.push("source map upstreamCommit must match the lifecycle vector commit.");
  }

  const divergenceByScenario = validateDivergences(divergences.differences, errors);
  if (!Array.isArray(suite.inspectionCases)) {
    errors.push("vector suite inspectionCases must be an array.");
  } else {
    validateInspectionCases(suite.inspectionCases, errors);
  }
  if (!Array.isArray(suite.vectors) || suite.vectors.length === 0) {
    errors.push("vector suite vectors must be a nonempty array.");
    return {
      errors,
      vectorCount: 0,
      divergenceCount: countDivergences(divergences.differences),
    };
  }

  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Map<string, Record<string, unknown>>} */
  const vectorsById = new Map();
  /** @type {Set<string>} */
  const observedCoverage = new Set();
  /** @type {Map<string, Set<string>>} */
  const observedCurrentReasons = new Map(
    [...currentReasonsByOperation.keys()].map((operation) => [operation, new Set()]),
  );
  /** @type {Set<string>} */
  const observedTransitions = new Set();
  /** @type {Set<string>} */
  const observedRetryRejections = new Set();

  for (const [index, vector] of suite.vectors.entries()) {
    const label = `vectors[${index}]`;
    if (!isRecord(vector)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    checkExactKeys(vector, vectorKeys, label, errors);
    const id = vector.id;
    if (!isSlug(id)) errors.push(`${label}.id must be a lowercase stable slug.`);
    else if (ids.has(id)) errors.push(`${label}.id duplicates ${id}.`);
    else {
      ids.add(id);
      vectorsById.set(id, vector);
    }

    if (typeof vector.classification !== "string" || !classifications.has(vector.classification)) {
      errors.push(`${label}.classification is not admitted.`);
    }
    validateSourceRefs(vector.sourceEntryIndexes, input.sourceMap.entries, vector.classification, label, errors);
    if (!isNonemptyStringArray(vector.coverage)) {
      errors.push(`${label}.coverage must be a nonempty unique string array.`);
    } else {
      for (const coverage of vector.coverage) observedCoverage.add(coverage);
    }
    validateInitial(vector.initial, label, errors);
    validateCommand(vector.command, label, errors);
    validateExpected(vector, label, observedCurrentReasons, observedTransitions, observedRetryRejections, errors);
    validateForbiddenFields(vector, label, errors);

    const namedDifferences = typeof id === "string" ? divergenceByScenario.get(id) ?? [] : [];
    if (vector.classification === "parity" && namedDifferences.length > 0) {
      errors.push(`${label} parity vector must not have a named divergence.`);
    }
    if (
      (vector.classification === "flarex-authority" || vector.classification === "outside-first-vertical")
      && namedDifferences.length === 0
    ) {
      errors.push(`${label} authority vector must have at least one named divergence.`);
    }
    for (const difference of namedDifferences) {
      if (isRecord(difference) && typeof difference.jsonPointer === "string") {
        const resolved = resolveJsonPointer(vector, difference.jsonPointer);
        if (!resolved.found) {
          errors.push(`${label} divergence pointer ${difference.jsonPointer} does not resolve in its vector.`);
        } else if (isRecord(resolved.value) || Array.isArray(resolved.value)) {
          errors.push(`${label} divergence pointer ${difference.jsonPointer} must resolve to one JSON leaf.`);
        } else if (!jsonEqual(resolved.value, difference.flarex)) {
          errors.push(`${label} divergence pointer ${difference.jsonPointer} does not equal its declared Flarex value.`);
        }
      }
    }
  }

  for (const scenarioId of divergenceByScenario.keys()) {
    if (!ids.has(scenarioId)) errors.push(`divergence scenarioId ${scenarioId} has no vector.`);
  }
  for (const required of requiredCoverage) {
    if (!observedCoverage.has(required)) errors.push(`required coverage ${required} is missing.`);
  }
  for (const [operation, reasons] of currentReasonsByOperation) {
    const observed = observedCurrentReasons.get(operation) ?? new Set();
    for (const reason of reasons) {
      if (!observed.has(reason)) errors.push(`current reason ${operation}/${reason} is missing.`);
    }
  }
  for (const transition of transitionPlans.keys()) {
    if (!observedTransitions.has(transition)) errors.push(`accepted transition ${transition} is missing.`);
  }
  for (const reason of retryRejectionReasons) {
    if (!observedRetryRejections.has(reason)) errors.push(`retry rejection ${reason} is missing.`);
  }
  validateEffectCursorCases(suite.effectCursorCases, vectorsById, errors);
  validateReplayLinks(suite.replayLinks, vectorsById, errors);

  return {
    errors,
    vectorCount: suite.vectors.length,
    divergenceCount: countDivergences(divergences.differences),
  };
}

/** @param {unknown} value @param {Map<string, Record<string, unknown>>} vectorsById @param {string[]} errors */
function validateEffectCursorCases(value, vectorsById, errors) {
  if (!Array.isArray(value)) {
    errors.push("vector suite effectCursorCases must be an array.");
    return;
  }
  const byScenario = new Map();
  for (const [index, item] of value.entries()) {
    const label = `effectCursorCases[${index}]`;
    if (!isRecord(item) || !isSlug(item.scenarioId)) {
      errors.push(`${label}.scenarioId must be a stable slug.`);
      continue;
    }
    checkExactKeys(item, effectCursorCaseKeys, label, errors);
    if (byScenario.has(item.scenarioId)) errors.push(`${label} duplicates ${item.scenarioId}.`);
    byScenario.set(item.scenarioId, item);
    if (typeof item.priorEffectCursor !== "number" || !Number.isSafeInteger(item.priorEffectCursor) || item.priorEffectCursor < 0) errors.push(`${label}.priorEffectCursor must be a nonnegative safe integer.`);
    if (typeof item.resultingEffectCursor !== "number" || !Number.isSafeInteger(item.resultingEffectCursor) || item.resultingEffectCursor < 1) errors.push(`${label}.resultingEffectCursor must be a positive safe integer.`);
  }
  for (const [scenarioId, vector] of vectorsById) {
    const expected = vector.expected;
    if (!isRecord(expected) || expected.kind !== "receipt") continue;
    const cursorCase = byScenario.get(scenarioId);
    if (expected.disposition !== "accepted") {
      if (cursorCase !== undefined) errors.push(`effect cursor case ${scenarioId} must describe an accepted receipt.`);
      continue;
    }
    if (!isRecord(cursorCase)) {
      errors.push(`accepted vector ${scenarioId} is missing its effect cursor case.`);
      continue;
    }
    if (!Array.isArray(expected.effects) || expected.effects.length === 0) continue;
    const first = expected.effects[0];
    const last = expected.effects[expected.effects.length - 1];
    if (!isRecord(first) || !isRecord(last)) continue;
    if (typeof cursorCase.priorEffectCursor === "number" && first.sequence !== cursorCase.priorEffectCursor + 1) errors.push(`effect cursor case ${scenarioId} does not allocate cursor-plus-one.`);
    if (last.sequence !== cursorCase.resultingEffectCursor) errors.push(`effect cursor case ${scenarioId} does not end at its resulting cursor.`);
  }
  for (const scenarioId of byScenario.keys()) {
    if (!vectorsById.has(scenarioId)) errors.push(`effect cursor case ${scenarioId} has no vector.`);
  }
}

/** @param {unknown} value @param {Map<string, Record<string, unknown>>} vectorsById @param {string[]} errors */
function validateReplayLinks(value, vectorsById, errors) {
  if (!Array.isArray(value)) {
    errors.push("vector suite replayLinks must be an array.");
    return;
  }
  const byScenario = new Map();
  for (const [index, item] of value.entries()) {
    const label = `replayLinks[${index}]`;
    if (!isRecord(item) || !isSlug(item.scenarioId) || !isSlug(item.originalScenarioId)) {
      errors.push(`${label} must contain stable scenarioId and originalScenarioId slugs.`);
      continue;
    }
    checkExactKeys(item, replayLinkKeys, label, errors);
    if (byScenario.has(item.scenarioId)) errors.push(`${label} duplicates ${item.scenarioId}.`);
    byScenario.set(item.scenarioId, item.originalScenarioId);
  }
  for (const [scenarioId, vector] of vectorsById) {
    const expected = vector.expected;
    if (!isRecord(expected) || expected.kind !== "receipt") continue;
    const originalScenarioId = byScenario.get(scenarioId);
    if (expected.disposition !== "idempotent") {
      if (originalScenarioId !== undefined) errors.push(`replay link ${scenarioId} must describe an idempotent receipt.`);
      continue;
    }
    if (typeof originalScenarioId !== "string") {
      errors.push(`idempotent vector ${scenarioId} is missing its original accepted scenario link.`);
      continue;
    }
    const original = vectorsById.get(originalScenarioId);
    const originalExpected = original?.expected;
    if (!isRecord(original) || !isRecord(originalExpected) || originalExpected.kind !== "receipt" || originalExpected.disposition !== "accepted") {
      errors.push(`replay link ${scenarioId} must target an accepted receipt vector.`);
      continue;
    }
    const command = vector.command;
    const originalCommand = original.command;
    if (!isRecord(command) || !isRecord(originalCommand) || command.operation !== originalCommand.operation) errors.push(`replay link ${scenarioId} must preserve the original operation.`);
    if (!receiptEqualExceptDisposition(expected, originalExpected)) errors.push(`replay link ${scenarioId} must preserve the exact original receipt data.`);
  }
  for (const [scenarioId, originalScenarioId] of byScenario) {
    if (!vectorsById.has(scenarioId)) errors.push(`replay link ${scenarioId} has no vector.`);
    if (!vectorsById.has(originalScenarioId)) errors.push(`replay link ${scenarioId} targets missing vector ${originalScenarioId}.`);
  }
}

/** @param {Record<string, unknown>} left @param {Record<string, unknown>} right */
function receiptEqualExceptDisposition(left, right) {
  const withoutDisposition = (/** @type {Record<string, unknown>} */ value) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "disposition"));
  return jsonEqual(withoutDisposition(left), withoutDisposition(right));
}

/** @param {unknown} value @param {string[]} errors */
function validateInspectionCases(value, errors) {
  if (!Array.isArray(value)) return;
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const label = `inspectionCases[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    checkExactKeys(item, inspectionCaseKeys, label, errors);
    if (!isSlug(item.id) || !inspectionCaseContracts.has(item.id)) {
      errors.push(`${label}.id is not an admitted inspection case.`);
      continue;
    }
    if (seen.has(item.id)) errors.push(`${label} duplicates inspection case ${item.id}.`);
    seen.add(item.id);
    const projection = item.projection;
    if (!isRecord(projection)) {
      errors.push(`${label}.projection must be a complete normalized inspection object.`);
      continue;
    }
    const keys = Object.keys(projection);
    for (const key of keys) if (!inspectionProjectionKeys.has(key)) errors.push(`${label}.projection has unsupported field ${key}.`);
    for (const key of inspectionProjectionKeys) if (!Object.hasOwn(projection, key)) errors.push(`${label}.projection is missing field ${key}.`);
    checkExactString(projection.version, "flarex.run-attempt-inspection.v1", `${label}.projection.version`, errors);
    checkExactString(projection.stateVersion, "flarex.run-attempt-state.v1", `${label}.projection.stateVersion`, errors);
    checkExactString(projection.runId, "run-1", `${label}.projection.runId`, errors);
    checkExactString(projection.taskDefinitionRevisionId, "definition-revision-1", `${label}.projection.taskDefinitionRevisionId`, errors);
    checkSafeInteger(projection.observedAtMs, expectedSymbolicEpochMs, `${label}.projection.observedAtMs`, errors);
    checkSafeInteger(projection.runVersion, 1, `${label}.projection.runVersion`, errors);
    for (const key of ["attemptNumber", "leaseVersion", "heartbeatSequence", "eligibleAtMs", "retryNotBeforeMs"]) {
      if (projection[key] !== null) checkSafeInteger(projection[key], key.endsWith("Ms") ? expectedSymbolicEpochMs : 1, `${label}.projection.${key}`, errors);
    }
    if (typeof projection.cancellationGeneration !== "number" || !Number.isSafeInteger(projection.cancellationGeneration) || projection.cancellationGeneration < 0) errors.push(`${label}.projection.cancellationGeneration must be a nonnegative safe integer.`);

    const contract = inspectionCaseContracts.get(item.id);
    if (contract) {
      const [phase, stateVariant, cancellationKind, terminalKind, cancellationResolution] = contract;
      if (projection.phase !== phase) errors.push(`${label}.projection.phase must be ${String(phase)}.`);
      if (projection.stateVariant !== stateVariant) errors.push(`${label}.projection.stateVariant must be ${String(stateVariant)}.`);
      if (projection.cancellationKind !== cancellationKind) errors.push(`${label}.projection.cancellationKind must be ${String(cancellationKind)}.`);
      if (projection.terminalKind !== terminalKind) errors.push(`${label}.projection.terminalKind must be ${String(terminalKind)}.`);
      if (projection.cancellationResolution !== cancellationResolution) errors.push(`${label}.projection.cancellationResolution must be ${String(cancellationResolution)}.`);
    }
    validateInspectionProjectionCorrelations(projection, label, errors);
    validateForbiddenFields(item, label, errors);
  }
  for (const required of inspectionCaseContracts.keys()) {
    if (!seen.has(required)) errors.push(`inspection case ${required} is missing.`);
  }
}

/** @param {Record<string, unknown>} projection @param {string} label @param {string[]} errors */
function validateInspectionProjectionCorrelations(projection, label, errors) {
  const phase = projection.phase;
  const cancellationKind = projection.cancellationKind;
  if (cancellationKind === "not_requested" && projection.cancellationGeneration !== 0) errors.push(`${label} non-requested cancellation requires generation zero.`);
  if ((cancellationKind === "requested" || cancellationKind === "resolved") && (typeof projection.cancellationGeneration !== "number" || !Number.isSafeInteger(projection.cancellationGeneration) || projection.cancellationGeneration < 1)) errors.push(`${label} requested/resolved cancellation requires a positive generation.`);
  if (cancellationKind !== "resolved" && projection.cancellationResolution !== null) errors.push(`${label} unresolved cancellation cannot have a resolution.`);
  if (cancellationKind === "requested" && phase !== "attempt_granted" && phase !== "executing") errors.push(`${label} pending cancellation requires an active phase.`);
  if (cancellationKind === "resolved" && phase !== "terminal") errors.push(`${label} resolved cancellation requires terminal phase.`);

  if (phase === "ready") {
    if (projection.eligibleAtMs === null || projection.leaseVersion !== null || projection.heartbeatSequence !== null || projection.terminalKind !== null) errors.push(`${label} ready projection has inconsistent phase fields.`);
    if (projection.stateVariant === "initial" && (projection.attemptNumber !== null || projection.retryNotBeforeMs !== null || projection.retryCause !== null)) errors.push(`${label} initial-ready projection cannot expose retry fields.`);
    if (projection.stateVariant === "immediate_retry" && (projection.attemptNumber === null || projection.retryNotBeforeMs === null || projection.retryCause === null)) errors.push(`${label} immediate-retry projection requires retry fields.`);
  } else if (phase === "attempt_granted") {
    if (projection.attemptNumber === null || projection.leaseVersion === null || projection.heartbeatSequence !== null || projection.eligibleAtMs !== null || projection.retryNotBeforeMs !== null || projection.retryCause !== null || projection.terminalKind !== null) errors.push(`${label} attempt-granted projection has inconsistent phase fields.`);
  } else if (phase === "executing") {
    if (projection.attemptNumber === null || projection.leaseVersion === null || projection.heartbeatSequence === null || projection.eligibleAtMs !== null || projection.retryNotBeforeMs !== null || projection.retryCause !== null || projection.terminalKind !== null) errors.push(`${label} executing projection has inconsistent phase fields.`);
  } else if (phase === "retry_waiting") {
    if (projection.attemptNumber === null || projection.leaseVersion !== null || projection.heartbeatSequence !== null || projection.eligibleAtMs !== null || projection.retryNotBeforeMs === null || projection.retryCause === null || projection.terminalKind !== null) errors.push(`${label} retry-waiting projection has inconsistent phase fields.`);
  } else if (phase === "terminal") {
    if (projection.leaseVersion !== null || projection.heartbeatSequence !== null || projection.eligibleAtMs !== null || projection.retryNotBeforeMs !== null || projection.retryCause !== null || projection.terminalKind === null) errors.push(`${label} terminal projection has inconsistent phase fields.`);
  } else {
    errors.push(`${label}.projection.phase is invalid.`);
  }

  if (projection.terminalKind === "succeeded") {
    if (projection.attemptNumber === null || !isNonblankString(projection.resultCommitment) || projection.failureClass !== null) errors.push(`${label} succeeded terminal projection has inconsistent attempt/result/failure fields.`);
  } else if (projection.terminalKind === "failed") {
    if (projection.attemptNumber === null || projection.resultCommitment !== null || typeof projection.failureClass !== "string" || !terminalFailureClasses.has(projection.failureClass)) errors.push(`${label} failed terminal projection has inconsistent attempt/result/failure fields.`);
  } else if (projection.terminalKind === "cancelled") {
    if (projection.resultCommitment !== null || projection.failureClass !== null || cancellationKind !== "resolved") errors.push(`${label} cancelled terminal projection has inconsistent result/failure fields.`);
    if (projection.cancellationResolution === "without_active_attempt" && projection.attemptNumber !== null) errors.push(`${label} cancellation without attempt must not name an attempt.`);
    if (projection.cancellationResolution !== "without_active_attempt" && projection.attemptNumber === null) errors.push(`${label} active cancellation resolution must name an attempt.`);
  } else if (projection.resultCommitment !== null || projection.failureClass !== null) {
    errors.push(`${label} nonterminal projection cannot expose result/failure fields.`);
  }
  if (projection.retryCause !== null && (typeof projection.retryCause !== "string" || !retryCauses.has(projection.retryCause))) errors.push(`${label}.projection.retryCause is not admitted.`);
}

/** @param {unknown} value @param {string} label @param {string[]} errors */
function validateInitial(value, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label}.initial must be an object.`);
    return;
  }
  for (const key of Object.keys(value)) if (!initialKeys.has(key)) errors.push(`${label}.initial has unsupported field ${key}.`);
  for (const key of ["phase", "cancellation", "runVersion"]) if (!Object.hasOwn(value, key)) errors.push(`${label}.initial is missing field ${key}.`);
  if (typeof value.phase !== "string" || !phases.has(value.phase)) errors.push(`${label}.initial.phase is invalid.`);
  if (typeof value.cancellation !== "string" || !cancellations.has(value.cancellation)) errors.push(`${label}.initial.cancellation is invalid.`);
  if (typeof value.runVersion !== "number" || !Number.isSafeInteger(value.runVersion) || value.runVersion < 1) errors.push(`${label}.initial.runVersion must be a positive safe integer.`);
  if ((value.phase === "ready" || value.phase === "retry_waiting") && value.cancellation !== "not_requested") errors.push(`${label}.initial inactive phase cannot retain cancellation.`);
  if ((value.phase === "attempt_granted" || value.phase === "executing") && value.cancellation === "resolved") errors.push(`${label}.initial active phase cannot retain resolved cancellation.`);
  if (value.phase === "terminal" && value.cancellation === "requested") errors.push(`${label}.initial terminal phase cannot retain requested cancellation.`);
}

/** @param {unknown} value @param {string} label @param {string[]} errors */
function validateCommand(value, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label}.command must be an object.`);
    return;
  }
  checkExactKeys(value, commandKeys, `${label}.command`, errors);
  if (typeof value.operation !== "string" || !operations.has(value.operation) || value.operation === "inspectCurrentAttempt") {
    errors.push(`${label}.command.operation must be one of the five mutation operations.`);
  }
  if (!isSlug(value.identity)) errors.push(`${label}.command.identity must be a stable symbolic slug.`);
}

/**
 * @param {Record<string, unknown>} vector
 * @param {string} label
 * @param {Map<string, Set<string>>} observedCurrentReasons
 * @param {Set<string>} observedTransitions
 * @param {Set<string>} observedRetryRejections
 * @param {string[]} errors
 */
function validateExpected(vector, label, observedCurrentReasons, observedTransitions, observedRetryRejections, errors) {
  const expected = vector.expected;
  const command = vector.command;
  if (!isRecord(expected) || !isRecord(command) || typeof command.operation !== "string") {
    errors.push(`${label}.expected must be an object.`);
    return;
  }
  if (expected.kind === "error") {
    checkExactKeys(expected, errorExpectationKeys, `${label}.expected`, errors);
    if (typeof expected.errorTag !== "string" || !errorTags.has(expected.errorTag)) errors.push(`${label}.expected.errorTag is not admitted.`);
    const safeReasons = typeof expected.errorTag === "string"
      ? safeReasonsByErrorTag.get(expected.errorTag)
      : undefined;
    if (typeof expected.safeReason !== "string" || !safeReasons?.has(expected.safeReason)) errors.push(`${label}.expected.safeReason is not admitted for its error tag.`);
    if (expected.transition !== null || expected.acceptedRunVersion !== null || expected.recordedAtMs !== null) errors.push(`${label} error must not contain acceptance data.`);
    if (!isEmptyArray(expected.evidenceKinds) || !isEmptyArray(expected.effects)) errors.push(`${label} error must contain empty evidence/effects.`);
    return;
  }
  if (expected.kind !== "receipt") {
    errors.push(`${label}.expected.kind must be receipt or error.`);
    return;
  }
  checkExactKeys(expected, receiptExpectationKeys, `${label}.expected`, errors);
  if (typeof expected.disposition !== "string" || !dispositions.has(expected.disposition)) errors.push(`${label}.expected.disposition is invalid.`);
  const allowedOutcomes = outcomeKindsByOperation.get(command.operation);
  if (!allowedOutcomes || typeof expected.outcomeKind !== "string" || !allowedOutcomes.has(expected.outcomeKind)) errors.push(`${label}.expected.outcomeKind is invalid for ${command.operation}.`);

  if (expected.disposition === "current") {
    const allowedReasons = currentReasonsByOperation.get(command.operation);
    if (!allowedReasons || typeof expected.currentReason !== "string" || !allowedReasons.has(expected.currentReason)) errors.push(`${label}.expected.currentReason is invalid for ${command.operation}.`);
    else observedCurrentReasons.get(command.operation)?.add(expected.currentReason);
    if (expected.outcomeKind !== "current") errors.push(`${label} current receipt must have current outcome.`);
    if (expected.transition !== null || expected.acceptedRunVersion !== null || expected.recordedAtMs !== null) errors.push(`${label} current receipt must not contain acceptance data.`);
    if (!isEmptyArray(expected.evidenceKinds) || !isEmptyArray(expected.effects)) errors.push(`${label} current receipt must contain empty evidence/effects.`);
    if (expected.policy !== null) errors.push(`${label} current receipt must not contain policy evidence.`);
    return;
  }

  if (expected.currentReason !== null) errors.push(`${label} accepted/idempotent receipt must not have currentReason.`);
  if (typeof expected.transition !== "string" || !transitionPlans.has(expected.transition)) {
    errors.push(`${label}.expected.transition is not admitted.`);
    return;
  }
  observedTransitions.add(expected.transition);
  const transitionContract = transitionContracts.get(expected.transition);
  if (
    !transitionContract
    || transitionContract[0] !== command.operation
    || transitionContract[1] !== expected.outcomeKind
  ) {
    errors.push(`${label}.expected.transition disagrees with its operation/outcome.`);
  }
  if (typeof expected.acceptedRunVersion !== "number" || !Number.isSafeInteger(expected.acceptedRunVersion) || expected.acceptedRunVersion < 2) errors.push(`${label}.expected.acceptedRunVersion must be at least 2.`);
  if (typeof expected.recordedAtMs !== "number" || !Number.isSafeInteger(expected.recordedAtMs) || expected.recordedAtMs < expectedSymbolicEpochMs) errors.push(`${label}.expected.recordedAtMs must be on or after the symbolic epoch.`);
  if (isRecord(vector.initial) && typeof vector.initial.runVersion === "number" && typeof expected.acceptedRunVersion === "number") {
    if (expected.disposition === "accepted" && expected.acceptedRunVersion !== vector.initial.runVersion + 1) errors.push(`${label} accepted receipt must advance the initial run version exactly once.`);
    if (expected.disposition === "idempotent" && expected.acceptedRunVersion > vector.initial.runVersion) errors.push(`${label} idempotent receipt cannot come from a future run version.`);
  }
  const plan = transitionPlans.get(expected.transition);
  if (!plan) return;
  const [evidenceKind, effectKinds] = plan;
  if (!Array.isArray(expected.evidenceKinds) || expected.evidenceKinds.length !== 1 || expected.evidenceKinds[0] !== evidenceKind) errors.push(`${label}.expected.evidenceKinds must contain exactly ${evidenceKind}.`);
  if (!Array.isArray(expected.effects) || expected.effects.length !== effectKinds.length) {
    errors.push(`${label}.expected.effects must contain the exact ${expected.transition} plan.`);
  } else {
    const sequences = [];
    for (const [effectIndex, effect] of expected.effects.entries()) {
      if (!isRecord(effect) || effect.kind !== effectKinds[effectIndex]) errors.push(`${label}.expected.effects[${effectIndex}] has the wrong kind/order.`);
      if (isRecord(effect)) checkExactKeys(effect, effectKeys, `${label}.expected.effects[${effectIndex}]`, errors);
      if (!isRecord(effect) || typeof effect.sequence !== "number" || !Number.isSafeInteger(effect.sequence) || effect.sequence < 1) errors.push(`${label}.expected.effects[${effectIndex}].sequence must be positive.`);
      else sequences.push(effect.sequence);
    }
    for (let index = 1; index < sequences.length; index += 1) {
      const previous = sequences[index - 1];
      if (previous !== undefined && sequences[index] !== previous + 1) errors.push(`${label}.expected.effects sequences must be contiguous.`);
    }
  }
  validatePolicy(expected.transition, expected.policy, label, observedRetryRejections, errors);
}

/** @param {string} transition @param {unknown} value @param {string} label @param {Set<string>} observedRetryRejections @param {string[]} errors */
function validatePolicy(transition, value, label, observedRetryRejections, errors) {
  const policyTransition = transition.startsWith("completion_retry_")
    || transition === "completion_terminal_failed"
    || transition.startsWith("lease_expiry_") && transition !== "lease_expiry_cancelled";
  if (!policyTransition) {
    if (value !== null) errors.push(`${label}.expected.policy must be null for ${transition}.`);
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${label}.expected.policy is required for ${transition}.`);
    return;
  }
  if (value.decision === "retry_accepted") {
    checkExactKeys(value, acceptedPolicyKeys, `${label}.expected.policy`, errors);
    if (transition === "completion_terminal_failed" || transition === "lease_expiry_terminal_failed") errors.push(`${label} terminal-failure transition requires a rejected retry decision.`);
    if (typeof value.eligibility !== "string" || !new Set(["ordinary", "oom_escalation", "lease_loss"]).has(value.eligibility)) errors.push(`${label}.expected.policy.eligibility is invalid.`);
    if (typeof value.delivery !== "string" || !new Set(["immediate", "durable"]).has(value.delivery)) errors.push(`${label}.expected.policy.delivery is invalid.`);
    if (typeof value.delaySource !== "string" || !new Set(["bound_policy", "override_delay"]).has(value.delaySource)) errors.push(`${label}.expected.policy.delaySource is invalid.`);
    if (typeof value.jitterUsed !== "boolean") errors.push(`${label}.expected.policy.jitterUsed must be Boolean.`);
    if (typeof value.computeEscalated !== "boolean") errors.push(`${label}.expected.policy.computeEscalated must be Boolean.`);
    if ((value.eligibility === "oom_escalation" || value.eligibility === "lease_loss") && value.delivery !== "durable") errors.push(`${label} OOM/lease-loss retry must be durable.`);
    if (value.eligibility === "oom_escalation" && value.computeEscalated !== true) errors.push(`${label} OOM retry must change compute profile.`);
    if (value.eligibility !== "oom_escalation" && value.computeEscalated !== false) errors.push(`${label} non-OOM retry must not change compute profile.`);
    if (value.delaySource === "override_delay" && value.jitterUsed !== false) errors.push(`${label} override delay must not use jitter.`);
    if (transition === "completion_retry_immediate" && value.delivery !== "immediate") errors.push(`${label} immediate transition requires immediate policy delivery.`);
    if ((transition === "completion_retry_durable" || transition === "lease_expiry_retry") && value.delivery !== "durable") errors.push(`${label} durable transition requires durable policy delivery.`);
    if (transition === "lease_expiry_retry" && value.eligibility !== "lease_loss") errors.push(`${label} lease-expiry retry requires lease-loss eligibility.`);
    if (transition.startsWith("completion_retry_") && value.eligibility === "lease_loss") errors.push(`${label} completion retry cannot use lease-loss eligibility.`);
    return;
  }
  if (value.decision === "retry_rejected") {
    checkExactKeys(value, rejectedPolicyKeys, `${label}.expected.policy`, errors);
    if (transition === "completion_retry_immediate" || transition === "completion_retry_durable" || transition === "lease_expiry_retry") errors.push(`${label} retry transition requires an accepted retry decision.`);
    if (typeof value.reason !== "string" || !retryRejectionReasons.has(value.reason)) errors.push(`${label}.expected.policy.reason is invalid.`);
    else observedRetryRejections.add(value.reason);
    if (typeof value.terminalClassification !== "string" || !terminalFailureClasses.has(value.terminalClassification)) errors.push(`${label}.expected.policy.terminalClassification is not admitted.`);
    if ((value.reason === "oom_escalation_disabled" || value.reason === "oom_target_not_different") && value.terminalClassification !== "resource_exhaustion") errors.push(`${label} rejected OOM policy must retain resource-exhaustion classification.`);
    if (transition === "lease_expiry_terminal_failed" && value.terminalClassification !== "system_failure") errors.push(`${label} lease-loss terminal policy must retain system-failure classification.`);
    return;
  }
  errors.push(`${label}.expected.policy.decision is invalid.`);
}

/** @param {unknown} value @param {unknown[]} entries @param {unknown} classification @param {string} label @param {string[]} errors */
function validateSourceRefs(value, entries, classification, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) {
    errors.push(`${label}.sourceEntryIndexes must be a nonempty unique array.`);
    return;
  }
  let hasDiscarded = false;
  for (const [index, entryIndex] of value.entries()) {
    if (!Number.isSafeInteger(entryIndex) || entryIndex < 0 || entryIndex >= entries.length) {
      errors.push(`${label}.sourceEntryIndexes[${index}] is outside the source map.`);
      continue;
    }
    const entry = entries[entryIndex];
    if (isRecord(entry) && entry.reuseClass === "D") hasDiscarded = true;
  }
  if (classification === "outside-first-vertical" && !hasDiscarded) errors.push(`${label} outside-first-vertical vector must reference a discarded source-map entry.`);
  if (classification !== "outside-first-vertical" && hasDiscarded) errors.push(`${label} admitted vector must not rely on a discarded source-map entry.`);
}

/** @param {unknown} value @param {string[]} errors @returns {Map<string, unknown[]>} */
function validateDivergences(value, errors) {
  /** @type {Map<string, unknown[]>} */
  const byScenario = new Map();
  if (!Array.isArray(value)) {
    errors.push("divergence differences must be an array.");
    return byScenario;
  }
  const identities = new Set();
  for (const [index, difference] of value.entries()) {
    const label = `differences[${index}]`;
    if (!isRecord(difference)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    checkExactKeys(difference, divergenceKeys, label, errors);
    if (!isSlug(difference.scenarioId)) errors.push(`${label}.scenarioId must be a stable slug.`);
    if (typeof difference.jsonPointer !== "string" || !difference.jsonPointer.startsWith("/") || difference.jsonPointer === "/") errors.push(`${label}.jsonPointer must name an exact non-root path.`);
    if (!Object.hasOwn(difference, "trigger") || !Object.hasOwn(difference, "flarex")) errors.push(`${label} must name both Trigger and Flarex values.`);
    else if (jsonEqual(difference.trigger, difference.flarex)) errors.push(`${label} Trigger and Flarex values must differ.`);
    if (!isNonblankString(difference.rationale) || !isNonblankString(difference.owner)) errors.push(`${label} must name its rationale and owner.`);
    if (typeof difference.scenarioId === "string" && typeof difference.jsonPointer === "string") {
      const identity = `${difference.scenarioId}\0${difference.jsonPointer}`;
      if (identities.has(identity)) errors.push(`${label} duplicates a scenario/pointer difference.`);
      identities.add(identity);
      const existing = byScenario.get(difference.scenarioId) ?? [];
      existing.push(difference);
      byScenario.set(difference.scenarioId, existing);
    }
  }
  return byScenario;
}

/** @param {unknown} value @param {string} label @param {string[]} errors */
function validateForbiddenFields(value, label, errors) {
  /** @param {unknown} item @param {string} pointer */
  function visit(item, pointer) {
    if (Array.isArray(item)) {
      for (const [index, child] of item.entries()) visit(child, `${pointer}/${index}`);
      return;
    }
    if (!isRecord(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if (forbiddenFieldNames.has(key)) errors.push(`${label}${pointer}/${key} uses a forbidden Trigger/host/persistence field.`);
      visit(child, `${pointer}/${key}`);
    }
  }
  visit(value, "");
}

/** @param {unknown} value @returns {number} */
function countDivergences(value) {
  return Array.isArray(value) ? value.length : 0;
}

/** @param {unknown} root @param {string} pointer @returns {{ found: true; value: unknown } | { found: false }} */
function resolveJsonPointer(root, pointer) {
  let current = root;
  for (const encodedPart of pointer.slice(1).split("/")) {
    const part = encodedPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(part)) return { found: false };
      const index = Number(part);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, part)) return { found: false };
    current = current[part];
  }
  return { found: true, value: current };
}

/** @param {unknown} left @param {unknown} right */
function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {string} filePath @param {string} label @param {string[]} errors @returns {unknown} */
function readJson(filePath, label, errors) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    errors.push(`${label} could not be read as JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    return undefined;
  }
}

/** @param {unknown} actual @param {string} expected @param {string} label @param {string[]} errors */
function checkExactString(actual, expected, label, errors) {
  if (actual !== expected) errors.push(`${label} must be ${expected}.`);
}

/** @param {unknown} actual @param {number} minimum @param {string} label @param {string[]} errors */
function checkSafeInteger(actual, minimum, label, errors) {
  if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual < minimum) errors.push(`${label} must be a safe integer at or above ${minimum}.`);
}

/** @param {Record<string, unknown>} value @param {Set<string>} expectedKeys @param {string} label @param {string[]} errors */
function checkExactKeys(value, expectedKeys, label, errors) {
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) errors.push(`${label} has unsupported field ${key}.`);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) errors.push(`${label} is missing field ${key}.`);
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string} */
function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value @returns {value is string} */
function isSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** @param {unknown} value @returns {value is string[]} */
function isNonemptyStringArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(isNonblankString)
    && new Set(value).size === value.length;
}

/** @param {unknown} value @returns {value is []} */
function isEmptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function isCliEntrypoint() {
  return process.argv[1] !== undefined
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
