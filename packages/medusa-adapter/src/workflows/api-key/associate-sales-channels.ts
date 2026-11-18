import { Effect, Schema } from "effect";
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/core-flows/api-key/link-sales-channels-to-publishable-key";
import { LINKS } from "@medusajs/framework/utils/portable";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { prepareApiKeyAssociationLinks } from "../../links/api-key-associations";
import type { prepareSalesChannelApiKeyRead } from "../../modules/sales-channel/api-key-read";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { apiKeyAssociationResources } from "../../workflow/policy";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Links = Effect.Success<ReturnType<typeof prepareApiKeyAssociationLinks>>;
type SalesChannel = Effect.Success<ReturnType<typeof prepareSalesChannelApiKeyRead>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).check(Schema.isMaxLength(4));
export const ApiKeyAssociationInput = Schema.Struct({ id: Id, add: Schema.optionalKey(Ids), remove: Schema.optionalKey(Ids) });

/** Native validation checks additions through the actual Sales Channel module.
 * No API Key existence guard is added to the pinned native workflow. */
export const prepareApiKeyAssociationWorkflow = Effect.fn("ApiKey.prepareAssociationWorkflow")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly sales_channel: InstalledWorkflowModule<SalesChannel["workflow"]>;
    readonly api_key_sales_channel_links: InstalledWorkflowModule<Links["workflow"]>;
  };
  readonly link: Links["resource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["sales_channel", "api_key_sales_channel_links"]));
  for (const [module, name, profile] of [
    [modules.sales_channel.module, "flarex-sales-channel-local", "sales-channel.api-key-read"],
    [modules.api_key_sales_channel_links.module, LINKS.PublishableApiKeySalesChannel, "api-key.association-links"],
  ] as const) {
    const source = workflowModuleDefinition(module)?.source;
    if (source === undefined || source.name !== name || source.profile !== profile) return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  if (Object.values(modules).some(module => module.logicalResources !== undefined || module.logicalPublication !== undefined))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    sales_channel: { module: modules.sales_channel.module, methods: ["listSalesChannels"], graph: false },
    api_key_sales_channel_links: { module: modules.api_key_sales_channel_links.module,
      methods: ["applyOperation", "compensateOperation"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(linkSalesChannelsToApiKeyWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision,
    subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    requestCallLimit: apiKeyAssociationResources.calls,
    workflow: { name: "linkSalesChannelsToApiKeyWorkflow", resources, prepared, input: ApiKeyAssociationInput,
      output: Schema.Null, events: internalModuleWorkflowEvents } });
});
