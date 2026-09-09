import { Effect } from "effect";
import type { PerformedActions } from "@medusajs/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { productReplacementProfile } from "./product-graph-profile";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { replaceGraphRows } from "./write/replace";

/** Product supplies module policy; the shared planner retains the scoped manager. */
export const replaceProductRows = Effect.fn("ProductAdapter.replaceRows")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, entity: ProductEntityMetadata,
  input: unknown, config: unknown, creation = false,
) {
  const result = yield* replaceGraphRows(ctx, productReplacementProfile(catalog), entity, input, config, creation);
  // SAFETY: Product runtime metadata admits only id primary keys. Core decodes
  // returned rows; the pinned action helper projects that exact checked key.
  // Restore Medusa's legacy mutable DAL type only at this Product boundary.
  return { entities: result.entities, performedActions: result.performedActions as PerformedActions };
});
