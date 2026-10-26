import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { Cause, Clock, Effect, Exit, Result, Schema } from "effect";
import { BasePayload, buildConfig, createLocalReq, deepCopyObjectSimple, executeAccess, ValidationError, type BaseDatabaseAdapter,
  type CollectionConfig, type DatabaseAdapterObj, type PayloadRequest, type TypeWithID } from "payload";
import { compilePayloadDefinition } from "./payload-definition.ts";
import { CoreError, NativeCompletionFailure, NativeFailure, NativeOperationFailure } from "./errors.ts";
import { createRoot } from "./root.ts";
import type { BorrowedFrameworkRoot } from "./group-root.ts";
import type { Storage } from "./storage.ts";
import { runCallback, supervise } from "./callback.ts";
import { captureJsonInput, JsonValue } from "./value.ts";

interface Binding {
  readonly root: BorrowedFrameworkRoot | null;
  readonly transaction: string | null;
  readonly readId: string | null;
  readonly signal: AbortSignal;
  live: boolean;
  operations: number;
  readonly pending: Set<Promise<unknown>>;
}
const Input = Schema.Record(Schema.String, JsonValue);
const PointWhere = Schema.Union([
  Schema.Struct({ id: Schema.Struct({ equals: Schema.String }) }),
  Schema.Struct({ and: Schema.Tuple([Schema.Struct({ id: Schema.Struct({ equals: Schema.String }) })]) }),
]);
type PayloadCall = { readonly operation: "create"; readonly data: typeof Input.Type }
  | { readonly operation: "update"; readonly id: string; readonly data: typeof Input.Type }
  | { readonly operation: "read"; readonly id: string };
/** Cancel capability use immediately, then drain the admitted completing callback.
 * Arbitrary remote/nonterminating hooks are outside this construction profile. */
const native = <A>(work: (signal: AbortSignal) => Promise<A>) => runCallback(work, cause => cause instanceof NativeCompletionFailure ? cause : new NativeFailure({ cause })).pipe(
  Effect.catchTag("NativeCompletionFailure", error => Effect.failCause(error.cause)),
);

