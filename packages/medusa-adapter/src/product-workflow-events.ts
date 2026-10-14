import { Effect, Schema } from "effect";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import type { WorkflowCallResults } from "./workflow/host";
export function orderedProductWorkflowEvents(name: "product-tag.created" | "product-tag.updated" | "product-tag.deleted" | "product-variant.created" | "product.created",
  expectedIds: (calls: WorkflowCallResults) => Effect.Effect<readonly string[], CommerceTransactionError>) {
  const decode = commerceDecoder(Schema.Struct({ name: Schema.Literal(name),
    data: Schema.Struct({ id: Schema.String.check(Schema.isLengthBetween(1, 256)) }),
    metadata: Schema.Struct({ eventGroupId: Schema.String }),
  }), "unadmittedEvent");
  return {
    contracts: [{ name, decode }],
    validate: Effect.fn("ProductWorkflow.validateOrderedEvents")(function* (
      events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults,
    ) {
      const expected = yield* expectedIds(calls);
      const observed: string[] = [];
      for (const event of events) {
        if (event.contract !== name) continue;
        const message = yield* Effect.fromResult(decode(event.message));
        if (message.metadata.eventGroupId !== event.group) return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.push(message.data.id);
      }
      if (observed.length !== expected.length || observed.some((id, index) => id !== expected[index])) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
}
