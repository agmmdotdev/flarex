import { Effect, Schema } from "effect";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { decodeProductTagWorkflowResult } from "./product-workflow-module";
import type { WorkflowMethod } from "./workflow/module";
import type { WorkflowCallResults } from "./workflow/host";
import { ProductLifecycleIds } from "./product-lifecycle";

const decodeDeletionIds = commerceDecoder(ProductLifecycleIds, "receiptMismatch");

/** Product-tag event correlation is shared by its create and update facades.
 * Each prepared instance retains its exact name and authentic method token. */
export function productTagWorkflowEvents(name: "product-tag.created" | "product-tag.updated", method: WorkflowMethod) {
  return tagEvents(name, Effect.fn("ProductTagWorkflow.returnedIds")(function* (calls: WorkflowCallResults) {
    const ids: string[] = [];
    for (const result of calls.results(method)) {
      for (const tag of yield* Effect.fromResult(decodeProductTagWorkflowResult(result))) ids.push(tag.id);
    }
    return ids;
  }));
}

/** Deletion events describe requested IDs, including successful no-op calls. */
export function productTagDeletionEvents(method: WorkflowMethod) {
  return tagEvents("product-tag.deleted", Effect.fn("ProductTagWorkflow.requestedIds")(function* (calls: WorkflowCallResults) {
    const ids: string[] = [];
    for (const call of calls.calls(method)) ids.push(...yield* Effect.fromResult(decodeDeletionIds(call.input)));
    return ids;
  }));
}

function tagEvents(name: "product-tag.created" | "product-tag.updated" | "product-tag.deleted",
  expectedIds: (calls: WorkflowCallResults) => Effect.Effect<readonly string[], CommerceTransactionError>) {
  const decode = commerceDecoder(Schema.Struct({ name: Schema.Literal(name),
    data: Schema.Struct({ id: Schema.String.check(Schema.isLengthBetween(1, 256)) }),
    metadata: Schema.Struct({ eventGroupId: Schema.String }),
  }), "unadmittedEvent");
  return {
    contracts: [{ name, decode }],
    validate: Effect.fn("ProductTagWorkflow.validateEvents")(function* (
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
