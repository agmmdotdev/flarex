import { Effect, Schema } from "effect";
import { updateApiKeysWorkflow } from "@medusajs/core-flows/api-key/update-api-keys";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makeApiKeyLifecycleCommands } from "../../modules/api-key/lifecycle-service";
import { ApiKeyUpdateInput } from "../../modules/api-key/lifecycle-input";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost } from "../../workflow/host";
import { prepareApiKeyParticipant, type ApiKeyWorkflowOptions } from "./participant";
import { prepareWorkflowResources } from "../../workflow/resources";

type Module = Effect.Success<ReturnType<typeof makeApiKeyLifecycleCommands>>["workflow"];

export const prepareApiKeyUpdateWorkflow = Effect.fn("ApiKey.prepareUpdateWorkflow")(function* (input: ApiKeyWorkflowOptions<Module>) {
  const { options, modules } = yield* prepareApiKeyParticipant(input, "lifecycle");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ api_key: { module: modules.api_key.module,
    methods: ["listApiKeys", "updateApiKeys", "upsertApiKeys"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(updateApiKeysWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "updateApiKeysWorkflow", resources, prepared, input: ApiKeyUpdateInput,
      output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } });
});
