import { Cause, Effect, Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import { isJson, isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import type { CoreError, CoreNativeBindingMetadata, CoreNativeOperations } from "../../core/api";
import { coreNativeRelationalRows } from "../../core/nativePolicy";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { useCapturedPrivateJsonData } from "../../values/privateJsonData";
import { prepareRelationalRead, relationalSelectionValues, type RelationalSelection } from "../../values/relationalQuery";
import type { NormalizedRelationalPredicate } from "../../values/relationalPredicate";
import { commerceError, type CommerceTransactionError } from "./model";
import { defaultCommerceResources } from "./resources";
import type { CommerceStore } from "./storeModel";
import { projectCoreCommerceFailure } from "./nativeFailure";

const nativeResult = <A>(work: Effect.Effect<A, CoreError>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
const pageWhere = (predicate: NormalizedRelationalPredicate): Result.Result<JsonObject, CommerceTransactionError> => Result.gen(function* () {
  if (predicate.kind === "isNull") return { [predicate.column]: null };
  if (predicate.kind !== "and") return yield* Result.fail(commerceError("unsupportedProfile"));
  const where: Record<string, Json> = {};
  for (const child of predicate.children) Object.assign(where, yield* pageWhere(child));
  return where;
});
const nativeRow = (document: DocumentObject): Result.Result<JsonObject, CommerceTransactionError> => {
  const { _id, _creationTime, ...row } = document;
  return isJson(row) && isJsonObject(row) ? Result.succeed(row) : Result.fail(commerceError("storedCorruption"));
};
const project = (row: JsonObject, fields: readonly string[]): Result.Result<JsonObject, CommerceTransactionError> => Result.gen(function* () {
  const output: Record<string, Json> = {};
  for (const field of fields) {
    const value = row[field];
    if (value === undefined) return yield* Result.fail(commerceError("storedCorruption"));
    output[field] = value;
  }
  return output;
});

/** Core owns row, key, default, observation and mutation semantics. This owner
 * translates the existing native query values and framework request envelope. */
export const makeNativeCommerceParticipant = Effect.fn("NativeCommerce.makeParticipant")(function* (
  operations: CoreNativeOperations, metadata: CoreNativeBindingMetadata,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, initialContext: BoundedRequestContext,
  transactionId: string, unixTime: number,
) {
  const resources = defaultCommerceResources;
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
      const rows = yield* Effect.forEach(documents, document => Effect.fromResult(nativeRow(document)));
      const value = yield* retain(rows);
      if (!Array.isArray(value) || !value.every(isJsonObject)) return yield* commerceError("storedCorruption");
      return value;
    });
    const selectedWhere = (selection: RelationalSelection | null, nulls: readonly string[], key: string): JsonObject => {
      if (selection === null) {
        const anchor = nulls.find(field => table.indexes.some(index => index.fields[0] === field));
        return anchor === undefined ? { [key]: { gte: "" } } : { [anchor]: null };
      }
      const values = relationalSelectionValues(selection);
      const where: Record<string, Json> = {};
      for (const field of values.fields) {
        const value = values.value(field);
        if (value !== undefined) where[field] = value;
      }
      return where;
    };
    type Preparation = { captured?: Result.Result.Success<ReturnType<typeof useCapturedPrivateJsonData<CommerceTransactionError>>> };
    const prepare = (input: unknown, preparation: Preparation) => Effect.gen(function* () {
      const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(preparation.captured?.value ?? input,
        lifetime.remainingBytes(), commerceError));
      yield* lifetime.fromResult(lifetime.charge(captured.bytes));
      const prepared = yield* lifetime.fromResult(prepareRelationalRead(policy.table, captured.value, resources.queryRows, commerceError));
      const query = yield* lifetime.fromResult(prepared.compile());
      if (query.postgresPredicate !== undefined || query.search !== null || query.json !== null || query.storageInsertion)
        return yield* commerceError("unsupportedProfile");
      preparation.captured ??= captured;
      return { ...query, predicate: prepared.predicate };
    });
    const read = (context: BoundedRequestContext, input: unknown, preparation: Preparation) => guard(context, "read", Effect.gen(function* () {
      const query = yield* prepare(input, preparation);
      if (query.selections === null && query.requiresIndexedNullAnchor
        && !query.requiredNulls.some(field => table.indexes.some(index => index.fields[0] === field)))
        return yield* commerceError("invalidInput");
      const candidates = new Map<string, DocumentObject>();
      for (const selection of query.selections ?? [null]) {
        const documents = yield* nativeResult(operations.find(table.name, selectedWhere(selection, query.requiredNulls, query.key)));
        for (const document of documents) {
          if (typeof document._id !== "string") return yield* commerceError("storedCorruption");
          candidates.set(document._id, document);
        }
      }
      const selected = yield* lifetime.fromResult(Result.gen(function* () {
        const matched: { readonly id: string; readonly row: JsonObject; readonly order: Uint8Array }[] = [];
        for (const [id, document] of candidates) {
          const row = yield* nativeRow(document);
          const inspected = yield* query.inspect(row);
          if (inspected.matches) matched.push({ id, row, order: inspected.order });
        }
        matched.sort((left, right) => compareBytesLexicographically(left.order, right.order)
          * (query.direction === "asc" ? 1 : -1) || left.id.localeCompare(right.id));
        const rows: JsonObject[] = [];
        for (const member of matched.slice(query.offset, query.offset + query.limit)) rows.push(yield* project(member.row, query.fields));
        return { rows, count: matched.length };
      }));
      const rows = yield* retain(selected.rows);
      if (!Array.isArray(rows) || !rows.every(isJsonObject)) return yield* commerceError("storedCorruption");
      return { rows, count: selected.count };
    }));
    const readPage = (context: BoundedRequestContext, input: unknown, preparation: Preparation) => guard(context, "read", Effect.gen(function* () {
      const query = yield* prepare(input, preparation);
      if (query.includeIdentities || query.direction !== "asc" || query.selections !== null && query.selections.length > 1)
        return yield* commerceError("unsupportedProfile");
      if (query.selections?.length === 0) return { rows: Object.freeze([]), hasMore: false };
      const where = yield* lifetime.fromResult(pageWhere(query.predicate));
      const index = table.indexes.find(candidate => candidate.fields[0] === query.orderColumn
        && declaration.indexes?.some(binding => binding.indexName === candidate.name && binding.requiredPrefix === undefined));
      if (index === undefined) return yield* commerceError("unsupportedProfile");
      const page = yield* nativeResult(operations.findPage(table.name, where,
        { indexName: index.name, offset: query.offset, limit: query.limit, order: "asc" }));
      const selected = yield* lifetime.fromResult(Result.gen(function* () {
        const rows: JsonObject[] = [];
        for (const document of page.documents) rows.push(yield* project(yield* nativeRow(document), query.fields));
        return rows;
      }));
      const rows = yield* retain(selected);
      if (!Array.isArray(rows) || !rows.every(isJsonObject)) return yield* commerceError("storedCorruption");
      return { rows, hasMore: page.hasMore };
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
      lifecycle: context => guard(context, "write", Effect.fail(commerceError("unsupportedProfile"))),
      write: (context, mode, input) => guard(context, "write", Effect.gen(function* () {
        if (mode === "upsertPreservingDeletion") return yield* commerceError("unsupportedProfile");
        const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), commerceError));
        yield* lifetime.fromResult(lifetime.charge(captured.bytes));
        return yield* returnedRows(yield* nativeResult(operations.writeRows(table.name, mode, captured.value)));
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
    transactionTime: (context: BoundedRequestContext) => lifetime.operation(context, transactionId, "read",
      Effect.succeed(new Date(unixTime).toISOString())) });
});
