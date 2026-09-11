import { Effect } from "effect";
import type { ProductCommandServices } from "./services";
import type { ProductCategoryService } from "@medusajs/product/services";
import type { FindConfig } from "@medusajs/framework/types";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { productInternalInput } from "../product-internal-input";
import { validateCategoryCommand } from "../product-category-input";
import { decodeProductRead, decodeProductCategoryRead, decodeProductFindConfig, productReadFilters } from "../product-service-input";
import { decodeProductLifecycleIds } from "../product-lifecycle";

/** Direct internal-service calls retain their own validation, capture and
 * serialization paths, without the module-service event aggregator. */
export function productInternalCommands({ metadata, withInternalProduct, withInternalCategory }:
  Pick<ProductCommandServices, "metadata" | "withInternalProduct" | "withInternalCategory">) {
  const validateInternalProduct = productInternalInput(metadata);
  const internalProductRead = (kind: "list" | "retrieve") => defineCommerceCommand("productInternalProduct" + kind, "read", Effect.fn("ProductAdapter.internalProduct." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const filters = yield* Effect.fromResult(productReadFilters(decoded));
    const copied = structuredClone({ ...decoded, filters });
    // SAFETY: generated Medusa signatures accept a wider entity type; the
    // request-owned DAL validates every query before accessing the scoped store.
    return yield* withInternalProduct(ctx, ({ productService, context }) => kind === "retrieve"
      ? productService.retrieve(copied.id as string, copied.config as FindConfig<object>, context)
      : productService.list(copied.filters as object, copied.config as FindConfig<object>, context));
  }));
  const internalProductChange = (kind: "create" | "update" | "softDelete" | "restore") => defineCommerceCommand("productInternalProduct" + kind, "write", Effect.fn("ProductAdapter.internalProduct." + kind)(function* (ctx, input) {
    if (kind === "softDelete" || kind === "restore") {
      const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      return yield* withInternalProduct(ctx, ({ productService, context }) => kind === "softDelete"
        ? productService.softDelete(typeof ids === "string" ? [ids] : [...ids], context) : productService.restore(typeof ids === "string" ? [ids] : [...ids], context));
    }
    yield* Effect.fromResult(validateInternalProduct(input, kind === "update")).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withInternalProduct(ctx, ({ productService, context }) => kind === "create"
      ? productService.create(structuredClone(input), context) : productService.update(structuredClone(input), context));
  }));
  const internalCategoryRead = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("productInternalCategory" + kind, "read", Effect.fn("ProductAdapter.internalCategory." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductCategoryRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (kind === "retrieve" ? decoded.filters !== undefined : decoded.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const copied = structuredClone(decoded);
    // SAFETY: pinned signatures promise full entities for partial reads. The DAL
    // validates every normalized query; an absent ID reaches its original error.
    const find = copied.config as Parameters<ProductCategoryService["retrieve"]>[1];
    const filters = copied.filters as Parameters<ProductCategoryService["list"]>[0];
    return yield* withInternalCategory(ctx, ({ categoryService, context }) => kind === "retrieve"
      ? categoryService.retrieve(copied.id as string, find, context)
      : kind === "count" ? categoryService.listAndCount(filters, find, context) : categoryService.list(filters, find, context));
  }));
  const internalCategoryChange = (kind: "create" | "update" | "delete") => defineCommerceCommand("productInternalCategory" + kind, "write", Effect.fn("ProductAdapter.internalCategory." + kind)(function* (ctx, input) {
    if (!Array.isArray(input) || input.length > 256) return yield* ctx.refuse(commerceError("invalidInput"));
    if (kind === "delete") {
      const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      if (typeof ids === "string") return yield* ctx.refuse(commerceError("invalidInput"));
      return yield* withInternalCategory(ctx, ({ categoryService, context }) => categoryService.delete([...ids], context));
    }
    yield* validateCategoryCommand(ctx, metadata, input);
    for (const row of input) {
      if (!isJsonObject(row)) return yield* ctx.refuse(commerceError("invalidInput"));
      if (kind === "update") {
        const { id, ...data } = row;
        if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
        yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.category.table.name, data)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      } else yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.category.table.name, row)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    }
    // SAFETY: validated external fields enter the real specialized service;
    // prepared DAL writes revalidate the resulting rank/path and scoped links.
    return yield* withInternalCategory(ctx, ({ categoryService, context }) => kind === "create"
      ? categoryService.create(structuredClone(input) as Parameters<ProductCategoryService["create"]>[0], context)
      : categoryService.update(structuredClone(input) as Parameters<ProductCategoryService["update"]>[0], context));
  }));
  return { internalProductRead, internalProductChange, internalCategoryRead, internalCategoryChange };
}
