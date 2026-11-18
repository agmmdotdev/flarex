import { Effect } from "effect";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition, type WorkflowModule } from "../../workflow/module";

export interface ApiKeyWorkflowOptions<Module extends WorkflowModule> {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly api_key: InstalledWorkflowModule<Module> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}

/** Fixed API Key facades share option and participant admission. Callers cannot
 * replace the graph, callbacks, resources, publication or logical limits. */
export const prepareApiKeyParticipant = Effect.fn("ApiKey.prepareParticipant")(function* <Module extends WorkflowModule>(
  input: ApiKeyWorkflowOptions<Module>, profile: "creation" | "lifecycle") {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["api_key"]));
  const source = workflowModuleDefinition(modules.api_key.module)?.source;
  if (source?.name !== `flarex-api-key-${profile}` || source.profile !== `api-key.publishable-${profile}`)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.api_key.logicalResources !== undefined || modules.api_key.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return { options, modules };
});
