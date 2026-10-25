import { Effect, Schema } from "effect";
import { createApiKeysWorkflow } from "@medusajs/core-flows/api-key/create-api-keys";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ApiKeyCreationInput } from "../../modules/api-key/contracts";
import type { makeApiKeyCreationCommands } from "../../modules/api-key/service";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { prepareApiKeyParticipant, type ApiKeyWorkflowOptions } from "./participant";

type ApiKey = Effect.Success<ReturnType<typeof makeApiKeyCreationCommands>>;

/** A fixed native graph borrows the API Key participant. The privileged inverse
 * is available only to that retained graph, never as a direct public command. */
export const prepareApiKeyCreationWorkflow = Effect.fn("ApiKey.prepareCreationWorkflow")(function* (input: ApiKeyWorkflowOptions<ApiKey["workflow"]>) {
  const { options, modules } = yield* prepareApiKeyParticipant(input, "creation");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ api_key: { module: modules.api_key.module,
    methods: ["createApiKeys", "revertCreatedApiKeys"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(createApiKeysWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createApiKeysWorkflow", resources, prepared, input: ApiKeyCreationInput,
      output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } });
});
