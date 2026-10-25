import { Effect, Schema } from "effect";
import { revokeApiKeysWorkflow } from "@medusajs/core-flows/api-key/revoke-api-keys";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makeApiKeyLifecycleCommands } from "../../modules/api-key/lifecycle-service";
import { ApiKeyRevokeInput } from "../../modules/api-key/lifecycle-input";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost } from "../../workflow/host";
import { prepareApiKeyParticipant, type ApiKeyWorkflowOptions } from "./participant";
import { prepareWorkflowResources } from "../../workflow/resources";

type Module = Effect.Success<ReturnType<typeof makeApiKeyLifecycleCommands>>["workflow"];

export const prepareApiKeyRevocationWorkflow = Effect.fn("ApiKey.prepareRevocationWorkflow")(function* (input: ApiKeyWorkflowOptions<Module>) {
  const { options, modules } = yield* prepareApiKeyParticipant(input, "lifecycle");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ api_key: { module: modules.api_key.module,
    methods: ["revoke"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(revokeApiKeysWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "revokeApiKeysWorkflow", resources, prepared, input: ApiKeyRevokeInput,
      output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } });
});
