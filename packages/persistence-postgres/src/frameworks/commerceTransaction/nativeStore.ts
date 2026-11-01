import { Cause, Effect, Result } from "effect";
import type { DocumentObject } from "flarex-protocol/document-value";
import { isJsonObject } from "flarex-protocol/json";
import type { CoreError, CoreNativeBindingMetadata, CoreNativeOperations } from "../../core/api";
import { coreNativeRelationalRows } from "../../core/nativePolicy";
import { coreNativeRelationalRow, executeCoreNativeRelationalRead, executeCoreNativeRelationalPage,
  prepareCoreNativeRelationalRead } from "../../core/nativeRelationalQuery";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { useCapturedPrivateJsonData } from "../../values/privateJsonData";
import { commerceError, type CommerceTransactionError } from "./model";
import { defaultCommerceResources, type CommerceResources } from "./resources";
import type { CommerceStore } from "./storeModel";
import { projectCoreCommerceFailure } from "./nativeFailure";
import { observeExecution } from "../../execution/diagnostics/operation";
import type { CommerceReferenceReplacement } from "./commands";

const nativeResult = <A>(work: Effect.Effect<A, CoreError>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));

/** Core owns row, key, default, observation and mutation semantics. This owner
 * translates the existing native query values and framework request envelope. */
