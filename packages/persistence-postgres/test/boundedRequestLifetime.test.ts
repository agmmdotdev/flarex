import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { commerceError } from "../src/commerceTransaction/model";
import { runEffect } from "./effectTestRuntime";

const make = () => makeBoundedRequestLifetime(commerceError,
  { calls: 16, commandBytes: 100, commandMs: 10000 }, {}, {}, "request", "write");

it("retains the first statement cause through repeated rollback-only refusals", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const statement = commerceError("statementFailure", { code: "57014" });
  const first = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(statement)));
  if (!Exit.isFailure(first)) throw new Error("Expected statement failure");
  let ran = false;
  for (let index = 0; index < 2; index++) {
    const refusal = yield* Effect.flip(lifetime.operation(lifetime.context, "request", "read",
      Effect.sync(() => { ran = true; })));
    expect(refusal.reason).toBe("rollbackOnly");
    expect(refusal.cause).toEqual(first.cause);
    if (!Cause.isCause(refusal.cause)) throw new Error("Expected retained cause");
    const reason = refusal.cause.reasons[0];
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected statement reason");
    expect(reason.error).toBe(statement);
  }
  expect(ran).toBe(false);
  expect(lifetime.isClosing()).toBe(false);
  const sealed = yield* Effect.exit(lifetime.seal);
  if (!Exit.isFailure(sealed)) throw new Error("Expected rollback-only seal");
  expect(sealed.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === statement)).toBe(true);
  yield* lifetime.close;
})));

it("retains complete defect causes without reclassifying them as typed failures", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const defect = new Error("driver defect");
  const first = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.die(defect)));
  if (!Exit.isFailure(first)) throw new Error("Expected defect");
  const refusal = yield* Effect.flip(lifetime.begin(lifetime.context));
  expect(refusal.reason).toBe("rollbackOnly");
  expect(refusal.cause).toEqual(first.cause);
  expect(first.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
  yield* lifetime.close;
})));

it("does not disclose latched causes to foreign, revoked or closed contexts", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const foreign = yield* make();
  const child = yield* lifetime.nested(lifetime.context, "request", Effect.succeed);
  yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(commerceError("statementFailure"))));
  for (const context of [foreign.context, child]) {
    const refusal = yield* Effect.flip(lifetime.begin(context));
    expect(refusal.reason).toBe("invalidAuthority");
    expect(refusal.cause).toBeUndefined();
  }
  yield* lifetime.close;
  const closed = yield* Effect.flip(lifetime.begin(lifetime.context));
  expect(closed.reason).toBe("invalidAuthority");
  expect(closed.cause).toBeUndefined();
  yield* foreign.close;
})));
