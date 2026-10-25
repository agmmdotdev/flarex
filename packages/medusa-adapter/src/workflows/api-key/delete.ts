import { Effect, Schema } from "effect";
import { deleteApiKeysWorkflow } from "@medusajs/core-flows/api-key/delete-api-keys";
import { PublishableApiKeySalesChannel } from "@medusajs/link-modules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makeApiKeyLifecycleCommands } from "../../modules/api-key/lifecycle-service";
import { ApiKeyIds } from "../../modules/api-key/contracts";
import type { prepareApiKeyDeletionLinks } from "../../links/api-key-deletion";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type ApiKey = Effect.Success<ReturnType<typeof makeApiKeyLifecycleCommands>>;
type Links = Effect.Success<ReturnType<typeof prepareApiKeyDeletionLinks>>;
export const ApiKeyDeletionInput = Schema.Struct({ ids: ApiKeyIds });

/** The native deletion guard precedes API-only irreversible Link cleanup.
 * Both sources borrow one existing root; only its trusted owner settles. */
export const prepareApiKeyDeletionWorkflow = Effect.fn("ApiKey.prepareDeletionWorkflow")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly api_key: InstalledWorkflowModule<ApiKey["workflow"]>;
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
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["api_key", "api_key_sales_channel_links"]));
  for (const [module, name, profile] of [
    [modules.api_key.module, "flarex-api-key-lifecycle", "api-key.publishable-lifecycle"],
    [modules.api_key_sales_channel_links.module, PublishableApiKeySalesChannel.serviceName, "api-key.deletion-links"],
  ] as const) {
    const source = workflowModuleDefinition(module)?.source;
    if (source === undefined || source.name !== name || source.profile !== profile) return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  if (Object.values(modules).some(module => module.logicalResources !== undefined || module.logicalPublication !== undefined))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    api_key: { module: modules.api_key.module, methods: ["deleteApiKeys"], graph: false },
    api_key_sales_channel_links: { module: modules.api_key_sales_channel_links.module, methods: ["softDelete"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteApiKeysWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "deleteApiKeysWorkflow", resources, prepared, input: ApiKeyDeletionInput, output: Schema.Null,
      events: internalModuleWorkflowEvents } });
});
