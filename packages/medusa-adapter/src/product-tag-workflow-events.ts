import { Effect, Schema } from "effect";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { decodeProductTagWorkflowResult } from "./product-workflow-module";
import type { WorkflowMethod } from "./workflow/module";
import type { WorkflowCallResults } from "./workflow/host";

/** Product-tag event correlation is shared by its create and update facades.
 * Each prepared instance retains its exact name and authentic method token. */
export function productTagWorkflowEvents(name: "product-tag.created" | "product-tag.updated", method: WorkflowMethod) {
  const decode = commerceDecoder(Schema.Struct({ name: Schema.Literal(name),
    data: Schema.Struct({ id: Schema.String.check(Schema.isLengthBetween(1, 256)) }),
    metadata: Schema.Struct({ eventGroupId: Schema.String }),
  }), "unadmittedEvent");
  return {
    contracts: [{ name, decode }],
    validate: Effect.fn("ProductTagWorkflow.validateEvents")(function* (
      events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults,
    ) {
      const expected: string[] = [];
      for (const result of calls.results(method)) {
        for (const tag of yield* Effect.fromResult(decodeProductTagWorkflowResult(result))) expected.push(tag.id);
      }
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
