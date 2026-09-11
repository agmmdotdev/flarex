import { Effect, type Result } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineProductModule } from "../product-module";
import type { CommerceModuleScope } from "../module-definition";
import { productRuntimeMetadata } from "../product-runtime-metadata";
import { captureProductSchema } from "../product-schema";

type ProductModule = Result.Result.Success<ReturnType<typeof defineProductModule>>;
type ProductScope = CommerceModuleScope<ProductModule>;

/** Definition-local profiles; live services and managers are still constructed
 * only by each module's command-owned use operation. No singleton runtime. */
export const prepareProductCommandServices = Effect.fn("ProductAdapter.prepareCommandServices")(function* () {
  const captured = yield* captureProductSchema("product-runtime-contract");
  const metadata = yield* productRuntimeMetadata(captured.metadata.frame);
  const standard = yield* Effect.fromResult(defineProductModule(metadata));
  const category = yield* Effect.fromResult(defineProductModule(metadata, "categoryProjection"));
  const collection = yield* Effect.fromResult(defineProductModule(metadata, "collectionMembership"));
  const internal = yield* Effect.fromResult(defineProductModule(metadata, "internalProduct"));
  const withService = standard.use;
  const withCategoryReadService = category.use;
  const withCollectionService = collection.use;
  // Direct internal calls intentionally have no EmitEvents aggregator. Preserve
  // their distinct serialization/capture at this command boundary.
  const withInternalCategory = Effect.fn("ProductAdapter.withInternalCategory")((ctx: CommerceCommandContext, work: (value: ProductScope) => Promise<unknown>) =>
    category.use(ctx, async value => value.repository.serialize(await work(value))));
  const withInternalProduct = Effect.fn("ProductAdapter.withInternalProduct")((ctx: CommerceCommandContext, work: (value: ProductScope) => Promise<unknown>) =>
    internal.use(ctx, async value => value.capture(await work(value))));
  return { metadata, description: standard.description, withService, withCategoryReadService,
    withCollectionService, withInternalCategory, withInternalProduct };
});
export type ProductCommandServices = Effect.Success<ReturnType<typeof prepareProductCommandServices>>;
