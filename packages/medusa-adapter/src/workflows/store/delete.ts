import { Effect, Schema, type Result } from "effect";
import { deleteStoresWorkflow } from "@medusajs/core-flows/store/delete-stores";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { StoreDeletionIds } from "../../modules/store/delete-input";
import type { makeStoreDeletionCommands } from "../../modules/store/delete-service";
import type { prepareStoreDeletionLinkResource } from "../../links/store-deletion";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Store = Effect.Success<ReturnType<typeof makeStoreDeletionCommands>>["workflow"];
type Links = Result.Result.Success<ReturnType<typeof prepareStoreDeletionLinkResource>>;
export const StoreDeletionInput = Schema.Struct({ ids: StoreDeletionIds });

/** Genuine Store lifecycle and empty-family Link dispatch share the trusted
 * outer attempt. Scalar default endpoint IDs grant no endpoint mutations. */
export const prepareStoreDeletionWorkflow = Effect.fn("Store.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly store: InstalledWorkflowModule<Store> };
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["store"]));
  const definition = workflowModuleDefinition(modules.store.module);
  if (definition === undefined || definition.source.name !== "flarex-store-delete" || definition.source.profile !== "store-delete")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    store: { module: modules.store.module, methods: ["softDeleteStores", "restoreStores"], graph: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteStoresWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    workflow: { name: "deleteStoresWorkflow", resources, prepared,
      input: StoreDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
