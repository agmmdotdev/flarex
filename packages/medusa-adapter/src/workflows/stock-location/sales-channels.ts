import { Effect, Schema } from "effect";
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/core-flows/stock-location/link-sales-channels";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { ScalarId } from "../../repository/scalar-id-read";
import type { prepareSalesChannelLocationLink } from "../../links/sales-channel-location-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources } from "../../workflow/resources";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";

const Channels = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const StockLocationSalesChannelsInput = Schema.Struct({ id: ScalarId,
  add: Schema.optionalKey(Channels), remove: Schema.optionalKey(Channels) });

export const prepareStockLocationSalesChannelsWorkflow = Effect.fn("StockLocationWorkflow.salesChannels")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareSalesChannelLocationLink>>["workflow"]>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const link = yield* Effect.fromResult(captureWorkflowRecord(options.link));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ link: {
    module: link.module, methods: ["create", "dismiss"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(linkSalesChannelsToStockLocationWorkflow.prepare());
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, subscribers: options.subscribers,
    modules: { link }, workflow: { name: "stockLocationSalesChannels", resources, prepared,
      input: StockLocationSalesChannelsInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
