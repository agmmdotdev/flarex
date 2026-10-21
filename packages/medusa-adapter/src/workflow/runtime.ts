import { Effect } from "effect";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { WorkflowDefinitionError, type PreparedWorkflow, type WorkflowContainer } from "@medusajs/workflows-sdk";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "../module/promise-owner";
import { captureWorkflowValue } from "./value";
import { captureCommerceInput } from "../value/input";

/** One native root owns the foreign step/hook callbacks and their service runners. */
export const runNativeMedusaWorkflow = Effect.fn("MedusaWorkflow.runNative")(function* (
  definition: PreparedWorkflow, ctx: AtomicCommerceContext, input: unknown,
  bind: (owner: CommercePromiseOwner) => WorkflowContainer,
) {
  const owner = yield* makeCommercePromiseOwner(ctx.recordFailure);
  return yield* owner.withClose(Effect.gen(function* () {
    const container = yield* owner.invoke(async () => bind(owner));
    return yield* executeWorkflow(definition, input, {
    checkpoint: ctx.checkpoint,
    capture: value => captureWorkflowValue(ctx, value),
    context: { container, eventGroupId: ctx.eventGroupId },
    invoke: work => owner.invoke(() => Promise.resolve(work()), error => error instanceof WorkflowDefinitionError
      ? commerceError("unsupportedProfile", error) : undefined),
    });
  }).pipe(
    Effect.catchTag("WorkflowDefinitionError", cause => ctx.refuse(commerceError("unsupportedProfile", cause))),
    Effect.flatMap(value => {
      // Like Convex's return boundary, a completed void workflow stores null.
      // Intermediate omissions and nested JSON validation keep their owners.
      return owner.hasPending() ? ctx.refuse(commerceError("overlappingOperation"))
        : ctx.capture(value === undefined ? null : value, captureCommerceInput);
    }),
  ));
});
