import { Effect, Option } from "effect";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { WorkflowDefinitionError, type PreparedWorkflow, type WorkflowContainer } from "@medusajs/workflows-sdk";
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
      catch: cause => cause instanceof CommerceTransactionError ? cause : commerceError(cause instanceof WorkflowDefinitionError ? "unsupportedProfile" : "adapterFailure", cause),
    }),
  })).pipe(
    Effect.catchTag("WorkflowDefinitionError", cause => ctx.refuse(commerceError("unsupportedProfile", cause))),
    Effect.flatMap(value => {
      const refusal = owner.refusal();
      if (Option.isSome(refusal)) return ctx.refuse(refusal.value);
      // Like Convex's return boundary, a completed void workflow stores null.
      // Intermediate omissions and nested JSON validation keep their owners.
      return owner.hasPending() ? ctx.refuse(commerceError("overlappingOperation")) : ctx.capture(value === undefined ? null : value);
    }),
    Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)),
    Effect.ensuring(owner.close),
  );
});
