import { Cause, Effect, Ref, Schema, Semaphore } from "effect";
import { uniqueKeys, type Definition, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { createChanges } from "./changes.ts";
import type { Storage, UniqueObservation } from "./storage.ts";
import type { Command } from "./persistence.ts";
import type { EventIntent } from "./materialization.ts";
import { freezeOwnedJson, JsonValue } from "./value.ts";

const Event = Schema.Struct({ event: Schema.String.check(Schema.isLengthBetween(1, 256)), document: Schema.String, body: JsonValue });

/** Direct framework root. Native DAL calls share original/pending state; only
 * the outer command accepts. It does not carry Application predicate OCC. */
export const createRoot = Effect.fn("ExperimentRoot.create")(function* (definition: Definition, storage: Storage, command: Command) {
  const live = yield* Ref.make(true); const failure = yield* Ref.make<Cause.Cause<CoreError> | null>(null);
  const semaphore = yield* Semaphore.make(1); const changes = createChanges(definition);
  const observations = new Map<string, UniqueObservation>();
  const originals = new Map<string, { revision: number | null; body: Document | null }>();
  const events: EventIntent[] = []; let readBytes = 0; let eventBytes = 0;
  const poisonCause = (cause: Cause.Cause<CoreError>) => Ref.update(failure, prior => prior ?? cause);
  const poison = (error: CoreError) => poisonCause(Cause.fail(error));
  const check = Effect.gen(function* () {
    const failed = yield* Ref.get(failure); if (failed !== null) return yield* Effect.failCause(failed);
    if (!(yield* Ref.get(live))) return yield* Effect.fail(new CoreError({ reason: "closed" }));
  });
  const run = <A>(work: Effect.Effect<A, CoreError>) => semaphore.withPermit(check.pipe(Effect.andThen(work), Effect.tapCause(poisonCause)));
  const original = Effect.fn("ExperimentRoot.original")(function* (id: string) {
    let value = originals.get(id);
    if (value === undefined) {
      if (originals.size >= 256) return yield* Effect.fail(new CoreError({ reason: "limit" }));
      const [row] = yield* storage.observeRows(command, [id], 262144 - readBytes - eventBytes - changes.diagnostics().bytes);
      readBytes += row?.bytes ?? 0;
      const body = row?.body == null ? null : structuredClone(yield* definition.decode(row.body));
      if (body !== null) freezeOwnedJson(body);
      value = { revision: row?.revision ?? null, body }; originals.set(id, value);
    }
    return value.body;
  });
  const current = Effect.fn("ExperimentRoot.current")(function* (id: string) {
    return changes.has(id) ? changes.get(id) ?? null : yield* original(id);
  });
  const owns = (owner: string, key: { field: string; key: string }) => {
    const pending = changes.get(owner);
    return !changes.has(owner) || pending != null && uniqueKeys(definition, pending).some(claim => claim.field === key.field && claim.key === key.key);
  };
  const stage = Effect.fn("ExperimentRoot.stage")(function* (id: string, body: Document | null) {
    yield* Effect.fromResult(changes.check(id, body));
    const keys = body === null ? [] : uniqueKeys(definition, body);
    const unseen = keys.filter(key => !observations.has(JSON.stringify(key)));
    const observed = unseen.length === 0 ? [] : yield* storage.observeUnique(command, unseen);
    for (const item of observed) observations.set(JSON.stringify({ field: item.field, key: item.key }), item);
    for (const key of keys) {
      const observation = observations.get(JSON.stringify(key));
      if (observation === undefined) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      if (observation.owner !== null && observation.owner !== id && owns(observation.owner, key)) return yield* Effect.fail(new CoreError({ reason: "unique" }));
    }
    const previous = changes.get(id);
    const retained = changes.diagnostics().bytes - (previous == null ? 0 : Buffer.byteLength(JSON.stringify(previous))) + (body === null ? 0 : Buffer.byteLength(JSON.stringify(body)));
    if (readBytes + eventBytes + retained > 262144) return yield* Effect.fail(new CoreError({ reason: "limit" }));
    yield* Effect.fromResult(changes.apply(id, body)); return body === null ? null : structuredClone(body);
  });
  return {
    get: (id: string) => run(current(id).pipe(Effect.map(body => body === null ? null : structuredClone(body)))),
    insert: Effect.fn("ExperimentRoot.insert")((value: unknown) => run(Effect.gen(function* () {
      const body = yield* definition.decode(value);
      if (changes.has(body.id) || originals.has(body.id) && originals.get(body.id)?.body !== null) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      yield* stage(body.id, body); return structuredClone(body);
    }))),
    replace: Effect.fn("ExperimentRoot.replace")((value: unknown) => run(Effect.gen(function* () {
      const body = yield* definition.decode(value);
      const before = yield* current(body.id);
      if (before === null || body.createdAt !== before.createdAt) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      yield* stage(body.id, body); return structuredClone(body);
    }))),
    delete: Effect.fn("ExperimentRoot.delete")((id: string) => run(Effect.gen(function* () {
      if ((yield* current(id)) === null) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      yield* stage(id, null);
    }))),
    event: Effect.fn("ExperimentRoot.event")((value: unknown) => run(Effect.gen(function* () {
      const event = structuredClone(yield* Schema.decodeUnknownEffect(Event)(value).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause }))));
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (events.length >= 256 || readBytes + eventBytes + bytes + changes.diagnostics().bytes > 262144) return yield* Effect.fail(new CoreError({ reason: "limit" }));
      freezeOwnedJson(event); events.push(event); eventBytes += bytes;
    }))),
    freeze: Effect.fn("ExperimentRoot.freeze")(() => run(Effect.gen(function* () {
      yield* Ref.set(live, false);
      return { changes: changes.entries().flatMap(([id, body]) => {
        const before = originals.get(id)?.revision ?? null; return before === null && body === null ? [] : [{ id, before, body }];
      }), dependencies: [...observations.values()], events: [...events] };
    }))),
    poison, poisonCause, close: Ref.set(live, false), diagnostics: () => ({ ...changes.diagnostics(), readBytes, eventBytes }),
  };
});
export type Root = Effect.Success<ReturnType<typeof createRoot>>;
