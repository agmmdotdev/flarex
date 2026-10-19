import { Effect, Schema } from "effect";
import { linkProductsToSalesChannelWorkflow } from "@medusajs/core-flows/sales-channel/link-products";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import type { prepareProductSalesChannelLink } from "../../links/product-sales-channel-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources } from "../../workflow/resources";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";

const Products = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ProductSalesChannelMembershipInput = Schema.Struct({ id: ScalarId,
  add: Schema.optionalKey(Products), remove: Schema.optionalKey(Products) });

/** Native membership and retained compensation borrow only the existing Link
 * create/dismiss pair. Endpoint reads and mutations are not workflow resources. */
export const prepareProductSalesChannelMembershipWorkflow = Effect.fn("ProductWorkflow.salesChannelMembership")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareProductSalesChannelLink>>["workflow"]>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules({ link: options.link }, ["link"]));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ link: {
    module: modules.link.module, methods: ["create", "dismiss"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(linkProductsToSalesChannelWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, subscribers: options.subscribers,
    modules, workflow: { name: "productSalesChannelMembership", resources, prepared,
      input: ProductSalesChannelMembershipInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
