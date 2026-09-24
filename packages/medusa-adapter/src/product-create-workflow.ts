import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductsStep } from "@medusajs/core-flows/product/create-products-step";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductCreateGraphInput, type ProductWorkflowModule } from "./product-workflow-module";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

export const ProductCreateInput = Schema.Struct({
  products: Schema.Array(ProductCreateGraphInput).check(Schema.isLengthBetween(1, 4)),
});
export const ProductCreateOutput = Schema.Struct({
  products: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String,
    images: Schema.Array(Schema.JsonObject), options: Schema.Array(Schema.JsonObject), variants: Schema.Array(Schema.JsonObject),
    tags: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, value: Schema.String }),
      [Schema.Record(Schema.String, Schema.Json)])),
    categories: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, name: Schema.String }),
      [Schema.Record(Schema.String, Schema.Json)])),
  })).check(Schema.isLengthBetween(1, 4)),
});

/** Native creation and pending graph read for owned rows and memberships. */
const productCreateWorkflow = createWorkflow("create-products-owned-graph", (input: WorkflowData<typeof ProductCreateInput.Type>) => {
  const products = createProductsStep(transform(input.products, values => values.map(value => {
    const { collection_id, images, options, variants, tag_ids, category_ids, ...scalar } = value;
    return { ...scalar,
      ...(collection_id == null ? {} : { collection_id }),
      ...(tag_ids === undefined ? {} : { tag_ids: [...tag_ids] }),
      ...(category_ids === undefined ? {} : { category_ids: [...category_ids] }),
      ...(images === undefined ? {} : { images: images.map(image => ({ ...image })) }),
      ...(options === undefined ? {} : { options: options.map(option => ({ ...option, values: [...option.values] })) }),
      ...(variants === undefined ? {} : { variants: variants.map(variant => ({ ...variant, options: { ...variant.options } })) }),
    };
  })));
  const ids = transform(products, values => values.map(value => value.id));
  const pending = useQueryGraphStep({ entity: "product", fields: ["id", "title", "images.id", "images.url",
    "options.id", "options.title", "options.values.id", "options.values.value",
    "variants.id", "variants.title", "variants.options.id", "variants.options.value",
    "tags.id", "tags.value", "categories.id", "categories.name"],
    filters: { id: ids }, pagination: { take: 4 },
  });
  const selected = transform({ created: products, observed: pending.data }, ({ created, observed }) => created.map(product => {
    const row = observed.find(candidate => candidate.id === product.id);
    if (row?.title !== product.title) throw commerceError("receiptMismatch");
    return { id: product.id, title: product.title, images: row.images, options: row.options, variants: row.variants,
      tags: row.tags, categories: row.categories };
  }));
  return new WorkflowResponse({ products: selected });
});

export const prepareProductCreateWorkflow = Effect.fn("MedusaWorkflow.prepareProductCreate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule, "logical"> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)) };
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProducts"], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(productCreateWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "productCreate", resources, prepared, input: ProductCreateInput, output: ProductCreateOutput,
    events: internalModuleWorkflowEvents,
  } });
});
