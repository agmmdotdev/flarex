import { randomUUID } from "node:crypto";
import { Cause, Clock, Effect, Ref, Schema, Semaphore } from "effect";
import { createChanges } from "./changes.ts";
import { numericField, type Definition, type Document } from "./definition.ts";
import { CreationTime, nextCreationTime, admitApplicationDefinition } from "./application-values.ts";
import { CoreError, DocumentValidationFailure } from "./errors.ts";
import type { ApplicationStorage } from "./application-storage.ts";
import type { Snapshot } from "./persistence.ts";
import { applicationLimits, type Dependency, type NumericRange } from "./query.ts";
import { createBudget, type RootBudget } from "./budget.ts";

type RootError = CoreError | DocumentValidationFailure;
const Fields = Schema.Record(Schema.String, Schema.Json);

/** Snapshot reader has no pending journal, command or accepting capability. */
const createReader = Effect.fn("ExperimentApplicationRoot.reader")(function* (definition: Definition, storage: ApplicationStorage, snapshot: Snapshot,
  budget: RootBudget, serialized?: Semaphore.Semaphore) {
  const tableId = yield* Effect.fromResult(admitApplicationDefinition(definition));
  const live = yield* Ref.make(true);
  const failure = yield* Ref.make<Cause.Cause<RootError> | null>(null);
  const semaphore = serialized ?? (yield* Semaphore.make(1));
  const originals = new Map<string, { revision: number | null; body: Document | null }>();
  const dependencies = new Map<string, Dependency>();
  let rows = 0; let bytes = 0;
  const check = Effect.gen(function* () {
    if (!(yield* Ref.get(live))) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    const prior = yield* Ref.get(failure); if (prior !== null) return yield* Effect.failCause(prior);
  });
  const poison = (cause: Cause.Cause<RootError>) => Ref.update(failure, prior => prior ?? cause);
  const latch = (cause: Cause.Cause<RootError>) => cause.reasons.every(reason => Cause.isFailReason(reason) && reason.error instanceof DocumentValidationFailure)
    ? Effect.void : poison(cause);
  const run = <A, E extends RootError>(work: Effect.Effect<A, E>) => semaphore.withPermit(check.pipe(Effect.andThen(work), Effect.tapCause(latch)));
  const depend = (dependency: Dependency) => {
    const key = dependency.kind === "point" ? `point:${dependency.id}` : JSON.stringify(dependency);
    if (!dependencies.has(key) && dependencies.size >= applicationLimits.dependencies) return Effect.fail(new CoreError({ reason: "limit" }));
    if (dependencies.has(key)) return Effect.void;
    return Effect.fromResult(budget.dependency(Buffer.byteLength(JSON.stringify(dependency)))).pipe(
      Effect.andThen(Effect.sync(() => { dependencies.set(key, structuredClone(dependency)); })));
  };
  const point = Effect.fn("ExperimentApplicationRoot.point")(function* (id: string) {
    let original = originals.get(id);
    if (original === undefined) {
      if (rows >= applicationLimits.rows || budget.remainingReads() === 0) return yield* Effect.fail(new CoreError({ reason: "limit" }));
      const row = yield* storage.point(snapshot, id, budget.remainingBytes());
      yield* Effect.fromResult(budget.read(row.bytes, 1)); rows++; bytes += row.bytes;
      const body = row.body === null ? null : Object.freeze(yield* definition.decode(row.body));
      original = { revision: row.revision, body }; originals.set(id, original);
    } else yield* storage.check(snapshot);
    yield* depend({ kind: "point", id, revision: original.revision, tombstone: original.body === null && original.revision !== null });
    return original.body === null ? null : { ...original.body };
  });
  const range = Effect.fn("ExperimentApplicationRoot.range")(function* (selection: NumericRange) {
    const owned = structuredClone(selection);
    const result = yield* storage.range(snapshot, owned, Math.min(applicationLimits.rows - rows, budget.remainingReads()), budget.remainingBytes());
    yield* Effect.fromResult(budget.read(result.bytes, result.examined));
    rows += result.examined; bytes += result.bytes;
    const documents: Document[] = [];
    for (const row of result.rows) {
      if (row.body === null) return yield* Effect.fail(new CoreError({ reason: "storage" }));
      const body = Object.freeze(yield* definition.decode(row.body)); originals.set(row.id, { revision: row.revision, body }); documents.push({ ...body });
    }
    yield* depend({ kind: "range", range: owned }); return { documents, selection: owned };
  });
  const finish = Effect.fn("ExperimentApplicationRoot.finish")(function* () {
    yield* storage.check(snapshot); yield* Ref.set(live, false); return [...dependencies.values()];
  });
  return { tableId, run, point, range, finish, poison, close: Ref.set(live, false), original: (id: string) => originals.get(id),
    diagnostics: () => ({ rows, bytes, dependencies: dependencies.size }) };
});

