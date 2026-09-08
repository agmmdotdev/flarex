import { Cause, Effect, Exit, Result } from "effect";
import { expect, it } from "vitest";
import { makeBoundedRequestLifetime, projectBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { cmsError, CmsTransactionError } from "../src/cmsTransaction/model";
import { commerceError, CommerceTransactionError } from "../src/commerceTransaction/model";
import { compositeError, type CompositeFailure } from "../src/crossDomainCommand/model";
import { runEffect } from "./effectTestRuntime";

const make = () => makeBoundedRequestLifetime<CompositeFailure, object, object>(compositeError,
  { calls: 8, commandBytes: 100, commandMs: 1000 }, {}, {}, "composite-lifetime", "write");
it("shares operation and byte ceilings across domain projections", () => runEffect(Effect.gen(function* () {
  const root = yield* make();
  const cms = projectBoundedRequestLifetime(root, error => error instanceof CmsTransactionError ? error : cmsError("rollbackOnly", error));
  const commerce = projectBoundedRequestLifetime(root, error => error instanceof CommerceTransactionError ? error : commerceError("rollbackOnly", error));
  expect(Result.isSuccess(cms.charge(60))).toBe(true);
  expect(commerce.remainingBytes()).toBe(40);
  expect(Result.isFailure(commerce.charge(41))).toBe(true);
  expect(Exit.isFailure(yield* Effect.exit(root.seal))).toBe(true);
  yield* root.close;
  const counted = yield* make();
  const first = projectBoundedRequestLifetime(counted, error => error instanceof CmsTransactionError ? error : cmsError("rollbackOnly", error));
  const second = projectBoundedRequestLifetime(counted, error => error instanceof CommerceTransactionError ? error : commerceError("rollbackOnly", error));
  for (let index = 0; index < 7; index++) yield* (index % 2 === 0 ? first.begin(first.context) : second.begin(second.context));
  expect(Result.isFailure(yield* Effect.result(second.begin(second.context)))).toBe(true);
  expect(Exit.isFailure(yield* Effect.exit(counted.seal))).toBe(true);
  yield* counted.close;
})));
it("retains a caught domain failure and revokes borrowed contexts across domains", () => runEffect(Effect.gen(function* () {
  const root = yield* make();
  const cms = projectBoundedRequestLifetime(root, error => error instanceof CmsTransactionError ? error : cmsError("rollbackOnly", error));
  const commerce = projectBoundedRequestLifetime(root, error => error instanceof CommerceTransactionError ? error : commerceError("rollbackOnly", error));
  const escaped = yield* cms.nested(cms.context, "composite-lifetime", context => Effect.succeed(context));
  expect(Result.isFailure(yield* Effect.result(commerce.begin(escaped)))).toBe(true);
  yield* root.close;
  expect(Result.isFailure(yield* Effect.result(cms.begin(cms.context)))).toBe(true);
  const failing = yield* make();
  const domain = projectBoundedRequestLifetime(failing, error => error instanceof CmsTransactionError ? error : cmsError("rollbackOnly", error));
  const failure = cmsError("documentInvalid");
  yield* domain.nested(domain.context, "composite-lifetime", () => Effect.fail(failure)).pipe(Effect.result);
  const outcome = yield* Effect.exit(failing.seal);
  expect(Exit.isFailure(outcome)).toBe(true);
  if (Exit.isFailure(outcome)) expect(Cause.pretty(outcome.cause)).toContain("CmsTransactionError");
  yield* failing.close;
})));
