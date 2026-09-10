import { Effect, Option } from "effect";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import type { PreparedWorkflow, WorkflowContainer } from "@medusajs/workflows-sdk";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "./commerce-promise-owner";
import { captureWorkflowValue } from "./workflow-value";

/** One native root owns the foreign step/hook callbacks and their service runners. */
export const runNativeMedusaWorkflow = Effect.fn("MedusaWorkflow.runNative")(function* (
  definition: PreparedWorkflow, ctx: AtomicCommerceContext, input: unknown,
  bind: (owner: CommercePromiseOwner) => WorkflowContainer,
) {
  const owner = makeCommercePromiseOwner();
  return yield* Effect.suspend(() => executeWorkflow(definition, input, {
    checkpoint: ctx.checkpoint,
    capture: value => captureWorkflowValue(ctx, value),
    context: { container: bind(owner), eventGroupId: ctx.eventGroupId },
    invoke: work => Effect.tryPromise({
      try: signal => owner.callback(() => Promise.resolve(work()), signal),
      catch: cause => cause instanceof CommerceTransactionError ? cause : commerceError("adapterFailure", cause),
    }),
  })).pipe(
    Effect.catchTag("WorkflowDefinitionError", cause => ctx.refuse(commerceError("unsupportedProfile", cause))),
    Effect.flatMap(value => {
      const refusal = owner.refusal();
      if (Option.isSome(refusal)) return ctx.refuse(refusal.value);
      return owner.hasPending() ? ctx.refuse(commerceError("overlappingOperation")) : ctx.capture(value);
    }),
    Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)),
    Effect.ensuring(owner.close),
  );
});
