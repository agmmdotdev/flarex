import { Effect, Ref } from "effect";
import type { Definition, Document } from "./definition.ts";
import { uniqueKeys } from "./definition.ts";
import { CoreError } from "./errors.ts";
import type { Command, Storage, UniqueObservation } from "./storage.ts";

export const rootLimits = Object.freeze({ rows: 256, bytes: 262_144 });

/** This owner is framework-neutral. Its only implemented mutation is insert. */
export const createRoot = Effect.fn("ExperimentRoot.create")(function* (definition: Definition, storage: Storage, command: Command) {
  const live = yield* Ref.make(true);
  const failure = yield* Ref.make<CoreError | null>(null);
  const rows = new Map<string, Document>();
  const owners = new Map<string, string>();
  const observations = new Map<string, UniqueObservation>();
  let retainedBytes = 0;
  let keyOperations = 0;
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
    if (typeof id !== "string" || rows.has(id)) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
    const bytes = Buffer.byteLength(JSON.stringify(document));
    const keys = uniqueKeys(definition, document);
    if (rows.size >= rootLimits.rows || retainedBytes + bytes > rootLimits.bytes) return yield* Effect.fail(new CoreError({ reason: "limit" }));
    for (const key of keys) {
      keyOperations++;
      if (owners.has(JSON.stringify(key))) return yield* Effect.fail(new CoreError({ reason: "unique" }));
    }
    const unseen = keys.filter(key => !observations.has(JSON.stringify(key)));
    const observed = unseen.length === 0 ? [] : yield* storage.observeUnique(command, unseen);
    // There is no await between validating and applying all derived state.
    yield* check;
    if (rows.has(id)) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
    if (rows.size >= rootLimits.rows || retainedBytes + bytes > rootLimits.bytes) return yield* Effect.fail(new CoreError({ reason: "limit" }));
    for (const key of keys) {
      keyOperations++;
      if (owners.has(JSON.stringify(key))) return yield* Effect.fail(new CoreError({ reason: "unique" }));
    }
    for (const item of observed) if (item.owner !== null) return yield* Effect.fail(new CoreError({ reason: "unique" }));
    for (const item of observed) observations.set(JSON.stringify({ field: item.field, key: item.key }), item);
    for (const key of keys) owners.set(JSON.stringify(key), id);
    rows.set(id, Object.freeze({ ...document }));
    retainedBytes += bytes;
    return { ...document };
  }, effect => effect.pipe(Effect.tapError(poison)));
  const freeze = Effect.fn("ExperimentRoot.freeze")(function* () {
    yield* check;
    yield* Ref.set(live, false);
    return { rows: [...rows.values()], dependencies: [...observations.values()] };
  });
  return {
    insert, freeze, poison,
    close: Ref.set(live, false),
    diagnostics: () => ({ rows: rows.size, bytes: retainedBytes, keyOperations }),
  };
});
export type Root = Effect.Success<ReturnType<typeof createRoot>>;
