import { Effect } from "effect";
import { orderedProductWorkflowEvents } from "./events";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";

import { commerceDecoder } from "../../value/decoder";
import { decodeProductTagWorkflowResult } from "../../modules/product/workflow";
import type { WorkflowMethod } from "../../workflow/module";
import type { WorkflowCallResults } from "../../workflow/host";
import { ProductLifecycleIds } from "../../modules/product/lifecycle";

const decodeDeletionIds = commerceDecoder(ProductLifecycleIds, "receiptMismatch");

/** Reuse each operation's correlation against the one ordered root transcript. */
export function composedProductTagEvents(methods: { readonly create?: WorkflowMethod; readonly update?: WorkflowMethod; readonly delete?: WorkflowMethod }) {
  const policies = [
    ...(methods.create === undefined ? [] : [productTagWorkflowEvents("product-tag.created", methods.create)]),
    ...(methods.update === undefined ? [] : [productTagWorkflowEvents("product-tag.updated", methods.update)]),
    ...(methods.delete === undefined ? [] : [productTagDeletionEvents(methods.delete)]),
  ];
  return {
    contracts: policies.flatMap(policy => policy.contracts),
    validate: Effect.fn("ProductTagWorkflow.validateComposition")(function* (
      events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults,
    ) {
      for (const policy of policies) yield* policy.validate(events, calls);
    }),
  };
}

/** Product-tag event correlation is shared by its create and update facades.
 * Each prepared instance retains its exact name and authentic method token. */
export function productTagWorkflowEvents(name: "product-tag.created" | "product-tag.updated", method: WorkflowMethod) {
  return orderedProductWorkflowEvents(name, Effect.fn("ProductTagWorkflow.returnedIds")(function* (calls: WorkflowCallResults) {
    const ids: string[] = [];
    for (const result of calls.results(method)) {
      for (const tag of yield* Effect.fromResult(decodeProductTagWorkflowResult(result))) ids.push(tag.id);
    }
    return ids;
  }));
}
/** Deletion events describe requested IDs, including successful no-op calls. */
export function productTagDeletionEvents(method: WorkflowMethod) {
  return orderedProductWorkflowEvents("product-tag.deleted", Effect.fn("ProductTagWorkflow.requestedIds")(function* (calls: WorkflowCallResults) {
    const ids: string[] = [];
    for (const call of calls.calls(method)) ids.push(...yield* Effect.fromResult(decodeDeletionIds(call.input)));
    return ids;
  }));
}
