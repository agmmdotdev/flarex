import { Effect } from "effect";
import type { CollectionConfig } from "payload";
import { CoreError } from "./errors.ts";
import { createFrameworkCommands } from "./framework-command.ts";
import type { Persistence } from "./persistence.ts";
import { createPayloadBinding } from "./payload.ts";
import { createStorage } from "./storage.ts";

/** Native Payload owns CRUD semantics; the framework command owner supplies the
 * single selected-table publication. Reads do not reserve mutation commands. */
export const createPayloadHost = Effect.fn("ExperimentPayload.host")(function* (collection: CollectionConfig, persistence: Persistence, scope: string) {
  const binding = yield* createPayloadBinding(collection, createStorage(persistence), scope);
  const documents = yield* createFrameworkCommands(persistence, scope, [binding.definition]);
  const deletion = yield* createFrameworkCommands(persistence, scope, [binding.definition, binding.preferenceDefinition]);
  const create = Effect.fn("ExperimentPayload.create")(function* (request: string, data: unknown) {
    const call = yield* binding.prepareCreate(data);
    return yield* documents.execute(request, { ...call, decode: binding.definition.decode,
      run: (group, transaction) => group.withFramework(binding.definition, root => call.run(root, transaction)) });
  });
  const update = Effect.fn("ExperimentPayload.update")(function* (request: string, id: string, data: unknown) {
    const call = yield* binding.prepareUpdate(id, data);
    return yield* documents.execute(request, { ...call, decode: binding.definition.decode,
      run: (group, transaction) => group.withFramework(binding.definition, root => call.run(root, transaction)) });
  });
  const remove = Effect.fn("ExperimentPayload.delete")(function* (request: string, id: string) {
    const call = yield* binding.prepareDelete(id);
    return yield* deletion.execute(request, { ...call, decode: binding.definition.decode,
      run: (group, transaction) => group.withFramework(binding.definition, root => group.withFramework(binding.preferenceDefinition,
        preferences => call.run(root, preferences, transaction))) });
  });
  return { definition: binding.definition, preferenceDefinition: binding.preferenceDefinition, read: binding.read,
    create: (request: string, data: unknown) => create(request, data).pipe(Effect.mapError(error => error instanceof CoreError && error.reason === "unique" ? binding.uniqueFailure() : error)),
    update: (request: string, id: string, data: unknown) => update(request, id, data).pipe(Effect.mapError(error => error instanceof CoreError && error.reason === "unique" ? binding.uniqueFailure() : error)),
    delete: remove };
});
