import { Effect, Ref } from "effect";
import type { Definition } from "./definition.ts";
import { uniqueKeys } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { createChanges } from "./changes.ts";
import type { Storage, UniqueObservation } from "./storage.ts";
import type { Command } from "./persistence.ts";

/** This owner is framework-neutral. Its only implemented mutation is insert. */
export const createRoot = Effect.fn("ExperimentRoot.create")(function* (definition: Definition, storage: Storage, command: Command) {
  const live = yield* Ref.make(true);
  const failure = yield* Ref.make<CoreError | null>(null);
  const changes = createChanges(definition);
  const observations = new Map<string, UniqueObservation>();
  const poison = Effect.fn("ExperimentRoot.poison")((error: CoreError) => Ref.update(failure, prior => prior ?? error));
  const check = Effect.gen(function* () {
    const failed = yield* Ref.get(failure);
    if (failed !== null) return yield* Effect.fail(failed);
    if (!(yield* Ref.get(live))) return yield* Effect.fail(new CoreError({ reason: "closed" }));
  });
  const insert = Effect.fn("ExperimentRoot.insert")(function* (value: unknown) {
    yield* check;
    const document = yield* definition.decode(value);
    const id = document.id;
    if (typeof id !== "string" || changes.has(id)) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
    const keys = uniqueKeys(definition, document);
    yield* Effect.fromResult(changes.check(id, document));
    const unseen = keys.filter(key => !observations.has(JSON.stringify(key)));
    const observed = unseen.length === 0 ? [] : yield* storage.observeUnique(command, unseen);
    // There is no await between validating and applying all derived state.
    yield* check;
    if (changes.has(id)) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
    for (const item of observed) if (item.owner !== null) return yield* Effect.fail(new CoreError({ reason: "unique" }));
    for (const item of observed) observations.set(JSON.stringify({ field: item.field, key: item.key }), item);
    yield* Effect.fromResult(changes.apply(id, document));
    return { ...document };
  }, effect => effect.pipe(Effect.tapError(poison)));
  const freeze = Effect.fn("ExperimentRoot.freeze")(function* () {
    yield* check;
    yield* Ref.set(live, false);
    return { rows: changes.entries().flatMap(([, body]) => body === null ? [] : [body]), dependencies: [...observations.values()] };
  });
  return {
    insert, freeze, poison,
    close: Ref.set(live, false),
    diagnostics: changes.diagnostics,
  };
});
export type Root = Effect.Success<ReturnType<typeof createRoot>>;
