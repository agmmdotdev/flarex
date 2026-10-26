import { Cause, Effect, Ref, Schema, Semaphore } from "effect";
import { textField, uniqueKeys, type Definition, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { createChanges } from "./changes.ts";
import type { Storage, UniqueObservation } from "./storage.ts";
import type { Command } from "./persistence.ts";
import type { EventIntent } from "./materialization.ts";
import { captureJsonInput, freezeOwnedJson, JsonValue } from "./value.ts";
import { createBudget, type RootBudget } from "./budget.ts";
import { TextEquality, type EqualityDependency, type PointObservation } from "./query.ts";

export interface RootObservations {
  readonly observeRows: (command: Command, ids: readonly string[], remainingBytes: number) => Effect.Effect<readonly PointObservation[], CoreError>;
  readonly observeUnique: Storage["observeUnique"];
  readonly observeEquality: Storage["observeEquality"];
  readonly observeEqualityRows: Storage["observeEqualityRows"];
}

type Original = { readonly kind: "missing"; readonly revision: null }
  | { readonly kind: "tombstone" | "projected"; readonly revision: number }
  | { readonly kind: "document"; readonly revision: number; readonly body: Document };

const Event = Schema.Struct({ event: Schema.String.check(Schema.isLengthBetween(1, 256)), document: Schema.String, body: JsonValue });

/** Direct framework root. Native DAL calls share original/pending state; only
 * the outer command accepts. Its equality mutation queries have their own
 * invalidation duty, separate from automatic Application point/range OCC. */
export const createRoot = Effect.fn("ExperimentRoot.create")(function* (definition: Definition, storage: RootObservations, command: Command,
  budget: RootBudget = createBudget(), serialized?: Semaphore.Semaphore) {
  const live = yield* Ref.make(true); const failure = yield* Ref.make<Cause.Cause<CoreError> | null>(null);
  const semaphore = serialized ?? (yield* Semaphore.make(1)); const changes = createChanges(definition);
  const observations = new Map<string, UniqueObservation>();
  const originals = new Map<string, Original>();
  const predicates = new Map<string, EqualityDependency>();
  const equalityCache = new Map<string, readonly string[]>();
  const events: EventIntent[] = []; let readBytes = 0; let eventBytes = 0;
  const poisonCause = (cause: Cause.Cause<CoreError>) => Ref.update(failure, prior => prior ?? cause);
  const poison = (error: CoreError) => poisonCause(Cause.fail(error));
  const check = Effect.gen(function* () {
    const failed = yield* Ref.get(failure); if (failed !== null) return yield* Effect.failCause(failed);
    if (!(yield* Ref.get(live))) return yield* Effect.fail(new CoreError({ reason: "closed" }));
  });
  const run = <A>(work: Effect.Effect<A, CoreError>) => semaphore.withPermit(check.pipe(Effect.andThen(work), Effect.tapCause(poisonCause)));
  const remember = Effect.fn("ExperimentRoot.remember")(function* (id: string, value: Original) {
    const prior = originals.get(id);
    if (prior !== undefined && (prior.revision !== value.revision ||
      (prior.kind === "tombstone") !== (value.kind === "tombstone"))) return yield* Effect.fail(new CoreError({ reason: "conflict" }));
    if (prior === undefined) {
      if (originals.size >= 256) return yield* Effect.fail(new CoreError({ reason: "limit" }));
      yield* Effect.fromResult(budget.dependency(Buffer.byteLength(JSON.stringify({ kind: "point", id,
        revision: value.revision, tombstone: value.kind === "tombstone" }))));
    }
    if (prior === undefined || value.kind === "document") originals.set(id, value);
  });
  const original = Effect.fn("ExperimentRoot.original")(function* (id: string) {
    let value = originals.get(id);
    if (value === undefined || value.kind === "projected") {
      if (value === undefined && originals.size >= 256 || budget.remainingReads() === 0) return yield* Effect.fail(new CoreError({ reason: "limit" }));
      const [row] = yield* storage.observeRows(command, [id], budget.remainingBytes());
      yield* Effect.fromResult(budget.read(row?.bytes ?? 0, 1));
      readBytes += row?.bytes ?? 0;
      const body = row?.body == null ? null : structuredClone(yield* definition.decode(row.body));
      if (body !== null) freezeOwnedJson(body);
      const revision = row?.revision ?? null;
      value = revision === null ? { kind: "missing", revision } : body === null ? { kind: "tombstone", revision } : { kind: "document", revision, body };
      yield* remember(id, value);
    }
    return value.kind === "document" ? value.body : null;
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
    const previous = changes.get(id);
    const delta = -(previous == null ? 0 : Buffer.byteLength(JSON.stringify(previous))) + (body === null ? 0 : Buffer.byteLength(JSON.stringify(body)));
    yield* Effect.fromResult(budget.replacePending(delta, !changes.has(id)));
    const keys = body === null ? [] : uniqueKeys(definition, body);
    const unseen = keys.filter(key => !observations.has(JSON.stringify(key)));
    const observed = unseen.length === 0 ? [] : yield* storage.observeUnique(command, unseen);
    for (const item of observed) {
      yield* Effect.fromResult(budget.dependency(Buffer.byteLength(JSON.stringify(item))));
      observations.set(JSON.stringify({ field: item.field, key: item.key }), item);
    }
    for (const key of keys) {
      const observation = observations.get(JSON.stringify(key));
      if (observation === undefined) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      if (observation.owner !== null && observation.owner !== id && owns(observation.owner, key)) return yield* Effect.fail(new CoreError({ reason: "unique" }));
    }
    yield* Effect.fromResult(changes.apply(id, body)); return body === null ? null : structuredClone(body);
  });
  const equality = Effect.fn("ExperimentRoot.equality")(function* (input: TextEquality, projection: "identities" | "documents") {
    const captured = yield* Effect.fromResult(captureJsonInput(input, true));
    const decoded = yield* Schema.decodeUnknownEffect(TextEquality)(captured, { onExcessProperty: "error" }).pipe(
      Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    const selection = { ...decoded, keys: [...new Set(decoded.keys)].toSorted() };
    if (!definition.equalities.some(index => index.name === selection.index && index.field === selection.field)) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    const key = JSON.stringify(selection);
    if (Buffer.byteLength(key) > 262144) return yield* Effect.fail(new CoreError({ reason: "limit" }));
    if (!predicates.has(key)) {
      const dependency: EqualityDependency = { kind: "equality", selection }; freezeOwnedJson(selection);
      yield* Effect.fromResult(budget.dependency(Buffer.byteLength(JSON.stringify(dependency)))); predicates.set(key, dependency);
    }
    let ids = equalityCache.get(key);
    if (ids === undefined || projection === "documents" && ids.some(id => !changes.has(id) && originals.get(id)?.kind !== "document")) {
      const observed = yield* (projection === "documents" ? storage.observeEqualityRows : storage.observeEquality)(command,
        selection, budget.remainingReads(), budget.remainingBytes());
      yield* Effect.fromResult(budget.read(observed.bytes, observed.examined)); readBytes += observed.bytes;
      const acquired: string[] = [];
      for (const row of observed.rows) {
        if (projection === "documents") {
          if (row.body === null) return yield* Effect.fail(new CoreError({ reason: "storage" }));
          const body = yield* definition.decode(row.body);
          const fieldValue = textField(body, selection.field);
          if (body.id !== row.id || fieldValue === null || !selection.keys.includes(fieldValue)) return yield* Effect.fail(new CoreError({ reason: "storage" }));
          freezeOwnedJson(body); yield* remember(row.id, { kind: "document", revision: row.revision, body });
        } else yield* remember(row.id, { kind: "projected", revision: row.revision });
        acquired.push(row.id);
      }
      ids = acquired; equalityCache.set(key, ids);
    }
    const result = [...ids.filter(id => !changes.has(id)), ...changes.selectEquality(selection).map(body => body.id)].toSorted();
    if (result.length > 256) return yield* Effect.fail(new CoreError({ reason: "limit" }));
    return result;
  });
  const selectedBody = (id: string) => {
    const observed = originals.get(id); const body = changes.has(id) ? changes.get(id) : observed?.kind === "document" ? observed.body : null;
    if (body == null) throw new Error("Missing acquired equality document");
    return structuredClone(body);
  };
  return {
    get: (id: string) => run(current(id).pipe(Effect.map(body => body === null ? null : structuredClone(body)))),
    insert: Effect.fn("ExperimentRoot.insert")((value: unknown) => run(Effect.gen(function* () {
      const body = yield* definition.decode(value);
      if (changes.has(body.id) || originals.get(body.id)?.revision != null) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
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
    equalIds: (selection: TextEquality) => run(equality(selection, "identities")),
    equalRows: (selection: TextEquality) => run(equality(selection, "documents").pipe(Effect.map(ids => ids.map(selectedBody)))),
    deleteEqual: Effect.fn("ExperimentRoot.deleteEqual")((selection: TextEquality) => run(Effect.gen(function* () {
      const ids = yield* equality(selection, "identities");
      for (const id of ids) yield* stage(id, null);
      return ids.length;
    }))),
    event: Effect.fn("ExperimentRoot.event")((value: unknown) => run(Effect.gen(function* () {
      const event = structuredClone(yield* Schema.decodeUnknownEffect(Event)(value).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause }))));
      const bytes = Buffer.byteLength(JSON.stringify(event));
      yield* Effect.fromResult(budget.event(bytes));
      freezeOwnedJson(event); events.push(event); eventBytes += bytes;
    }))),
    freeze: Effect.fn("ExperimentRoot.freeze")(() => run(Effect.gen(function* () {
      yield* Ref.set(live, false);
      return { changes: changes.entries().flatMap(([id, body]) => {
        const before = originals.get(id)?.revision ?? null; return before === null && body === null ? [] : [{ id, before, body }];
      }), dependencies: [...observations.values()], points: [...originals].map(([id, observed]) => ({ kind: "point" as const, id,
        revision: observed.revision, tombstone: observed.kind === "tombstone" })), predicates: [...predicates.values()], events: [...events] };
    }))),
    poison, poisonCause, close: Ref.set(live, false), diagnostics: () => ({ ...changes.diagnostics(), readBytes, eventBytes,
      dependencyBytes: budget.diagnostics().dependencyBytes }),
  };
});
export type Root = Effect.Success<ReturnType<typeof createRoot>>;
