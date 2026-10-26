import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { Cause, Clock, Effect, Exit, Schema } from "effect";
import { BasePayload, buildConfig, createLocalReq, deepCopyObjectSimple, executeAccess, ValidationError, type BaseDatabaseAdapter,
  type CollectionConfig, type DatabaseAdapterObj, type PayloadRequest, type TypeWithID } from "payload";
import { compilePayloadDefinition } from "./payload-definition.ts";
import { CoreError, NativeFailure, NativeOperationFailure } from "./errors.ts";
import { createRoot, type Root } from "./root.ts";
import type { Storage } from "./storage.ts";
import { runCallback, supervise } from "./callback.ts";
import { JsonValue } from "./value.ts";

interface Binding {
  readonly root: Root | null;
  readonly transaction: string | null;
  readonly readId: string | null;
  readonly signal: AbortSignal;
  live: boolean;
  operations: number;
}
const Input = Schema.Record(Schema.String, JsonValue);
/** Cancel capability use immediately, then drain the admitted completing callback.
 * Arbitrary remote/nonterminating hooks are outside this construction profile. */
const native = <A>(work: (signal: AbortSignal) => Promise<A>) => runCallback(work, cause => new NativeFailure({ cause }));

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
    create: async args => {
      const binding = bindingFor(args.req);
      if (binding.root === null || args.collection !== definition.table || args.customID !== undefined) return unsupported();
      const timestamp = new Date(await runAtAdapter(Clock.currentTimeMillis)).toISOString();
      return runAtAdapter(binding.root.insert({ ...args.data, id: randomUUID(),
        createdAt: args.data.createdAt ?? timestamp, updatedAt: args.data.updatedAt ?? timestamp }), args.req);
    },
    findOne: async <T extends TypeWithID>(args: Parameters<BaseDatabaseAdapter["findOne"]>[0]) => {
      const binding = bindingFor(args.req);
      if (binding.root !== null || args.collection !== definition.table || binding.readId === null) return unsupported();
      const where = Schema.decodeUnknownSync(Schema.Union([
        Schema.Struct({ id: Schema.Struct({ equals: Schema.String }) }),
        Schema.Struct({ and: Schema.Tuple([Schema.Struct({ id: Schema.Struct({ equals: Schema.String }) })]) }),
      ]))(args.where, { onExcessProperty: "error" });
      const id = "id" in where ? where.id.equals : where.and[0].id.equals;
      if (id !== binding.readId) return unsupported();
      const result = await runAtAdapter(storage.read(scope, definition, id));
      const document = result === null ? null : await runAtAdapter(definition.decode(result));
      // SAFETY: Payload's collection-selected generic is not a runtime decoder. The
      // metadata-derived definition above validates this closed profile.
      return document as T | null;
    },
    count: deferred, find: deferred, deleteOne: deferred, updateOne: deferred,
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
      if (binding.operations !== 1 || (binding.root !== null ? args.operation !== "create" : args.operation !== "read")) return unsupported();
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

  const create = Effect.fn("ExperimentPayload.create")(function* (request: string, data: unknown) {
    if (!live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    const input = yield* Schema.decodeUnknownEffect(Input)(data).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    if (Object.keys(input).some(key => !definition.fields.some(field => field.name === key)) || Buffer.byteLength(JSON.stringify(input)) > 262_144) {
      return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    }
    const digest = createHash("sha256").update(JSON.stringify({ definition: definition.version,
      data: Object.fromEntries(Object.entries(input).toSorted(([left], [right]) => left.localeCompare(right))) })).digest("hex");
    const command = yield* storage.open(scope, request, digest, definition, randomUUID());
    if (command.status === "committed") {
      yield* native(async () => {
        const req = await createLocalReq({}, payload);
        const admitted = payload.collections[collection.slug];
        if (admitted === undefined) throw new CoreError({ reason: "unsupported" });
        await executeAccess({ req, data: input }, admitted.config.access.create);
      });
      return yield* definition.decode(command.result);
    }
    const root = yield* createRoot(definition, storage, command);
    let accepting = false;
    return yield* Effect.gen(function* () {
      const document = yield* native(signal => {
        const binding: Binding = { root, transaction: command.id, readId: null, signal, live: true, operations: 0 };
        return current.run(binding, async () => {
          try { return await payload.create({ collection: collection.slug, data: input, depth: 0,
            overrideAccess: false, req: { transactionID: command.id, signal } }); }
          finally { binding.live = false; }
        });
      });
      const result = yield* definition.decode(document);
      const candidate = yield* root.freeze();
      accepting = true;
      const committed = yield* storage.settle(command, candidate.rows, candidate.dependencies, result).pipe(
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
    const binding: Binding = { root: null, transaction: null, readId: id, signal, live: true, operations: 0 };
    return current.run(binding, async () => {
      try { return await payload.findByID({ collection: collection.slug, id, depth: 0, overrideAccess: false, req: { signal } }); }
      finally { binding.live = false; }
    });
  }).pipe(Effect.flatMap(definition.decode)));
  const owned = <A, E>(work: Effect.Effect<A, E>) => supervise(scopeOwner, work);
  return { create: (request: string, data: unknown) => owned(create(request, data)),
    read: (id: string) => owned(read(id)), definition };
});
