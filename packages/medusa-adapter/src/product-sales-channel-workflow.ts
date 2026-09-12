import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductsStep } from "@medusajs/core-flows/product/create-products-step";
import { createSalesChannelsStep } from "@medusajs/core-flows/sales-channel/create-sales-channels-step";
import { associateProductsWithSalesChannelsStep } from "@medusajs/core-flows/sales-channel/associate-products-with-channels-step";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { SimpleProductInput, type ProductWorkflowModule } from "./product-workflow-module";
import { SimpleSalesChannelInput, type makeLocalSalesChannelCommands } from "./sales-channel-service";
import type { prepareLocalProductSalesChannelLink } from "./product-sales-channel-link-service";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

export const ProductSalesChannelInput = Schema.Struct({
  salesChannel: SimpleSalesChannelInput,
  products: Schema.Array(SimpleProductInput).check(Schema.isLengthBetween(1, 4)),
});
export const ProductSalesChannelOutput = Schema.Struct({
  products: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })).check(Schema.isLengthBetween(1, 4)),
  salesChannels: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })).check(Schema.isLengthBetween(1, 1)),
  links: Schema.Array(Schema.Struct({ id: Schema.String, product_id: Schema.String, sales_channel_id: Schema.String })).check(Schema.isLengthBetween(1, 4)),
});

/** Private simple creation milestone, not Medusa's full createProductsWorkflow.
 * Native callbacks share one existing atomic root; queries see its pending rows. */
export const productSalesChannelWorkflow = createWorkflow("create-products-in-sales-channel", (input: WorkflowData<typeof ProductSalesChannelInput.Type>) => {
  const channels = createSalesChannelsStep({ data: transform(input.salesChannel, channel => [channel]) });
  const products = createProductsStep(transform(input.products, products => [...products]));
  const pairs = transform({ channels, products }, ({ channels, products }) => channels.flatMap(channel =>
    products.map(product => ({ product_id: product.id, sales_channel_id: channel.id }))));
  associateProductsWithSalesChannelsStep({ links: pairs });
  const ids = transform({ channels, products }, ({ channels, products }) => ({
    products: products.map(product => product.id), channels: channels.map(channel => channel.id),
  }));
  const pendingProducts = useQueryGraphStep({ entity: "product", fields: ["id", "title"],
    filters: { id: ids.products }, pagination: { take: 4 },
  }).config({ name: "pending-products" });
  const pendingChannels = useQueryGraphStep({ entity: "sales_channel", fields: ["id", "name"],
    filters: { id: ids.channels }, pagination: { take: 1 },
  }).config({ name: "pending-sales-channel" });
  const pendingLinks = useQueryGraphStep({ entity: "product_sales_channels", fields: ["id", "product_id", "sales_channel_id"],
    filters: { product_id: ids.products, sales_channel_id: ids.channels }, pagination: { take: 4 },
  }).config({ name: "pending-product-sales-channel-links" });
  return new WorkflowResponse({ products: pendingProducts.data, salesChannels: pendingChannels.data, links: pendingLinks.data });
});

export const prepareProductSalesChannelWorkflow = Effect.fn("MedusaWorkflow.prepareProductSalesChannel")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly product: InstalledWorkflowModule<ProductWorkflowModule>;
    readonly sales_channel: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>["workflow"]>;
    readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareLocalProductSalesChannelLink>>["workflow"]>;
  };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = {
    product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)),
    sales_channel: yield* Effect.fromResult(captureWorkflowRecord(registrations.sales_channel)),
    link: yield* Effect.fromResult(captureWorkflowRecord(registrations.link)),
  };
  if (Object.keys(registrations).length !== 3) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProducts"], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: ["createSalesChannels"], graph: true },
    link: { module: modules.link.module, methods: ["create"], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(productSalesChannelWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "productSalesChannel", resources, prepared,
    input: ProductSalesChannelInput, output: ProductSalesChannelOutput, events: internalModuleWorkflowEvents,
  } });
});
