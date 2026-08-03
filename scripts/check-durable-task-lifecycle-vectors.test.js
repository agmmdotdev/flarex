// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDurableTaskLifecycleVectors,
  inspectDurableTaskLifecycleVectorsRepository,
} from "./check-durable-task-lifecycle-vectors.mjs";

const suitePath = path.join(
  process.cwd(),
  "integration/durable-task-compatibility/scenarios/v1/run-attempt-lifecycle.json",
);
const divergencesPath = path.join(
  process.cwd(),
  "integration/durable-task-compatibility/divergences/v1.json",
);
const sourceMapPath = path.join(
  process.cwd(),
  "roadmaps/durable-task-engine/preflight/source-map.run-attempt-v1.json",
);

describe("durable task lifecycle vector checker", () => {
  it("accepts the pinned DTE03-F suite and named divergences", () => {
    expect(inspectDurableTaskLifecycleVectorsRepository(process.cwd())).toEqual({
      errors: [],
      vectorCount: 65,
      divergenceCount: 37,
    });
  });

  it("fails closed when required coverage or a current-reason row disappears", () => {
    const input = validInput();
    vector(input, "start-stale-version").coverage = [];
    vector(input, "duplicate-start-replays-grant").coverage = ["duplicate-start", "effect-replay-stability"];
    vector(input, "start-before-eligibility").expected.currentReason = "phase_not_startable";

    expect(analyzeDurableTaskLifecycleVectors(input).errors).toEqual(
      expect.arrayContaining([
        "vectors[24].coverage must be a nonempty unique string array.",
        "required coverage competing-start is missing.",
        "current reason startAttempt/not_yet_eligible is missing.",
      ]),
    );
  });

  it("rejects reordered or noncontiguous effects and operation/outcome drift", () => {
    const input = validInput();
    const start = vector(input, "start-initial-due");
    start.expected.effects[0].kind = "notify_current_state";
    start.expected.effects[1].sequence = 7;
    start.expected.outcomeKind = "current";
    start.expected.acceptedRunVersion = 8;

    expect(analyzeDurableTaskLifecycleVectors(input).errors).toEqual(
      expect.arrayContaining([
        "vectors[0].expected.effects[0] has the wrong kind/order.",
        "vectors[0].expected.effects sequences must be contiguous.",
        "vectors[0].expected.transition disagrees with its operation/outcome.",
        "vectors[0] accepted receipt must advance the initial run version exactly once.",
      ]),
    );
  });

  it("binds accepted effect cursors and replay receipts to their originals", () => {
    const input = validInput();
    for (const effect of vector(input, "start-initial-due").expected.effects) {
      effect.sequence += 100;
    }
    for (const effect of vector(input, "duplicate-start-replays-grant").expected.effects) {
      effect.sequence += 200;
    }

    expect(analyzeDurableTaskLifecycleVectors(input).errors).toEqual(
      expect.arrayContaining([
        "effect cursor case start-initial-due does not allocate cursor-plus-one.",
        "effect cursor case start-initial-due does not end at its resulting cursor.",
        "replay link duplicate-start-replays-grant must preserve the exact original receipt data.",
      ]),
    );
  });

  it("rejects invalid retry correlations and missing rejection coverage", () => {
    const input = validInput();
    const oom = vector(input, "oom-escalates-compute");
    oom.expected.policy.delivery = "immediate";
    oom.expected.policy.computeEscalated = false;
    vector(input, "immediate-retryable-failure").expected.policy.decision = "retry_rejected";
    vector(input, "immediate-retryable-failure").expected.policy.reason = "failure_never_retry";
    vector(input, "immediate-retryable-failure").expected.policy.terminalClassification = "non_retryable";
    vector(input, "attempt-limit-terminal-failure").expected.policy.decision = "retry_accepted";
    vector(input, "attempt-limit-terminal-failure").expected.policy.eligibility = "ordinary";
    vector(input, "attempt-limit-terminal-failure").expected.policy.delivery = "durable";
    vector(input, "attempt-limit-terminal-failure").expected.policy.delaySource = "bound_policy";
    vector(input, "attempt-limit-terminal-failure").expected.policy.jitterUsed = false;
    vector(input, "attempt-limit-terminal-failure").expected.policy.computeEscalated = false;
    vector(input, "oom-target-not-different").expected.policy.reason = "attempt_limit_reached";
    vector(input, "oom-escalation-disabled").expected.policy.terminalClassification = "task_failure";
    vector(input, "lease-loss-attempt-limit-terminal").expected.policy.terminalClassification = "timed_out";

    expect(analyzeDurableTaskLifecycleVectors(input).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("OOM/lease-loss retry must be durable"),
        expect.stringContaining("OOM retry must change compute profile"),
        expect.stringContaining("retry transition requires an accepted retry decision"),
        expect.stringContaining("terminal-failure transition requires a rejected retry decision"),
        "retry rejection oom_target_not_different is missing.",
        expect.stringContaining("rejected OOM policy must retain resource-exhaustion classification"),
        expect.stringContaining("lease-loss terminal policy must retain system-failure classification"),
      ]),
    );
  });

  it("requires exact divergence pointers and the correct source-map side", () => {
    const input = validInput();
    input.divergences.differences[0].jsonPointer = "/expected/missing";
    input.divergences.differences[1].flarex = "wrong-value";
    input.divergences.differences[2].jsonPointer = "/expected";
    input.divergences.differences[3].trigger = input.divergences.differences[3].flarex;
    vector(input, "waitpoint-completion-outside-v1").sourceEntryIndexes = [19];
    vector(input, "start-initial-due").sourceEntryIndexes = [13];

    expect(analyzeDurableTaskLifecycleVectors(input).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("divergence pointer /expected/missing does not resolve"),
        expect.stringContaining("does not equal its declared Flarex value"),
        expect.stringContaining("divergence pointer /expected must resolve to one JSON leaf"),
        expect.stringContaining("Trigger and Flarex values must differ"),
        expect.stringContaining("outside-first-vertical vector must reference a discarded source-map entry"),
        expect.stringContaining("admitted vector must not rely on a discarded source-map entry"),
      ]),
    );
  });

  it("rejects removed Trigger, host, and persistence field names", () => {
    const input = validInput();
    vector(input, "start-initial-due").initial.organizationId = "forbidden";
    vector(input, "successful-first-attempt").expected.effects[0].stack = "forbidden";
    vector(input, "invalid-command-is-redacted").expected.safeReason = "raw-decoder-message";
    vector(input, "invalid-command-is-redacted").expected.policy = null;
    vector(input, "immediate-retryable-failure").expected.policy.reason = "hybrid-field";
    vector(input, "start-initial-due").initial.cancellation = "requested";
    vector(input, "start-durable-retry-due").initial.cancellation = "resolved";
    vector(input, "start-terminal-phase").initial.cancellation = "requested";
    vector(input, "successful-first-attempt").expected.recordedAtMs = 1;
    input.suite.secret = "forbidden";
    input.suite.inspectionCases[0].secret = "forbidden";
    input.suite.effectCursorCases[0].secret = "forbidden";
    input.suite.replayLinks[0].secret = "forbidden";
    input.divergences.differences[0].secret = "forbidden";
    vector(input, "start-initial-due").expected.effects[0].secret = "forbidden";

    expect(analyzeDurableTaskLifecycleVectors(input).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/initial/organizationId uses a forbidden"),
        expect.stringContaining("/expected/effects/0/stack uses a forbidden"),
        expect.stringContaining("safeReason is not admitted for its error tag"),
        expect.stringContaining("expected has unsupported field policy"),
        expect.stringContaining("expected.policy has unsupported field reason"),
        expect.stringContaining("initial inactive phase cannot retain cancellation"),
        expect.stringContaining("initial terminal phase cannot retain requested cancellation"),
        expect.stringContaining("recordedAtMs must be on or after the symbolic epoch"),
        "vector suite has unsupported field secret.",
        "inspectionCases[0] has unsupported field secret.",
        "effectCursorCases[0] has unsupported field secret.",
        "replayLinks[0] has unsupported field secret.",
        "differences[0] has unsupported field secret.",
        "vectors[0].expected.effects[0] has unsupported field secret.",
      ]),
    );
  });

  it("pins the symbolic epoch and exact inspection projections", () => {
    const input = validInput();
    input.suite.symbolicEpochMs = 1;
    delete input.suite.inspectionCases[0].projection.eligibleAtMs;
    input.suite.inspectionCases[0].projection.stateVariant = "not-a-projection";
    input.suite.inspectionCases[6].projection.retryCause = { bad: true };
    input.suite.inspectionCases[7].projection.attemptNumber = null;
    input.suite.inspectionCases[8].projection.failureClass = "banana";
    input.suite.inspectionCases.push(structuredClone(input.suite.inspectionCases[1]));

    expect(analyzeDurableTaskLifecycleVectors(input).errors).toEqual(
      expect.arrayContaining([
        "vector suite symbolicEpochMs must be 2000000000000.",
        "inspectionCases[0].projection is missing field eligibleAtMs.",
        "inspectionCases[0].projection.stateVariant must be initial.",
        "inspectionCases[6].projection.retryCause is not admitted.",
        "inspectionCases[7] succeeded terminal projection has inconsistent attempt/result/failure fields.",
        "inspectionCases[8] failed terminal projection has inconsistent attempt/result/failure fields.",
        "inspectionCases[14] duplicates inspection case ready-immediate-retry.",
      ]),
    );
  });
});

function validInput() {
  return {
    suite: readJson(suitePath),
    divergences: readJson(divergencesPath),
    sourceMap: readJson(sourceMapPath),
  };
}

/** @param {string} filePath */
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/** @param {ReturnType<typeof validInput>} input @param {string} id */
function vector(input, id) {
  const value = input.suite.vectors.find(hasId);
  if (!value) throw new Error(`missing fixture vector ${id}`);
  return value;

  /** @param {{ id: string }} candidate */
  function hasId(candidate) {
    return candidate.id === id;
  }
}
