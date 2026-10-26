import { createHash, randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import type { DatabaseReader, DatabaseWriter, MutationCtx, QueryCtx, RegisteredFunction } from "../../../packages/flarex/src/server.ts";
import { createQueryInitializer, type DatabaseQueryRequest, type OrderedQuery } from "../../../packages/flarex/src/query.ts";
import { encodeFlarexId, parseFlarexId } from "../../../packages/flarex/src/ids.ts";
import type { Id } from "../../../packages/flarex/src/values.ts";
import { validateFunctionArgs, validateValue, ValidationError } from "../../../packages/flarex/src/validation.ts";
import { AppDocumentIdV1Schema } from "../../../packages/flarex-protocol/src/app-document-id.ts";
import { encodeCanonicalJson } from "../../../packages/flarex-protocol/src/json.ts";
import { SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1, ScopeSyncDependencyKeyV1Schema, normalizeScopeSyncDependencyKeySetV1Result } from "../../../packages/flarex-protocol/src/scope-sync-v1.ts";
import { APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1, APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1 } from "../../../packages/flarex-protocol/src/application-revision-syscall-validation-v1.ts";
import type { Definition, Document } from "./definition.ts";
import { ApplicationFailure, ApplicationOperationFailure, CoreError, DocumentValidationFailure } from "./errors.ts";
import { createApplicationMutationRoot, createApplicationQueryRoot, type ApplicationMutationRoot, type ApplicationQueryRoot } from "./application-root.ts";
import type { ApplicationStorage } from "./application-storage.ts";
import { applicationLimits, NumericRange, type Dependency } from "./query.ts";
import { runCallback, supervise } from "./callback.ts";
import { CreationTime } from "./application-values.ts";
import { JsonValue } from "./value.ts";

type AppDocument = Record<string, Schema.Json> & { _id: Id<string>; _creationTime: number };
type Model = Record<string, { document: AppDocument; fieldPaths: string; indexes: Record<string, readonly [string]> }>;
type Functions = Readonly<Record<string, RegisteredFunction>>;
type Root = ApplicationQueryRoot | ApplicationMutationRoot;
const Input = Schema.Record(Schema.String, JsonValue);
const Request = Schema.Struct({ table: Schema.String, index: Schema.optionalKey(Schema.String),
  range: Schema.optionalKey(Schema.Struct({ expressions: Schema.Array(Schema.Struct({ op: Schema.Literals(["eq", "gt", "gte", "lt", "lte"]), field: Schema.String, value: Schema.Number.check(Schema.isFinite()) })).check(Schema.isMaxLength(8)) })),
  order: Schema.optionalKey(Schema.Literal("asc")) });

const compileRange = (definition: Definition, input: DatabaseQueryRequest) => Result.gen(function* () {
  const request = yield* Schema.decodeUnknownResult(Request)(input, { onExcessProperty: "error" }).pipe(Result.mapError(cause => new CoreError({ reason: "unsupported", cause })));
  const index = definition.indexes.find(candidate => candidate.name === request.index);
  if (request.table !== definition.table || index === undefined) return yield* Result.fail(new CoreError({ reason: "unsupported" }));
  let lower: NumericRange["lower"] = null; let upper: NumericRange["upper"] = null;
  for (const expression of request.range?.expressions ?? []) {
    if (expression.field !== index.field) return yield* Result.fail(new CoreError({ reason: "unsupported" }));
    const bound = { value: expression.value, inclusive: expression.op === "eq" || expression.op === "gte" || expression.op === "lte" };
    if (expression.op === "eq" || expression.op === "gt" || expression.op === "gte") {
      if (lower === null || bound.value > lower.value || bound.value === lower.value && !bound.inclusive) lower = bound;
    }
    if (expression.op === "eq" || expression.op === "lt" || expression.op === "lte") {
      if (upper === null || bound.value < upper.value || bound.value === upper.value && !bound.inclusive) upper = bound;
    }
  }
  return { index: index.name, field: index.field, lower, upper };
});

const validateNative = (work: () => void) => Effect.try({ try: work, catch: cause => cause }).pipe(Effect.catch(cause =>
  cause instanceof ValidationError ? Effect.fail(new CoreError({ reason: "invalid", cause })) : Effect.die(cause)));

const syncKeys = (dependencies: readonly Dependency[], tableId: number) => Result.gen(function* () {
  const keys = [];
  for (const dependency of dependencies) {
    const key = yield* Schema.decodeUnknownResult(ScopeSyncDependencyKeyV1Schema)(dependency.kind === "point"
      ? { format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1, version: 1, kind: "appRowPoint", documentId: dependency.id }
      : { format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1, version: 1, kind: "appTable", tableId });
    keys.push(key);
  }
  return yield* normalizeScopeSyncDependencyKeySetV1Result(keys);
});

/** Existing Flarex registration/query builder/validators, candidate execution.
 * Only a trusted, locally completing function corpus is admitted in this host;
 * this is neither deployed-function analysis nor a Worker isolation boundary. */
export const createApplicationHost = Effect.fn("ExperimentApplication.host")(function* (
  definition: Definition, storage: ApplicationStorage, scope: string, functions: Functions, retryableMutations: readonly string[] = [],
) {
  const tableId = definition.tableId;
  if (tableId === null || definition.fields.some(field => field.nullable || field.kind !== "text" && field.kind !== "number")) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
  const owner = yield* Effect.scope;
  let live = true; yield* Effect.addFinalizer(() => Effect.sync(() => { live = false; }));
  const entries = Object.freeze({ ...functions });
  const eligible = new Set(retryableMutations);
  const select = (name: string, kind: "query" | "mutation") => {
    const fn = entries[name];
    return !live ? Effect.fail(new CoreError({ reason: "closed" })) : fn === undefined || fn.kind !== kind || fn.partition !== null
      ? Effect.fail(new CoreError({ reason: "unsupported" })) : Effect.succeed(fn);
  };
  const id = (value: string) => Schema.decodeUnknownEffect(AppDocumentIdV1Schema)(value).pipe(
    Effect.mapError(cause => new CoreError({ reason: "invalid", cause })),
    Effect.flatMap(decoded => parseFlarexId(decoded)?.tableId === tableId ? Effect.succeed(decoded) : Effect.fail(new CoreError({ reason: "denied" }))),
  );
  const project = (body: Document) => Effect.gen(function* () {
    const parsed = parseFlarexId(body.id);
    if (parsed === null || parsed.tableId !== tableId) return yield* Effect.fail(new CoreError({ reason: "storage" }));
    const creation = yield* Schema.decodeUnknownEffect(CreationTime)(body.systemCreationTime).pipe(Effect.mapError(cause => new CoreError({ reason: "storage", cause })));
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, systemCreationTime: _systemCreationTime, ...fields } = body;
    const result: AppDocument = { ...fields, _id: encodeFlarexId(tableId, parsed.documentId), _creationTime: creation };
    return result;
  });
  const invoke = (root: Root, fn: RegisteredFunction, args: Record<string, Schema.Json>) => runCallback(async signal => {
    let active = true;
    const running = new Set<Promise<unknown>>();
    const execute = async <A>(operation: Effect.Effect<A, CoreError | DocumentValidationFailure>): Promise<A> => {
      const exit = await Effect.runPromiseExit(operation);
      if (Exit.isSuccess(exit)) return exit.value;
      const reason = exit.cause.reasons[0];
      if (exit.cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof DocumentValidationFailure) {
        throw Object.assign(new Error(APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1, { cause: reason.error }), { name: APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1 });
      }
      await Effect.runPromise(root.poison(exit.cause));
      throw new ApplicationOperationFailure({ cause: exit.cause });
    };
    // Own the complete Promise exposed to guest code, including SDK result
    // projection. A dropped rejected Promise must still be handled and drained.
    const track = <A>(work: () => Promise<A>): Promise<A> => {
      const pending = Promise.resolve().then(() => {
        if (!active || !live || signal.aborted) throw new ApplicationOperationFailure({ cause: Cause.fail(new CoreError({ reason: "closed" })) });
        return work();
      }); running.add(pending);
      void pending.then(() => { running.delete(pending); }, () => { running.delete(pending); });
      return pending;
    };
    const unsupported = (): Promise<never> => track(async () => {
      const error = new CoreError({ reason: "unsupported" }); await execute(root.poison(Cause.fail(error))); throw new ApplicationOperationFailure({ cause: Cause.fail(error) });
    });
    const ownQuery = (query: OrderedQuery<Model[string]>): OrderedQuery<Model[string]> => ({
      order: order => ownQuery(query.order(order)), collect: () => track(() => query.collect()),
      take: count => track(() => query.take(count)), first: () => track(() => query.first()), unique: () => track(() => query.unique()),
      paginate: options => track(() => query.paginate(options)),
    });
    const reader: DatabaseReader<Model> = {
      get: documentId => track(() => execute(id(documentId).pipe(Effect.flatMap(root.get), Effect.flatMap(body => body === null ? Effect.succeed(null) : project(body))))),
      query: table => {
        const query = createQueryInitializer<Model[string]>(table, async request => {
          const page = await execute(Effect.fromResult(compileRange(definition, request)).pipe(Effect.flatMap(root.range), Effect.flatMap(rows => Effect.forEach(rows, project))));
          return { page, isDone: true, continueCursor: "" };
        });
        return { ...ownQuery(query), withIndex: (name, range) => ownQuery(query.withIndex(name, range)) };
      },
    };
    const mutation = "insert" in root ? root : null;
    const writer: DatabaseWriter<Model> = {
      ...reader,
      insert: <Table extends string>(table: Table, value: Record<string, Schema.Json>) => {
        if (mutation === null || table !== definition.table) return unsupported();
        const captured = structuredClone(value);
        return track(async () => {
          const created = await execute(mutation.insert(tableId, captured));
          const parsed = parseFlarexId(created); if (parsed === null) throw new Error("Allocated Application identity is invalid");
          return encodeFlarexId<Table>(tableId, parsed.documentId);
        });
      },
      patch: (documentId, value) => { const captured = structuredClone(value); return mutation === null ? unsupported() : track(() => execute(id(documentId).pipe(Effect.flatMap(decoded => mutation.patch(decoded, captured))))); },
      replace: (documentId, value) => { const captured = structuredClone(value); return mutation === null ? unsupported() : track(() => execute(id(documentId).pipe(Effect.flatMap(decoded => mutation.replace(decoded, captured))))); },
      delete: documentId => mutation === null ? unsupported() : track(() => execute(id(documentId).pipe(Effect.flatMap(mutation.delete)))),
    };
    const auth = { getUserIdentity: async () => null };
    const context: QueryCtx<Model> | MutationCtx<Model> = mutation === null ? { db: reader, auth, runQuery: unsupported }
      : { db: writer, auth, runQuery: unsupported, runMutation: unsupported };
    // SAFETY: registration deliberately erases the handler context to never.
    // Its kind was selected above; these are the actual SDK ctx.db contracts,
    // and only the admitted scalar/JSON profile is exposed by their methods.
    const handler = fn.handler as (ctx: QueryCtx<Model> | MutationCtx<Model>, args: Record<string, Schema.Json>) => unknown;
    let outcome: Result.Result<unknown, unknown>;
    try { outcome = Result.succeed(await handler(context, structuredClone(args))); }
    catch (cause) { outcome = Result.fail(cause); }
    active = false;
    const unfinished = [...running];
    if (unfinished.length !== 0) {
      const unfinishedError = new CoreError({ reason: "unsupported" }); await Effect.runPromise(root.poison(Cause.fail(unfinishedError)));
      const drained = await Promise.allSettled(unfinished);
      const failures: unknown[] = [...(Result.isFailure(outcome) ? [outcome.failure] : []), ...drained.flatMap(result => result.status === "rejected" ? [result.reason] : [])];
      const causes = failures.map(cause => cause instanceof ApplicationOperationFailure ? cause.cause : Cause.fail(new ApplicationFailure({ cause })));
      throw new ApplicationOperationFailure({ cause: causes.reduce((combined, cause) => Cause.combine(combined, cause), Cause.fail<CoreError | DocumentValidationFailure | ApplicationFailure>(unfinishedError)) });
    }
    return Result.match(outcome, { onSuccess: value => value, onFailure: cause => { throw cause; } });
  }, cause => cause instanceof ApplicationOperationFailure ? cause : new ApplicationFailure({ cause })).pipe(
    Effect.catchTag("ApplicationOperationFailure", error => Effect.failCause(error.cause)),
  );
  const input = (fn: RegisteredFunction, args: unknown) => Schema.decodeUnknownEffect(Input)(args).pipe(
    Effect.mapError(cause => new CoreError({ reason: "invalid", cause })),
    Effect.map(value => structuredClone(value)),
    Effect.tap(value => validateNative(() => validateFunctionArgs(fn.args, value))),
    Effect.flatMap(value => Buffer.byteLength(JSON.stringify(value)) > applicationLimits.bytes ? Effect.fail(new CoreError({ reason: "limit" })) : Effect.succeed(value)),
  );
  const output = (fn: RegisteredFunction, value: unknown) => Schema.decodeUnknownEffect(JsonValue)(value).pipe(
    Effect.mapError(cause => new CoreError({ reason: "invalid", cause })),
    Effect.map(decoded => structuredClone(decoded)),
    Effect.tap(decoded => { const returns = fn.returns; return returns === null ? Effect.void : validateNative(() => validateValue(returns, decoded)); }),
    Effect.flatMap(decoded => Buffer.byteLength(JSON.stringify(decoded)) > applicationLimits.bytes ? Effect.fail(new CoreError({ reason: "limit" })) : Effect.succeed(decoded)),
  );
  const query = Effect.fn("ExperimentApplication.query")(function* (name: string, args: unknown) {
    const fn = yield* select(name, "query"); const data = yield* input(fn, args);
    const snapshot = yield* storage.openQuery(scope, definition);
    return yield* Effect.gen(function* () {
      const root = yield* createApplicationQueryRoot(definition, storage, snapshot);
      return yield* Effect.gen(function* () {
        const value = yield* output(fn, yield* invoke(root, fn, data)); const dependencies = yield* root.finish();
        const keys = yield* Effect.fromResult(syncKeys(dependencies, tableId)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
        return { value, snapshot: snapshot.sequence, dependencies, syncKeys: keys };
      }).pipe(Effect.ensuring(root.close));
    }).pipe(Effect.ensuring(storage.closeSnapshot(snapshot)));
  });
  const mutate = Effect.fn("ExperimentApplication.mutate")(function* (name: string, request: string, args: unknown) {
    const fn = yield* select(name, "mutation"); const data = yield* input(fn, args);
    const digest = createHash("sha256").update(encodeCanonicalJson({ profile: "application", name, definition: definition.version,
      handler: fn.handler.toString(), args: fn.exportArgs(), returns: fn.exportReturns(), data },
    () => { throw new Error("Validated Application command JSON lost an entry"); })).digest("hex");
    let command = yield* storage.openMutation(scope, request, digest, definition, randomUUID());
    if (command.status === "committed") return { value: yield* output(fn, command.result), attempts: 0, snapshot: command.snapshot };
    for (let attempt = 1; attempt <= applicationLimits.attempts; attempt++) {
      let accepting = false; let retryable = false;
      const exit = yield* Effect.exit(Effect.gen(function* () {
        const snapshot = yield* storage.commandSnapshot(command);
        return yield* Effect.gen(function* () {
          const root = yield* createApplicationMutationRoot(definition, storage, snapshot);
          return yield* Effect.gen(function* () {
            const value = yield* output(fn, yield* invoke(root, fn, data)); const candidate = yield* root.freeze();
            accepting = true;
            const committed = yield* storage.accept(command, candidate.changes, candidate.dependencies, value).pipe(Effect.catchTag("CoreError", error => {
              if (error.reason === "conflict") { accepting = false; retryable = true; return Effect.fail(error); }
              if (error.reason !== "storage" || error.phase !== undefined && error.phase !== "commit") { accepting = false; return Effect.fail(error); }
              return storage.resolve(scope, request, digest).pipe(Effect.catchTag("CoreError", recovery => Effect.fail(new CoreError({ reason: "uncertain", cause: { original: error, recovery } }))));
            }));
            return { value: yield* output(fn, committed), attempts: attempt, snapshot: snapshot.sequence };
          }).pipe(Effect.ensuring(root.close));
        }).pipe(Effect.ensuring(storage.closeSnapshot(snapshot)));
      }).pipe(Effect.ensuring(Effect.gen(function* () { if (!accepting) yield* storage.abort(command); }).pipe(Effect.orDie))));
      if (Exit.isSuccess(exit)) return exit.value;
      const reason = exit.cause.reasons[0];
      if (!retryable || !eligible.has(name) || attempt === applicationLimits.attempts || exit.cause.reasons.length !== 1 ||
        reason === undefined || !Cause.isFailReason(reason) || !(reason.error instanceof CoreError) || reason.error.reason !== "conflict") return yield* Effect.failCause(exit.cause);
      command = yield* storage.restart(command);
    }
    return yield* Effect.fail(new CoreError({ reason: "conflict" }));
  });
  return { query: (name: string, args: unknown) => supervise(owner, query(name, args)),
    mutate: (name: string, request: string, args: unknown) => supervise(owner, mutate(name, request, args)) };
});
