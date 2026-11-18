import { Effect, Schema } from "effect";
import { createSalesChannelsWorkflow } from "@medusajs/core-flows/sales-channel/create-sales-channels";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { SalesChannelCreateInput, SalesChannelCreatedRow } from "../../modules/sales-channel/create-input";
import type { makeLocalSalesChannelCommands } from "../../modules/sales-channel/service";
import { commerceDecoder } from "../../value/decoder";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type SalesChannel = Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>["workflow"];
export const SalesChannelCreationInput = Schema.Struct({
  salesChannelsData: Schema.Array(SalesChannelCreateInput).check(Schema.isMaxLength(4)),
});
export const SalesChannelCreationOutput = Schema.Array(SalesChannelCreatedRow).check(Schema.isMaxLength(4));
const decodeCreated = commerceDecoder(SalesChannelCreationOutput, "receiptMismatch");

/** The genuine creation composer borrows one existing finite Sales Channel
 * participant. Defaults, persistence and internal events retain their owners. */
export const prepareSalesChannelCreationWorkflow = Effect.fn("SalesChannel.prepareCreation")(function* (input: {
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
  if (source?.name !== "flarex-sales-channel-local" || source.profile !== "sales-channel")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    sales_channel: { module: modules.sales_channel.module, methods: ["createSalesChannels"], graph: false },
  }, true));
  const prepared = yield* Effect.fromResult(createSalesChannelsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents("sales-channel.created", Effect.fn("SalesChannel.createdIds")(function* (calls) {
    const writes = calls.calls(modules.sales_channel.module.methods.createSalesChannels), call = writes[0];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    return (yield* Effect.fromResult(decodeCreated(call.result))).map(row => row.id);
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "createSalesChannelsWorkflow", resources, prepared,
      input: SalesChannelCreationInput, output: SalesChannelCreationOutput, events } });
});