/** Native result/error conversion belongs to this framework boundary only. */
export const createPayloadHost = Effect.fn("ExperimentPayload.createHost")(function* (
  collection: CollectionConfig, storage: Storage, scope: string,
) {
  const definition = yield* Effect.fromResult(compilePayloadDefinition(collection));
  const scopeOwner = yield* Effect.scope;
  const current = new AsyncLocalStorage<Binding>();
  let live = true;
  const unsupported = async (): Promise<never> => {
    const error = new CoreError({ reason: "unsupported" });
    const binding = current.getStore();
    if (binding?.live && binding.root !== null) await Effect.runPromise(binding.root.poison(error));
    throw error;
  };
  const bindingFor = (req?: Partial<PayloadRequest>) => {
    const binding = current.getStore();
    if (!live || binding === undefined || !binding.live || binding.signal.aborted ||
      (binding.transaction !== null && req?.transactionID !== binding.transaction)) {
      throw new CoreError({ reason: "closed" });
    }
    return binding;
  };
  const track = <A>(req: Partial<PayloadRequest> | undefined, work: (binding: Binding) => Promise<A>): Promise<A> => {
    const binding = bindingFor(req);
    const promise = Promise.resolve().then(() => { bindingFor(req); return work(binding); });
    binding.pending.add(promise);
    void promise.then(() => binding.pending.delete(promise), () => binding.pending.delete(promise));
    return promise;
  };
  const inBinding = async <A>(binding: Binding, work: () => Promise<A>): Promise<A> => {
    let outcome: Result.Result<A, unknown>;
    try { outcome = Result.succeed(await work()); } catch (cause) { outcome = Result.fail(cause); }
    binding.live = false;
    const unfinished = [...binding.pending];
    if (unfinished.length !== 0) {
      const error = new CoreError({ reason: "unsupported" });
      if (binding.root !== null) await Effect.runPromise(binding.root.poison(error));
      const drained = await Promise.allSettled(unfinished);
      let cause: Cause.Cause<CoreError | NativeFailure> = Cause.fail(error);
      if (Result.isFailure(outcome)) cause = Cause.combine(cause, Cause.fail(new NativeFailure({ cause: outcome.failure })));
      for (const result of drained) if (result.status === "rejected") cause = Cause.combine(cause,
        result.reason instanceof NativeOperationFailure ? result.reason.cause : result.reason instanceof CoreError ? Cause.fail(result.reason) : Cause.die(result.reason));
      throw new NativeCompletionFailure({ cause });
    }
    return Result.match(outcome, { onSuccess: value => value, onFailure: cause => { throw cause; } });
  };
  const projectUnique = (request?: Partial<PayloadRequest>) => new ValidationError({
    collection: collection.slug,
    errors: definition.fields.filter(field => field.unique).map(field => ({
      path: field.name, message: request?.t?.("error:valueMustBeUnique") ?? "Value must be unique",
    })),
    ...(request === undefined ? {} : { req: request }),
  });
  const runAtAdapter = async <A>(effect: Effect.Effect<A, CoreError>, request?: Partial<PayloadRequest>): Promise<A> => {
    // Payload requires native Promise rejection. Full non-domain Causes remain
    // intact; only a simple typed unique failure maps to its ValidationError.
    const exit = await Effect.runPromise(Effect.exit(effect));
    if (Exit.isSuccess(exit)) return exit.value;
    const binding = current.getStore();
    if (binding?.live && binding.root !== null) await Effect.runPromise(binding.root.poisonCause(exit.cause));
    const error = Cause.findErrorOption(exit.cause);
    if (exit.cause.reasons.length === 1 && error._tag === "Some" && error.value.reason === "unique") throw projectUnique(request);
    // Preserve the complete Cause explicitly: the ordinary runtime rejection
    // also squashes a multi-reason cause in this installed Effect version.
    throw new NativeOperationFailure({ cause: exit.cause });
  };
  const deferred = () => unsupported();
  const adapter: DatabaseAdapterObj = { name: "flarex-experiment", defaultIDType: "text", init: ({ payload }) => ({
    name: "flarex-experiment", packageName: "flarex-experiment", payload, defaultIDType: "text", migrationDir: "",
    beginTransaction: deferred, commitTransaction: deferred,
    rollbackTransaction: async () => {
      const binding = current.getStore();
      if (binding?.root !== null && binding?.root !== undefined) {
        await Effect.runPromise(binding.root.poison(new CoreError({ reason: "closed" })));
      } else return unsupported();
    },
    create: args => track(args.req, async binding => {
      if (binding.root === null || args.collection !== definition.table || args.customID !== undefined) return unsupported();
      const timestamp = new Date(await runAtAdapter(Clock.currentTimeMillis)).toISOString();
      bindingFor(args.req);
      return runAtAdapter(binding.root.insert({ ...args.data, id: randomUUID(),
        createdAt: args.data.createdAt ?? timestamp, updatedAt: args.data.updatedAt ?? timestamp }), args.req);
    }),
    findOne: <T extends TypeWithID>(args: Parameters<BaseDatabaseAdapter["findOne"]>[0]) => track(args.req, async binding => {
      if (args.collection !== definition.table || binding.root === null && binding.readId === null) return unsupported();
      const where = await runAtAdapter(Effect.fromResult(captureJsonInput(args.where)).pipe(
        Effect.flatMap(value => Schema.decodeUnknownEffect(PointWhere)(value, { onExcessProperty: "error" }).pipe(
          Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })))),
      ));
      bindingFor(args.req);
      const id = "id" in where ? where.id.equals : where.and[0].id.equals;
      if (binding.root === null && id !== binding.readId) return unsupported();
      const result = await runAtAdapter(binding.root === null ? storage.read(scope, definition, id) : binding.root.get(id));
      bindingFor(args.req);
      const document = result === null ? null : await runAtAdapter(definition.decode(result));
      // SAFETY: Payload's collection-selected generic is not a runtime decoder. The
      // metadata-derived definition above validates this closed profile.
      return document as T | null;
    }),
    updateOne: <T extends TypeWithID>(args: Parameters<BaseDatabaseAdapter["updateOne"]>[0]) => track(args.req, async binding => {
      if (binding.root === null || args.collection !== definition.table || typeof args.id !== "string" || args.where !== undefined) return unsupported();
      const before = await runAtAdapter(binding.root.get(args.id));
      bindingFor(args.req);
      if (before === null) return unsupported();
      const result = await runAtAdapter(binding.root.replace({ ...before, ...args.data, id: before.id, createdAt: before.createdAt }), args.req);
      // SAFETY: the collection-selected definition decodes the entire stored
      // replacement; Payload erases that runtime contract in its generic.
      return result as T;
    }),
    count: deferred, find: deferred, deleteOne: deferred,
    countGlobalVersions: deferred, countVersions: deferred, createGlobal: deferred, createGlobalVersion: deferred,
    createMigration: deferred, createVersion: deferred, deleteMany: deferred, deleteVersions: deferred,
    findDistinct: deferred, findGlobal: deferred, findGlobalVersions: deferred, findVersions: deferred,
    generateSchema: deferred, migrate: deferred, migrateDown: deferred, migrateFresh: deferred,
    migrateRefresh: deferred, migrateReset: deferred, migrateStatus: deferred, queryDrafts: deferred,
    updateGlobal: deferred, updateGlobalVersion: deferred, updateJobs: deferred, updateMany: deferred,
    updateVersion: deferred, upsert: deferred,
  } satisfies BaseDatabaseAdapter) };
  const nativeCollection: CollectionConfig = {
    ...collection, fields: deepCopyObjectSimple(collection.fields),
    hooks: { ...collection.hooks, beforeOperation: [async args => {
      const binding = bindingFor(args.req);
      binding.operations++;
      if (binding.operations !== 1 || (binding.root !== null ? !["create", "read", "update"].includes(args.operation) : args.operation !== "read")) return unsupported();
      return;
    }, ...(collection.hooks?.beforeOperation ?? [])] },
  };
  const payload = yield* Effect.acquireRelease(Effect.sync(() => new BasePayload()), instance =>
    Effect.gen(function* () { live = false; yield* native(() => instance.destroy()); }).pipe(Effect.orDie));
  const config = yield* native(() => buildConfig({
    secret: "experimental-disposable-profile-not-a-deployment-secret", db: adapter,
    collections: [nativeCollection, { slug: "users", auth: true, lockDocuments: false, fields: [] }],
    admin: { user: "users", disable: true }, globals: [], folders: false, telemetry: false,
    jobs: { tasks: [], workflows: [] }, typescript: { autoGenerate: false },
    email: () => ({ name: "disabled", defaultFromAddress: "disabled@example.invalid", defaultFromName: "Disabled", sendEmail: unsupported }),
    kv: { init: () => ({ clear: unsupported, delete: unsupported, get: unsupported, has: unsupported, keys: unsupported, set: unsupported }) },
  }));
  yield* native(() => payload.init({ config, disableDBConnect: true, disableOnInit: true }));

  const input = Effect.fn("ExperimentPayload.input")(function* (data: unknown) {
    if (!live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    const captured = yield* Effect.fromResult(captureJsonInput(data));
    const decoded = yield* Schema.decodeUnknownEffect(Input)(captured).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    if (Object.keys(decoded).some(key => !definition.fields.some(field => field.name === key)) || Buffer.byteLength(JSON.stringify(decoded)) > 262_144) {
      return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    }
    return structuredClone(decoded);
  });
  const invoke = Effect.fn("ExperimentPayload.invoke")((root: BorrowedFrameworkRoot, transaction: string, call: PayloadCall) => native(signal => {
    const binding: Binding = { root, transaction, readId: null, signal, live: true, operations: 0, pending: new Set() };
    return current.run(binding, () => inBinding(binding, async () => {
        const options = { collection: collection.slug, depth: 0, overrideAccess: false, req: { transactionID: transaction, signal } };
        switch (call.operation) {
          case "create": return await payload.create({ ...options, data: structuredClone(call.data) });
          case "update": return await payload.update({ ...options, id: call.id, data: structuredClone(call.data) });
          case "read": return await payload.findByID({ ...options, id: call.id });
        }
    }));
  }).pipe(Effect.flatMap(definition.decode)));
  const borrowUpdate = Effect.fn("ExperimentPayload.borrowUpdate")(function* (root: BorrowedFrameworkRoot, transaction: string, id: string, data: unknown) {
    return yield* invoke(root, transaction, { operation: "update", id, data: yield* input(data) });
  });
  const prepareCreate = Effect.fn("ExperimentPayload.prepareCreate")(function* (data: unknown) {
    const captured = yield* input(data);
    const digest = createHash("sha256").update(JSON.stringify({ definition: definition.version,
      data: Object.fromEntries(Object.entries(captured).toSorted(([left], [right]) => left.localeCompare(right))) })).digest("hex");
    const authorize = Effect.fn("ExperimentPayload.authorizeCreate")(function* () {
      if (!live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
      return yield* owned(native(async signal => {
        if (!live) throw new CoreError({ reason: "closed" });
        const req = await createLocalReq({ req: { signal } }, payload); const admitted = payload.collections[collection.slug];
        if (admitted === undefined) throw new CoreError({ reason: "closed" });
        await executeAccess({ req, data: structuredClone(captured) }, admitted.config.access.create);
      }));
    });
    return { digest, authorize, run: (root: BorrowedFrameworkRoot, transaction: string) => owned(invoke(root, transaction, { operation: "create", data: captured })) };
  });
  const create = Effect.fn("ExperimentPayload.create")(function* (request: string, data: unknown) {
    const prepared = yield* prepareCreate(data); const digest = prepared.digest;
    const command = yield* storage.open(scope, request, digest, definition, randomUUID());
    if (command.status === "committed") {
      yield* prepared.authorize();
      return yield* definition.decode(command.result);
    }
    const root = yield* createRoot(definition, storage, command);
    let accepting = false;
    return yield* Effect.gen(function* () {
      const result = yield* prepared.run(root, command.id);
      const candidate = yield* root.freeze();
      accepting = true;
      const committed = yield* storage.settle(command, candidate.changes, candidate.dependencies, result, candidate.events).pipe(
        Effect.catchTag("CoreError", error => {
          if (error.reason !== "storage" || error.phase !== undefined && error.phase !== "commit") {
            accepting = false; return Effect.fail(error);
          }
          return storage.resolve(scope, request, digest).pipe(
            Effect.catchTag("CoreError", recovery => Effect.fail(new CoreError({ reason: "uncertain", cause: { original: error, recovery } }))),
          );
        }),
      );
      return yield* definition.decode(committed);
    }).pipe(Effect.ensuring(Effect.gen(function* () {
      yield* root.close;
      if (!accepting) yield* storage.abort(command);
    }).pipe(Effect.orDie)));
  }, effect => effect.pipe(Effect.mapError(error => error instanceof CoreError && error.reason === "unique"
    ? new NativeFailure({ cause: projectUnique() }) : error)));
  const read = Effect.fn("ExperimentPayload.read")((id: string) => native(signal => {
    const binding: Binding = { root: null, transaction: null, readId: id, signal, live: true, operations: 0, pending: new Set() };
    return current.run(binding, () => inBinding(binding, () => payload.findByID({ collection: collection.slug, id, depth: 0, overrideAccess: false, req: { signal } })));
  }).pipe(Effect.flatMap(definition.decode)));
  const owned = <A, E>(work: Effect.Effect<A, E>) => supervise(scopeOwner, work);
  const authorizeUpdatedResult = Effect.fn("ExperimentPayload.authorizeUpdatedResult")((id: string, data: unknown) => input(data).pipe(Effect.flatMap(captured => owned(native(async signal => {
    if (!live) throw new CoreError({ reason: "closed" });
    const req = await createLocalReq({ req: { signal } }, payload); const admitted = payload.collections[collection.slug];
    if (admitted === undefined) throw new CoreError({ reason: "closed" });
    // This closed profile admits boolean access. Native combined Where access
    // remains unsupported by its point-only adapter rather than bypassed here.
    const update = await executeAccess({ id, req, data: captured }, admitted.config.access.update);
    if (update !== true) throw new CoreError({ reason: "unsupported" });
    const readAccess = await executeAccess({ id, req }, admitted.config.access.read);
    if (readAccess !== true) throw new CoreError({ reason: "unsupported" });
  })))));
  return { create: (request: string, data: unknown) => owned(create(request, data)),
    read: (id: string) => owned(read(id)), definition,
    prepareCreate, authorizeUpdatedResult,
    borrowUpdate: (root: BorrowedFrameworkRoot, transaction: string, id: string, data: unknown) => owned(borrowUpdate(root, transaction, id, data)),
    borrowRead: (root: BorrowedFrameworkRoot, transaction: string, id: string) => owned(invoke(root, transaction, { operation: "read", id })) };
});
