import { Effect, Schema } from "effect";
import { deleteSalesChannelsWorkflow } from "@medusajs/core-flows/sales-channel/delete-sales-channels";
import { SalesChannelLocation } from "@medusajs/link-modules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makeStoreGuardCommands } from "../../modules/store/service";
import type { makeLocalSalesChannelCommands } from "../../modules/sales-channel/service";
import { SalesChannelDeletionIds } from "../../modules/sales-channel/delete-input";
import type { prepareSalesChannelDeletionLinks } from "../../links/sales-channel-deletion";
import { commerceDecoder } from "../../value/decoder";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Store = Effect.Success<ReturnType<typeof makeStoreGuardCommands>>["workflow"];
type SalesChannel = Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>["deleteWorkflow"];
type Links = Effect.Success<ReturnType<typeof prepareSalesChannelDeletionLinks>>;
export const SalesChannelDeletionInput = Schema.Struct({ ids: SalesChannelDeletionIds });
const decodeIds = commerceDecoder(SalesChannelDeletionIds, "receiptMismatch");

/** The native Store guard and both non-cascading Link families borrow distinct
 * source participants. The existing atomic owner alone settles this root. */
export const prepareSalesChannelDeletionWorkflow = Effect.fn("SalesChannel.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly store: InstalledWorkflowModule<Store>;
    readonly sales_channel: InstalledWorkflowModule<SalesChannel>;
    readonly product_sales_channel_links: InstalledWorkflowModule<Links["sales"]["workflow"]>;
    readonly sales_channel_location_links: InstalledWorkflowModule<Links["location"]["workflow"]>;
  };
  readonly link: Links["resource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations,
    ["store", "sales_channel", "product_sales_channel_links", "sales_channel_location_links"]));
  if (Object.keys(registrations).length !== 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
  for (const [module, name, profile] of [
    [modules.store.module, "flarex-store-sales-channel-guard", "store.sales-channel-guard"],
    [modules.sales_channel.module, "flarex-sales-channel-local", "sales-channel.delete-workflows"],
    [modules.product_sales_channel_links.module, "flarex-product-links", "sales-channel-deletions"],
    [modules.sales_channel_location_links.module, SalesChannelLocation.serviceName, "sales-channel-deletions"],
  ] as const) {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined || definition.source.name !== name || definition.source.profile !== profile)
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    store: { module: modules.store.module, methods: ["listStores"], graph: false },
    sales_channel: { module: modules.sales_channel.module, methods: ["softDeleteSalesChannels", "restoreSalesChannels"], graph: false },
    product_sales_channel_links: { module: modules.product_sales_channel_links.module, methods: ["softDelete", "restore"], graph: false, expose: false },
    sales_channel_location_links: { module: modules.sales_channel_location_links.module, methods: ["softDelete", "restore"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteSalesChannelsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents("sales-channel.deleted", Effect.fn("SalesChannel.deletedIds")(function* (calls) {
    const selected = calls.calls(modules.sales_channel.module.methods.softDeleteSalesChannels);
    const call = selected[0];
    if (selected.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    return yield* Effect.fromResult(decodeIds(call.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    workflow: { name: "deleteSalesChannelsWorkflow", resources, prepared,
      input: SalesChannelDeletionInput, output: Schema.Null, events } });
});
