import type { Effect } from "effect";
import type { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { WorkflowCallResults } from "../../workflow/host";
import { orderedWorkflowIdEvents } from "../../workflow/events";

export function orderedProductWorkflowEvents(name: "product-option.created" | "product-option.updated" | "product-option.deleted" | "product-category.created" | "product-category.updated" | "product-category.deleted" | "product-collection.created" | "product-collection.updated" | "product-collection.deleted" | "product-tag.created" | "product-tag.updated" | "product-tag.deleted" | "product-type.created" | "product-type.updated" | "product-type.deleted" | "product-variant.created" | "product-variant.updated" | "product-variant.deleted" | "product.created" | "product.updated" | "product.deleted",
  expectedIds: (calls: WorkflowCallResults) => Effect.Effect<readonly string[], CommerceTransactionError>) {
  return orderedWorkflowIdEvents(name, expectedIds);
}
