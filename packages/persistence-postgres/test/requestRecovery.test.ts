import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { runWithRequestRecovery } from "../src/relationalTransaction/requestRecovery";
import { RelationalSessionError } from "../src/relationalTransaction/model";
import { runEffect } from "./effectTestRuntime";

const uncertain = new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost acknowledgement") });
const unavailable = new RelationalSessionError({ reason: "resourceFailure", cause: new Error("Lookup unavailable") });
const policy = {
  hasRequestKey: true,
  projectFailure: (failure: unknown) => failure,
  isDecisionUncertain: (failure: unknown) => failure === uncertain,
};

function expectCause(result: Exit.Exit<unknown, unknown>, expected: Cause.Cause<unknown>): void {
  if (Exit.isSuccess(result)) throw new Error("Expected failure");
  expect(result.cause.reasons).toHaveLength(expected.reasons.length);
  for (const [index, reason] of expected.reasons.entries()) {
    const actual = result.cause.reasons[index];
    expect(actual?._tag).toBe(reason._tag);
    if (actual !== undefined && Cause.isFailReason(actual) && Cause.isFailReason(reason)) expect(actual.error).toBe(reason.error);
    if (actual !== undefined && Cause.isDieReason(actual) && Cause.isDieReason(reason)) expect(actual.defect).toBe(reason.defect);
  }
}

it("returns acknowledged success without recovery or participant cleanup", async () => {
  const calls: string[] = [];
  const result = await runEffect(runWithRequestRecovery(recoverOnly => {
    calls.push(recoverOnly ? "recovery" : "command");
    return Effect.succeed("acknowledged");
  }, { ...policy, beforeRecovery: () => { calls.push("discard"); } }));
  expect(result).toBe("acknowledged");
  expect(calls).toEqual(["command"]);
});

it("discards participant state before one recovery-only lookup", async () => {
  const calls: string[] = [];
  const result = await runEffect(runWithRequestRecovery(recoverOnly => {
    calls.push(recoverOnly ? "recovery" : "command");
    return recoverOnly ? Effect.succeed("retained") : Effect.fail(uncertain);
  }, { ...policy, beforeRecovery: error => { expect(error).toBe(uncertain); calls.push("discard"); } }));
  expect(result).toBe("retained");
  expect(calls).toEqual(["command", "discard", "recovery"]);
});

it("preserves both causes when recovery fails, without executing again", async () => {
  const calls: boolean[] = [];
  const result = await runEffect(Effect.exit(runWithRequestRecovery(recoverOnly => {
    calls.push(recoverOnly);
    return Effect.fail(recoverOnly ? unavailable : uncertain);
  }, policy)));
  expectCause(result, Cause.combine(Cause.fail(uncertain), Cause.fail(unavailable)));
  expect(calls).toEqual([false, true]);
});

it("does not recover read-only uncertainty or an ordinary failure", async () => {
  for (const [hasRequestKey, failure] of [[false, uncertain], [true, unavailable]] as const) {
    const calls: boolean[] = [];
    const result = await runEffect(Effect.exit(runWithRequestRecovery(recoverOnly => {
      calls.push(recoverOnly);
      return Effect.fail(failure);
    }, { ...policy, hasRequestKey })));
    expectCause(result, Cause.fail(failure));
    expect(calls).toEqual([false]);
  }
});

it("preserves defects and composite cleanup causes without recovery", async () => {
  const defect = new Error("Defect is not a retryable decision");
  for (const cause of [Cause.die(defect), Cause.combine(Cause.fail(uncertain), Cause.fail(unavailable)),
    Cause.combine(Cause.fail(uncertain), Cause.die(defect))]) {
    const calls: boolean[] = [];
    const result = await runEffect(Effect.exit(runWithRequestRecovery(recoverOnly => {
      calls.push(recoverOnly);
      return Effect.failCause(cause);
    }, policy)));
    expectCause(result, cause);
    expect(calls).toEqual([false]);
  }
});

it("preserves interruption rather than treating it as an uncertain failure", async () => {
  const calls: boolean[] = [];
  const result = await runEffect(Effect.exit(runWithRequestRecovery(recoverOnly => {
    calls.push(recoverOnly);
    return Effect.interrupt;
  }, policy)));
  expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
  expect(calls).toEqual([false]);
});