export const createApplicationQueryRoot = Effect.fn("ExperimentApplicationRoot.query")(function* (definition: Definition, storage: ApplicationStorage, snapshot: Snapshot) {
  const reader = yield* createReader(definition, storage, snapshot, createBudget());
  return { get: (id: string) => reader.run(reader.point(id)), range: (range: NumericRange) => reader.run(reader.range(range).pipe(Effect.map(value => value.documents))),
    finish: () => reader.run(reader.finish()), close: reader.close, poison: reader.poison, diagnostics: reader.diagnostics };
});

export const createApplicationMutationRoot = Effect.fn("ExperimentApplicationRoot.mutation")(function* (definition: Definition, storage: ApplicationStorage, snapshot: Snapshot,
  budget: RootBudget = createBudget(), serialized?: Semaphore.Semaphore) {
  const reader = yield* createReader(definition, storage, snapshot, budget, serialized);
  const changes = createChanges(definition);
  let creationTime: number = yield* Schema.decodeUnknownEffect(CreationTime)(snapshot.creationTime).pipe(Effect.mapError(cause => new CoreError({ reason: "storage", cause })));
  const get = Effect.fn("ExperimentApplicationRoot.current")(function* (id: string) {
    const original = yield* reader.point(id);
    const body = changes.has(id) ? changes.get(id) ?? null : original;
    return body === null ? null : { ...body };
  });
  const fields = (value: unknown) => Schema.decodeUnknownEffect(Fields)(value).pipe(
    Effect.flatMap(body => Object.keys(body).some(key => !definition.fields.some(field => field.name === key))
      ? Effect.fail(new CoreError({ reason: "invalid" })) : Effect.succeed(body)),
    Effect.mapError(cause => new DocumentValidationFailure({ cause })),
  );
  const decode = (body: unknown) => definition.decode(body).pipe(Effect.mapError(cause => new DocumentValidationFailure({ cause })));
  const apply = Effect.fn("ExperimentApplicationRoot.apply")(function* (id: string, body: Document | null) {
    yield* Effect.fromResult(changes.check(id, body));
    const prior = changes.get(id);
    yield* Effect.fromResult(budget.replacePending((body === null ? 0 : Buffer.byteLength(JSON.stringify(body))) -
      (prior == null ? 0 : Buffer.byteLength(JSON.stringify(prior))), !changes.has(id)));
    yield* Effect.fromResult(changes.apply(id, body));
  });
  return {
    get: (id: string) => reader.run(get(id)),
    range: (range: NumericRange) => reader.run(Effect.gen(function* () {
      const observed = yield* reader.range(range);
      const pending = changes.select(observed.selection);
      const result = [...observed.documents.filter(row => !changes.has(row.id)), ...pending].toSorted((left, right) =>
        numericField(left, observed.selection.field) - numericField(right, observed.selection.field) || numericField(left, "systemCreationTime") - numericField(right, "systemCreationTime") || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      if (result.length > applicationLimits.rows) return yield* Effect.fail(new CoreError({ reason: "limit" }));
      return result;
    })),
    insert: (value: unknown) => reader.run(Effect.gen(function* () {
      const data = yield* fields(value); const id = `${reader.tableId}:${randomUUID()}`;
      const allocated = creationTime; creationTime = nextCreationTime(creationTime);
      const timestamp = new Date(allocated).toISOString();
      const document = yield* decode({ ...data, id, createdAt: timestamp, updatedAt: timestamp, systemCreationTime: allocated });
      yield* reader.point(id); yield* apply(id, document); return id;
    })),
    patch: (id: string, value: unknown) => reader.run(Effect.gen(function* () {
      const data = yield* fields(value); const before = yield* get(id);
      if (before === null) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      const document = yield* decode({ ...before, ...data, updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString() });
      yield* apply(id, document);
    })),
    replace: (id: string, value: unknown) => reader.run(Effect.gen(function* () {
      const data = yield* fields(value); const before = yield* get(id);
      if (before === null) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      const document = yield* decode({ ...data, id, createdAt: before.createdAt, updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(), systemCreationTime: before.systemCreationTime });
      yield* apply(id, document);
    })),
    delete: (id: string) => reader.run(Effect.gen(function* () {
      if ((yield* get(id)) === null) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
      yield* apply(id, null);
    })),
    freeze: () => reader.run(Effect.gen(function* () {
      const dependencies = yield* reader.finish();
      const final = changes.entries().flatMap(([id, body]) => {
        const before = reader.original(id)?.revision ?? null;
        return before === null && body === null ? [] : [{ id, before, body }];
      });
      return { dependencies, changes: final };
    })),
    close: reader.close, poison: reader.poison,
    diagnostics: () => ({ read: reader.diagnostics(), write: changes.diagnostics() }),
  };
});
export type ApplicationQueryRoot = Effect.Success<ReturnType<typeof createApplicationQueryRoot>>;
export type ApplicationMutationRoot = Effect.Success<ReturnType<typeof createApplicationMutationRoot>>;