export const makeNativeCommerceParticipant = Effect.fn("NativeCommerce.makeParticipant")(function* (
  operations: CoreNativeOperations, metadata: CoreNativeBindingMetadata,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, initialContext: BoundedRequestContext,
  transactionId: string, unixTime: number, resources: CommerceResources = defaultCommerceResources,
) {
  const stores = new Map<string, CommerceStore>();
  const retain = <Value>(value: Value) => Effect.gen(function* () {
    const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(value, lifetime.remainingBytes(), commerceError));
    yield* lifetime.fromResult(lifetime.charge(captured.bytes));
    return captured.value;
  });
  for (const declaration of metadata.definition.tables) {
    const policy = coreNativeRelationalRows(metadata.definition, declaration.name);
    const table = metadata.tables.find(candidate => candidate.name === declaration.name);
    if (policy === undefined || table === undefined) return yield* commerceError("unsupportedProfile");
    const guard = <Value>(context: BoundedRequestContext, mode: "read" | "write", work: Effect.Effect<Value, CommerceTransactionError>) =>
      lifetime.operation(context, transactionId, mode, work);
    const returnedRows = Effect.fn("NativeCommerce.returnRows")(function* (documents: readonly DocumentObject[]) {
      const rows = yield* nativeResult(Effect.forEach(documents, document => Effect.fromResult(coreNativeRelationalRow(document))));
      const value = yield* retain(rows);
      if (!Array.isArray(value) || !value.every(isJsonObject)) return yield* commerceError("storedCorruption");
      return value;
    });
    type Preparation = { captured?: Result.Result.Success<ReturnType<typeof useCapturedPrivateJsonData<CommerceTransactionError>>> };
    const prepare = (input: unknown, preparation: Preparation) => Effect.gen(function* () {
      const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(preparation.captured?.value ?? input,
        lifetime.remainingBytes(), commerceError));
      yield* lifetime.fromResult(lifetime.charge(captured.bytes));
      const query = yield* nativeResult(Effect.fromResult(prepareCoreNativeRelationalRead(policy, captured.value, resources.queryRows)));
      preparation.captured ??= captured;
      return query;
    });
    const read = (context: BoundedRequestContext, input: unknown, preparation: Preparation) => guard(context, "read", Effect.gen(function* () {
      const query = yield* prepare(input, preparation);
      const selected = yield* nativeResult(observeExecution(`NativeCommerce.query/${declaration.localName ?? table.name}`,
        executeCoreNativeRelationalRead(operations, table, policy, query)));
      const rows = yield* retain(selected.rows);
      if (!Array.isArray(rows) || !rows.every(isJsonObject)) return yield* commerceError("storedCorruption");
      return { rows, count: selected.count };
    }));
    const readPage = (context: BoundedRequestContext, input: unknown, preparation: Preparation) => guard(context, "read", Effect.gen(function* () {
      const query = yield* prepare(input, preparation);
      const selected = yield* nativeResult(executeCoreNativeRelationalPage(operations, table, declaration, policy, query));
      const rows = yield* retain(selected.rows);
      if (!Array.isArray(rows) || !rows.every(isJsonObject)) return yield* commerceError("storedCorruption");
      return { rows, hasMore: selected.hasMore };
    }));
    const store: CommerceStore = Object.freeze({
      prepareRead: (input): ReturnType<CommerceStore["prepareRead"]> => {
        const preparation: Preparation = {};
        return Object.freeze({ find: context => read(context, input, preparation).pipe(Effect.map(result => result.rows)),
          findPage: context => readPage(context, input, preparation),
          count: context => read(context, input, preparation).pipe(Effect.map(result => result.count)) } satisfies ReturnType<CommerceStore["prepareRead"]>);
      },
      find: (context, input) => read(context, input, {}).pipe(Effect.map(result => result.rows)),
      findPage: (context, input) => readPage(context, input, {}),
      count: (context, input) => read(context, input, {}).pipe(Effect.map(result => result.count)),
      aggregate: context => guard(context, "read", Effect.fail(commerceError("unsupportedProfile"))),
      lifecycle: (context, mode, input) => guard(context, "write", Effect.gen(function* () {
        const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), commerceError));
        yield* lifetime.fromResult(lifetime.charge(captured.bytes));
        return yield* returnedRows(yield* nativeResult(operations.lifecycle(table.name, mode, captured.value)));
      })),
      write: (context, mode, input) => guard(context, "write", Effect.gen(function* () {
        const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), commerceError));
        yield* lifetime.fromResult(lifetime.charge(captured.bytes));
        return yield* returnedRows(yield* nativeResult(observeExecution(`NativeCommerce.writeRows/${declaration.localName ?? table.name}/${mode}`,
          operations.writeRows(table.name, mode, captured.value))));
      })),
      delete: (context, input) => guard(context, "write", Effect.gen(function* () {
        const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), commerceError));
        yield* lifetime.fromResult(lifetime.charge(captured.bytes));
        return yield* returnedRows(yield* nativeResult(operations.deleteRows(table.name, captured.value)));
      })),
    } satisfies CommerceStore);
    stores.set(declaration.localName ?? declaration.name, store);
  }
  const table = (context: BoundedRequestContext, name: string) => lifetime.operation(context, transactionId, "read", Effect.suspend(() => {
    const store = stores.get(name);
    return store === undefined ? Effect.fail(commerceError("invalidAuthority")) : Effect.succeed(store);
  }));
  const first = metadata.definition.tables[0];
  if (first === undefined) return yield* commerceError("unsupportedProfile");
  const store = yield* table(initialContext, first.localName ?? first.name);
  return Object.freeze({ store, resources, table,
    planReferenceReplacement: (context: BoundedRequestContext, selection: CommerceReferenceReplacement) => lifetime.operation(context, transactionId, "write", Effect.gen(function* () {
      const source = metadata.definition.tables.find(declaration => (declaration.localName ?? declaration.name) === selection.sourceTable);
      const target = metadata.definition.tables.find(declaration => (declaration.localName ?? declaration.name) === selection.targetTable);
      if (source === undefined || target === undefined) return yield* commerceError("invalidAuthority");
      yield* nativeResult(operations.replaceReferenceSet({ ...selection, sourceTable: source.name, targetTable: target.name }));
    })),
    referenceReplacementChanges: () => Effect.gen(function* () {
      const changes = yield* nativeResult(operations.referenceReplacementChanges());
      return yield* Effect.forEach(changes, change => Effect.gen(function* () {
        const declaration = metadata.definition.tables.find(candidate => candidate.name === change.sourceTable);
        const policy = coreNativeRelationalRows(metadata.definition, change.sourceTable);
        const key = policy?.rows.keyColumns.length === 1 ? policy.rows.keyColumns[0] : undefined;
        if (declaration === undefined || key === undefined) return yield* commerceError("storedCorruption");
        const ids: string[] = [];
        for (const document of change.documents) {
          const value = document[key];
          if (typeof value !== "string") return yield* commerceError("storedCorruption");
          ids.push(value);
        }
        return Object.freeze({ sourceTable: declaration.name, ids: Object.freeze(ids) });
      }));
    }),
    transactionTime: (context: BoundedRequestContext) => lifetime.operation(context, transactionId, "read",
      Effect.succeed(new Date(unixTime).toISOString())) });
});
