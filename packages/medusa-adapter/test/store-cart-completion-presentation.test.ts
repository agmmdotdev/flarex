import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { MedusaError } from "@medusajs/utils/common/errors";
import { MedusaError as FrameworkMedusaError } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { runCompletedCartRequestPromise } from "../src/http/store-cart-completion";

it("presents finished success only after the atomic owner completes", async () => {
  let drained = false;
  const work = Effect.sync(() => { drained = true; return { result: { id: "order-native" } }; });
  const response = await runCompletedCartRequestPromise(work);
  expect(drained).toBe(true);
  expect(response.result).toEqual({ id: "order-native" });
  expect(response.errors).toEqual([]);
  expect(response.transaction.hasFinished()).toBe(true);
});

it("retains the native payment refusal and complete rollback Cause for the pinned route", async () => {
  const native = new FrameworkMedusaError(MedusaError.Types.PAYMENT_REQUIRES_MORE_ERROR, "Native payment needs action");
  const cause = Cause.combine(Cause.fail(commerceError("adapterFailure", native)), Cause.fail(commerceError("rollbackOnly")));
  const response = await runCompletedCartRequestPromise(Effect.failCause(cause));
  expect(response.result).toBeUndefined();
  expect(response.transaction.hasFinished()).toBe(true);
  expect(response.errors).toHaveLength(1);
  expect(response.errors[0]?.error).toMatchObject({ type: native.type, message: native.message, cause });
});

it("keeps mixed failures, uncertainty, defects and interruption outside the native finished envelope", async () => {
  const native = new FrameworkMedusaError(MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR, "Native authorization refused");
  const business = Cause.fail(commerceError("adapterFailure", native));
  const interrupted = await Effect.runPromiseExit(Effect.interrupt);
  if (Exit.isSuccess(interrupted)) throw new Error("Expected interruption");
  const causes = [Cause.combine(business, Cause.fail(commerceError("resourceFailure"))),
    Cause.combine(business, Cause.fail(commerceError("decisionUncertain"))), Cause.die(native), interrupted.cause];
  for (const cause of causes) await expect(runCompletedCartRequestPromise(Effect.failCause(cause)))
    .rejects.toMatchObject({ message: "Product request execution failed", cause });
});
