import { Effect } from "effect";
import { updateSalesChannelsWorkflow } from "@medusajs/core-flows/sales-channel/update-sales-channels";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { SalesChannelCreatedRow } from "../../modules/sales-channel/create-input";
import { SalesChannelUpdateInput } from "../../modules/sales-channel/update-input";
import type { makeLocalSalesChannelCommands } from "../../modules/sales-channel/service";
import { commerceDecoder } from "../../value/decoder";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowMethodDefinition, workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { SalesChannelUpdateInput };
export const SalesChannelUpdateWorkflowOutput = SalesChannelCreatedRow;
type SalesChannel = Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>["updateWorkflow"];
const decodeUpdated = commerceDecoder(SalesChannelUpdateWorkflowOutput, "receiptMismatch");

/** Preserve the native selector/object-update scalar result. Its genuine
 * zero-match undefined result fails inside the native composer before settlement. */
export const prepareSalesChannelUpdateWorkflow = Effect.fn("SalesChannel.prepareUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly sales_channel: InstalledWorkflowModule<SalesChannel> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(options.modules, ["sales_channel"]));
  const source = workflowModuleDefinition(modules.sales_channel.module)?.source;
  if (source?.name !== "flarex-sales-channel-local" || source.profile !== "sales-channel.update-workflows")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const updateMethod = workflowMethodDefinition(modules.sales_channel.module.methods.updateSalesChannels);
  if (updateMethod === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    sales_channel: { module: modules.sales_channel.module, methods: ["listSalesChannels", "updateSalesChannels"], graph: false },
  }, true));
  const prepared = yield* Effect.fromResult(updateSalesChannelsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents("sales-channel.updated", Effect.fn("SalesChannel.updatedId")(function* (calls) {
    const writes = calls.calls(modules.sales_channel.module.methods.updateSalesChannels), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    const nativeResult = yield* Effect.fromResult(updateMethod.output(call.result));
    const row = yield* Effect.fromResult(decodeUpdated(nativeResult));
    return [row.id];
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "updateSalesChannelsWorkflow", resources, prepared,
      input: SalesChannelUpdateInput, output: SalesChannelUpdateWorkflowOutput, events } });
});
