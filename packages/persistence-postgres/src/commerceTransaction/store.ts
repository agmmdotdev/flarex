import { sql, type SQL } from "drizzle-orm";
import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isCanonicalIsoInstant } from "@flarex/time/iso-instant";
import { isPrivateValueText } from "../frameworkSchema/privateStoredValueShape";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { captureRelationalRowKey } from "../commitPublication/relationalFacts";
import { selectRelationalRowKey } from "../commitPublication/relationalRowKey";
import { capturePrivateJsonData } from "../privateJsonData";
import { decodeCommerceDriverRows as driverRows } from "./driverRows";
import { runOwnedPromise } from "../ownedPromise";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../boundedRequestLifetime";
import type { RelationalPhysicalColumn } from "../relationalSchema/physical/model";
import { requireCommerceAdmission, type CommerceAdmission } from "./admission";
import { commerceError, commerceLimits, type CommerceTransactionError } from "./model";
import type { CommerceProfileState, CommerceTableCapability } from "./profile";
import { makeCommerceWriteEnvelopePolicy } from "./writeEnvelope";

export interface RelationalRowFact {
  readonly codecVersion: 1 | 2;
  readonly tableId: string;
  readonly keyBytes: Uint8Array;
  readonly operation: "insert" | "update" | "delete";
}
export interface CommerceLifecycleObservation {
  readonly tableId: string;
  readonly keyBytes: Uint8Array;
  readonly operation: "softDelete" | "restore";
  readonly beforeDeletedAt: string | null;
  readonly afterDeletedAt: string | null;
}
/** Storage-owned, operation-local evidence for trusted event validation only. */
export interface CommerceRowObservation {
  readonly tableId: string;
  readonly keyBytes: Uint8Array;
  readonly operation: "insert" | "update" | "delete" | "softDelete" | "restore";
  readonly changed: boolean;
  readonly row: JsonObject;
}
declare const closureBrand: unique symbol;
export interface CommerceRowClosure { readonly [closureBrand]: true }
interface ClosureState {
  readonly admission: CommerceAdmission;
  readonly lifetime: BoundedRequestLifetime<CommerceTransactionError>;
  readonly facts: readonly RelationalRowFact[];
}
const closures = new WeakMap<object, ClosureState>();

export type { CommerceStore } from "./storeModel";
import type { CommerceStore } from "./storeModel";

const invalid = () => commerceError("invalidInput");
// Inputs are already detached plain JSON. PostgreSQL text and JSONB must preserve
// every string and object key exactly across the driver UTF-8 boundary.
const representable = (value: Json): boolean => typeof value === "string" ? isPrivateValueText(value) :
  value === null || typeof value !== "object" ? true : Array.isArray(value) ? value.every(representable) :
  Object.entries(value).every(([key, member]) => isPrivateValueText(key) && representable(member));
const countWithin = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;

interface StoreWork {
  readonly facts: RelationalRowFact[];
  readonly lifecycle: CommerceLifecycleObservation[];
  readonly observations: CommerceRowObservation[];
  closed: boolean;
}
// Every store borrowed within one request shares its statement quota. Keep facts
// local to each call so aggregate publication can preserve execution order.
const statementCounts = new WeakMap<BoundedRequestLifetime<CommerceTransactionError>, number>();
// Descriptors are captured and frozen by the authenticated profile registry.
// Retain the pure compiler at that lifetime, not at each table/request lifetime.
const writePolicies = new WeakMap<CommerceProfileState, ReturnType<typeof makeCommerceWriteEnvelopePolicy>>();

export const makeCommerceStore = Effect.fn("CommerceStore.make")(function* (
  admission: CommerceAdmission, lifetime: BoundedRequestLifetime<CommerceTransactionError>, id: string,
) {
  const state = yield* requireCommerceAdmission(admission);
  const work: StoreWork = { facts: [], lifecycle: [], observations: [], closed: false };
  let writePolicy = writePolicies.get(state.descriptor);
  if (writePolicy === undefined) {
    writePolicy = makeCommerceWriteEnvelopePolicy(state.descriptor.resources);
    writePolicies.set(state.descriptor, writePolicy);
  }
  const stores = new Map<string, CommerceStore>();
  for (const capability of state.descriptor.tables) {
    stores.set(capability.tableId, yield* makeCommerceTableStore(admission, lifetime, id, capability, work, writePolicy));
  }
  const first = stores.values().next().value;
  if (first === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const table = Effect.fn("CommerceStore.table")((context: BoundedRequestContext, tableId: string) =>
    lifetime.operation(context, id, "read", Effect.gen(function* () {
      yield* requireCommerceAdmission(admission);
      const selected = stores.get(tableId);
      if (work.closed || selected === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      return selected;
    })));
  const close = Effect.fn("CommerceStore.close")(function* () {
    yield* requireCommerceAdmission(admission);
    if (work.closed || !lifetime.isClosing()) return yield* Effect.fail(commerceError("invalidAuthority"));
    work.closed = true;
    // SAFETY: the finalizer consumes this exact admission/lifetime-bound closure once.
    const closure = Object.freeze({}) as CommerceRowClosure;
    closures.set(closure, { admission, lifetime, facts: Object.freeze(work.facts.slice()) });
    return closure;
  });
  const snapshot = () => Object.freeze(work.facts.map(fact => Object.freeze({ ...fact, keyBytes: fact.keyBytes.slice() })));
  const lifecycleSnapshot = () => Object.freeze(work.lifecycle.map(item => Object.freeze({ ...item, keyBytes: item.keyBytes.slice() })));
  const observationSnapshot = () => Object.freeze(work.observations.map(item => Object.freeze({ ...item, keyBytes: item.keyBytes.slice() })));
  return { store: first, table, close, snapshot, lifecycleSnapshot, observationSnapshot, resources: state.descriptor.resources };
});

const makeCommerceTableStore = Effect.fn("CommerceStore.makeTable")(function* (
  admission: CommerceAdmission, lifetime: BoundedRequestLifetime<CommerceTransactionError>, id: string,
  capability: CommerceTableCapability, work: StoreWork, writePolicy: ReturnType<typeof makeCommerceWriteEnvelopePolicy>,
) {
  const state = yield* requireCommerceAdmission(admission);
  const layout = state.descriptor.layout.frame;
  const resources = state.descriptor.resources;
  const { commerceWriteEnvelope, decodeCommerceWriteEnvelope, checkCommerceCatalogSize } = writePolicy;
  const table = layout.tables.find(value => value.identity.tableId === capability.tableId);
  if (table === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const primary = yield* Effect.fromResult(selectRelationalRowKey(state.descriptor.layout, capability.tableId, capability.keyId))
    .pipe(Effect.mapError(() => commerceError("unsupportedProfile")));
  const keyColumns: RelationalPhysicalColumn[] = [];
  for (const name of primary.columns.slice(1)) {
    const field = table.columns.find(column => column.name === name);
    if (field === undefined || field.type !== "text") return yield* Effect.fail(commerceError("unsupportedProfile"));
    keyColumns.push(field);
  }
  const key = keyColumns[0];
  if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  const target = sql`${sql.identifier(layout.targetNamespace.schemaName)}.${sql.identifier(table.name)}`;
  const scoped = sql`${sql.identifier("scope_uuid")} = ${scope.scopeUuid}::uuid`;
  const timestamps = layout.requiredPhysicalCapabilities.flatMap(item => item.kind === "managedTimestamps" && item.updatedAtColumn.identity.tableId === capability.tableId
    ? [{ created: item.createdAtColumn.columnName, updated: item.updatedAtColumn.columnName }] : []);
  const managedUpdates = timestamps.map(item => item.updated);
  const protectedUpdates = new Set([
    ...timestamps.flatMap(item => [item.created, item.updated]),
    ...layout.requiredPhysicalCapabilities.flatMap(item => item.kind === "softDelete" && item.deletedAtColumn.identity.tableId === capability.tableId ? [item.deletedAtColumn.columnName] : []),
    ...layout.foreignKeys.flatMap(item => item.kind === "foreignKey" && item.sourceTable.tableId === capability.tableId ? item.sourceColumns.filter(name =>
      !table.columns.some(column => column.name === name && capability.referenceColumns?.includes(column.identity.columnId))) : []),
  ]);
  const facts = work.facts;
  const column = (name: unknown): Result.Result<RelationalPhysicalColumn, CommerceTransactionError> => {
    const found = table.columns.find(value => value.identity.columnId === name);
    return found === undefined ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(found);
  };
  const returning = sql.join(table.columns.map(value => sql`${sql.identifier(value.name)} as ${sql.identifier(value.identity.columnId)}`), sql`, `);
  const statement = <Value>(query: PromiseLike<Value>) => Effect.suspend(() => {
    const attempted = (statementCounts.get(lifetime) ?? 0) + 1;
    statementCounts.set(lifetime, attempted);
    return attempted > commerceLimits.calls
      ? Effect.fail(commerceError("limitExceeded", { boundary: "statements", attempted, tableId: capability.tableId })) : runOwnedPromise(() => Promise.resolve(query), cause => commerceError("statementFailure", cause));
  });
  const decodeRows = Effect.fn("CommerceStore.decodeRows")(function* (rows: readonly unknown[] | undefined) {
    if (rows === undefined || rows.length > resources.queryRows) return yield* Effect.fail(commerceError("storedCorruption"));
    const values: JsonObject[] = [];
    for (const row of rows) {
      if (!isNonArrayRecord(row)) return yield* Effect.fail(commerceError("storedCorruption"));
      const normalized = { ...row };
      for (const field of table.columns) {
        const value = normalized[field.identity.columnId];
        if (field.type === "timestamp with time zone" && value !== undefined && value !== null) {
          const timestamp = databaseTimestampFromUnknown(value);
          if (timestamp === null) return yield* Effect.fail(commerceError("storedCorruption"));
          normalized[field.identity.columnId] = timestamp.toISOString();
        }
      }
      const captured = yield* Effect.fromResult(capturePrivateJsonData(normalized, commerceLimits.rowBytes,
        (reason, cause) => commerceError(reason === "limitExceeded" ? reason : "storedCorruption", cause)));
      if (!isNonArrayRecord(captured.value)) return yield* Effect.fail(commerceError("storedCorruption"));
      for (const [name, value] of Object.entries(captured.value)) {
        const field = yield* Effect.fromResult(column(name)).pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
        yield* Effect.fromResult(parameter(field, value)).pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
      }
      yield* Effect.fromResult(lifetime.charge(captured.bytes));
      values.push(captured.value);
    }
    return Object.freeze(values);
  });
  const queryRows = Effect.fn("CommerceStore.queryRows")((query: SQL) =>
    statement(state.tx.execute(query)).pipe(Effect.flatMap(driverRows), Effect.flatMap(decodeRows)));
  const catalogBound = Effect.fn("CommerceStore.catalogBound")(function* () {
    const payload = sql`jsonb_build_object(${sql.join(table.columns.flatMap(field => [sql`${field.identity.columnId}::text`, sql`${sql.identifier(field.name)}`]), sql`, `)})`;
    const result = yield* statement(state.tx.execute(sql`select count(*)::integer as total, coalesce(max(octet_length(payload::text)), 0)::integer as maximum, coalesce(sum(octet_length(payload::text)), 0)::integer as bytes from (select ${payload} as payload from ${target} where ${scoped} limit ${resources.catalogRows + 1}) bounded`));
    const rows = yield* driverRows(result);
    const row = rows?.[0];
    if (rows?.length !== 1 || !isNonArrayRecord(row) || typeof row.total !== "number" || typeof row.maximum !== "number" || typeof row.bytes !== "number") return yield* Effect.fail(commerceError("storedCorruption"));
    if (row.total > resources.catalogRows || row.maximum > commerceLimits.rowBytes || row.bytes > lifetime.remainingBytes()) return yield* Effect.fail(commerceError("limitExceeded"));
    return { total: row.total, maximum: row.maximum, bytes: row.bytes };
  });
  const parameter = (field: RelationalPhysicalColumn, value: Json): Result.Result<SQL, CommerceTransactionError> => {
    // Physical type names are the captured layout's closed scalar union. Typed
    // NULLs are required in VALUES tables, where PostgreSQL otherwise infers text.
    if (value === null) return field.nullable ? Result.succeed(sql`cast(null as ${sql.raw(field.type)})`) : Result.fail(invalid());
    switch (field.type) {
      case "boolean": return typeof value === "boolean" ? Result.succeed(sql`${value}::boolean`) : Result.fail(invalid());
      case "text": return isPrivateValueText(value) ? Result.succeed(sql`${value}`) : Result.fail(invalid());
      case "integer": return typeof value === "number" && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647
        ? Result.succeed(sql`${value}::integer`) : Result.fail(invalid());
      case "numeric": return (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.length <= 1024 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value))
        ? Result.succeed(sql`${String(value)}::numeric`) : Result.fail(invalid());
      case "jsonb": return Result.succeed(sql`${JSON.stringify(value)}::jsonb`);
      case "timestamp with time zone": return typeof value === "string" && isCanonicalIsoInstant(value)
        ? Result.succeed(sql`${value}::timestamptz`) : Result.fail(invalid());
    }
  };
  const parseRead = (input: unknown) => Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, lifetime.remainingBytes(), commerceError);
    if (!representable(captured.value)) return yield* Result.fail(invalid());
    yield* lifetime.charge(captured.bytes);
    if (!isNonArrayRecord(captured.value) || Object.keys(captured.value).some(name => !["predicate", "fields", "skip", "take", "order"].includes(name))) return yield* Result.fail(invalid());
    const value = captured.value;
    const skip = value.skip ?? 0;
    const take = value.take ?? resources.queryRows;
    if (!countWithin(skip, resources.catalogRows - 1) || !countWithin(take, resources.queryRows)) return yield* Result.fail(commerceError("limitExceeded"));
    const fields = value.fields ?? table.columns.map(item => item.identity.columnId);
    if (!Array.isArray(fields) || fields.length === 0 || fields.length > table.columns.length) return yield* Result.fail(invalid());
    const selected: SQL[] = [];
    for (const name of fields) { const field = yield* column(name); selected.push(sql`${sql.identifier(field.name)} as ${sql.identifier(field.identity.columnId)}`); }
    const order = value.order;
    if (!isNonArrayRecord(order) || Object.keys(order).some(name => !["column", "direction"].includes(name)) || !["asc", "desc"].includes(String(order.direction))) return yield* Result.fail(invalid());
    const ordered = yield* column(order.column);
    let nodes = 0;
    let operands = 0;
    const predicate = (supplied: unknown, depth: number): Result.Result<SQL, CommerceTransactionError> => Result.gen(function* () {
      if (++nodes > commerceLimits.filterNodes || depth > commerceLimits.filterDepth) return yield* Result.fail(commerceError("limitExceeded"));
      if (!isNonArrayRecord(supplied)) return yield* Result.fail(invalid());
      if (supplied.kind === "and" || supplied.kind === "or") {
        if (Object.keys(supplied).some(name => !["kind", "children"].includes(name)) || !Array.isArray(supplied.children)) return yield* Result.fail(invalid());
        const parts: SQL[] = [];
        for (const child of supplied.children) parts.push(yield* predicate(child, depth + 1));
        return parts.length === 0 ? (supplied.kind === "and" ? sql`true` : sql`false`) : sql`(${sql.join(parts, supplied.kind === "and" ? sql` and ` : sql` or `)})`;
      }
      const field = yield* column(supplied.column);
      if (supplied.kind === "textLikeAscii" && field.type === "text" && Object.keys(supplied).every(name => ["kind", "column", "pattern"].includes(name))) {
        if (!isPrivateValueText(supplied.pattern)) return yield* Result.fail(invalid());
        if (++operands > commerceLimits.filterOperands) return yield* Result.fail(commerceError("limitExceeded"));
        yield* capturePrivateJsonData(supplied.pattern, commerceLimits.rowBytes, commerceError);
        // SQLite's pinned Medusa LIKE contract folds ASCII only and treats
        // backslashes literally. Parameters and trusted columns retain the
        // ordinary bounded, scoped read path for both find and count.
        return sql`translate(${sql.identifier(field.name)}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" like translate(${supplied.pattern}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" escape ''`;
      }
      if (supplied.kind === "isNull" && Object.keys(supplied).every(name => ["kind", "column"].includes(name))) return sql`${sql.identifier(field.name)} is null`;
      if (supplied.kind === "greaterThan" && field.type === "timestamp with time zone" && Object.keys(supplied).every(name => ["kind", "column", "value"].includes(name))) {
        if (typeof supplied.value !== "string") return yield* Result.fail(invalid());
        if (++operands > commerceLimits.filterOperands) return yield* Result.fail(commerceError("limitExceeded"));
        return sql`${sql.identifier(field.name)} > ${yield* parameter(field, supplied.value)}`;
      }
      if (supplied.kind !== "in" || Object.keys(supplied).some(name => !["kind", "column", "values"].includes(name)) || !Array.isArray(supplied.values)) return yield* Result.fail(invalid());
      operands += supplied.values.length;
      if (operands > commerceLimits.filterOperands) return yield* Result.fail(commerceError("limitExceeded"));
      const parts: SQL[] = [];
      for (const member of supplied.values) {
        const data = yield* capturePrivateJsonData(member, commerceLimits.rowBytes, commerceError);
        parts.push(yield* parameter(field, data.value));
      }
      return parts.length === 0 ? sql`false` : sql`${sql.identifier(field.name)} in (${sql.join(parts, sql`, `)})`;
    });
    return { filter: yield* predicate(value.predicate ?? { kind: "and", children: [] }, 0), selected: sql.join(selected, sql`, `),
      order: sql.join([sql`${sql.identifier(ordered.name)} ${order.direction === "asc" ? sql`asc` : sql`desc`}`,
        ...primary.columns.filter(name => name !== "scope_uuid" && name !== ordered.name).map(name => sql`${sql.identifier(name)} asc`)], sql`, `), skip, take };
  });
  const guard = <Value>(context: BoundedRequestContext, mode: "read" | "write", operation: Effect.Effect<Value, CommerceTransactionError>) =>
    lifetime.operation(context, id, mode, Effect.gen(function* () {
      yield* requireCommerceAdmission(admission);
      if (work.closed) return yield* Effect.fail(commerceError("closed"));
      return yield* operation;
    }));
  const find: CommerceStore["find"] = Effect.fn("CommerceStore.find")((context, input) => guard(context, "read", Effect.gen(function* () {
    const query = yield* Effect.fromResult(parseRead(input));
    yield* catalogBound();
    return yield* queryRows(sql`select ${query.selected} from ${target} where ${scoped} and (${query.filter}) order by ${query.order} offset ${query.skip} limit ${query.take}`);
  })));
  const count: CommerceStore["count"] = Effect.fn("CommerceStore.count")((context, input) => guard(context, "read", Effect.gen(function* () {
    const query = yield* Effect.fromResult(parseRead(input));
    yield* catalogBound();
    const result = yield* statement(state.tx.execute(sql`select count(*)::integer as total from ${target} where ${scoped} and (${query.filter})`));
    const rows = yield* driverRows(result);
    const row = rows?.[0];
    if (rows?.length !== 1 || !isNonArrayRecord(row) || !countWithin(row.total, resources.catalogRows)) return yield* Effect.fail(commerceError("storedCorruption"));
    return row.total;
  })));
  const observe = Effect.fn("CommerceStore.observe")(function* (row: JsonObject, operation: CommerceRowObservation["operation"], changed: boolean) {
    if (capability.observeRows !== true) return;
    if (work.observations.length >= resources.facts) return yield* Effect.fail(commerceError("limitExceeded"));
    const encoded = yield* captureRelationalRowKey(state.descriptor.layout, table.identity.tableId, row, capability.keyId)
      .pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
    const keyBytes = new TextEncoder().encode(encoded.canonicalJson);
    const captured = yield* Effect.fromResult(capturePrivateJsonData(row, lifetime.remainingBytes(), commerceError));
    if (!isJsonObject(captured.value)) return yield* Effect.fail(commerceError("storedCorruption"));
    yield* Effect.fromResult(lifetime.charge(captured.bytes + keyBytes.byteLength));
    work.observations.push(Object.freeze({ tableId: capability.tableId, keyBytes, operation, changed, row: captured.value }));
  });
  const record = Effect.fn("CommerceStore.record")(function* (row: JsonObject, operation: RelationalRowFact["operation"], observedOperation: CommerceRowObservation["operation"] = operation) {
    const value = row[key.identity.columnId];
    if (typeof value !== "string" || value.length === 0) return yield* Effect.fail(commerceError("storedCorruption"));
    if (facts.length >= resources.facts) return yield* Effect.fail(commerceError("limitExceeded"));
    const encoded = yield* captureRelationalRowKey(state.descriptor.layout, table.identity.tableId, row, capability.keyId)
      .pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
    const keyBytes = new TextEncoder().encode(encoded.canonicalJson);
    yield* Effect.fromResult(lifetime.charge(keyBytes.byteLength));
    facts.push(Object.freeze({ codecVersion: primary.kind === "primary" ? 1 : 2, tableId: table.identity.tableId, keyBytes, operation }));
    yield* observe(row, observedOperation, true);
  });
  const captureWriteRows = Effect.fn("CommerceStore.captureWriteRows")(function* (input: unknown, updating: boolean) {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), commerceError));
    if (!representable(captured.value) || !Array.isArray(captured.value) || captured.value.length > resources.catalogRows)
      return yield* Effect.fail(invalid());
    yield* Effect.fromResult(lifetime.charge(captured.bytes));
    const catalog = yield* catalogBound();
    const inputs: { readonly identity: string; readonly fields: readonly RelationalPhysicalColumn[]; readonly parameters: readonly SQL[]; readonly predicate: SQL }[] = [];
    const inputKeys = new Set<string>();
    for (const row of captured.value) {
      if (!isJsonObject(row)) return yield* Effect.fail(invalid());
      const capturedKey = yield* captureRelationalRowKey(state.descriptor.layout, table.identity.tableId, row, capability.keyId)
        .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      if (inputKeys.has(capturedKey.canonicalJson)) return yield* Effect.fail(invalid());
      inputKeys.add(capturedKey.canonicalJson);
      const fields: RelationalPhysicalColumn[] = [];
      const parameters: SQL[] = [];
      for (const name of Object.keys(row).toSorted()) {
        const field = yield* Effect.fromResult(column(name));
        if (updating && protectedUpdates.has(field.name)) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const value = row[name];
        if (value === undefined) return yield* Effect.fail(invalid());
        const member = updating ? (yield* Effect.fromResult(capturePrivateJsonData(value, commerceLimits.rowBytes, commerceError))).value : value;
        fields.push(field); parameters.push(yield* Effect.fromResult(parameter(field, member)));
      }
      const comparisons = keyColumns.map(field => sql`${sql.identifier(field.name)} = ${row[field.identity.columnId]}`);
      inputs.push({ identity: capturedKey.canonicalJson, fields, parameters, predicate: sql`(${sql.join(comparisons, sql` and `)})` });
    }
    return { inputs, catalog };
  });
  const rowJson = (changed: boolean, transport: boolean) => sql`jsonb_build_object(${sql.join(table.columns.flatMap(field => {
    const value = changed ? sql`changed.${sql.identifier(field.identity.columnId)}` : sql`${sql.identifier(field.name)}`;
    // jsonb's numeric parser would otherwise lose exact PostgreSQL numeric text.
    return [sql`${field.identity.columnId}::text`, transport && field.type === "numeric" ? sql`${value}::text` : value];
  }), sql`, `)})`;
  const writeAdmittedRows = Effect.fn("CommerceStore.writeAdmittedRows")(function* (input: unknown, mode: "insert" | "update" | "upsert") {
    const updating = mode === "update";
    const upserting = mode === "upsert";
    const captured = yield* captureWriteRows(input, updating || upserting);
    const { inputs } = captured;
    if (inputs.length === 0) return [];
    let catalog = captured.catalog;
    const groups = new Map<string, typeof inputs>();
    for (const row of inputs) {
      const identity = JSON.stringify(row.fields.map(field => field.name));
      const group = groups.get(identity) ?? [];
      group.push(row); groups.set(identity, group);
    }
    const output = new Map<string, JsonObject>();
    const changedKeys = new Set<string>();
    const existingKeys = new Set<string>();
    for (const entireGroup of groups.values()) {
      for (let offset = 0; offset < entireGroup.length; offset += resources.writeBatchRows) {
        const group = entireGroup.slice(offset, offset + resources.writeBatchRows);
        const first = group[0];
        if (first === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
        const selected = sql`(${sql.join(group.map(row => row.predicate), sql` or `)})`;
        if (upserting) {
          // The admitted root already holds the scope write lock. Classify facts
          // from this same transaction, never from an adapter existence check.
          const prior = yield* queryRows(sql`select ${sql.join(keyColumns.map(field => sql`${sql.identifier(field.name)} as ${sql.identifier(field.identity.columnId)}`), sql`, `)} from ${target} where ${scoped} and ${selected} for update`);
          for (const row of prior) {
            const encoded = yield* captureRelationalRowKey(state.descriptor.layout, capability.tableId, row, capability.keyId)
              .pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
            existingKeys.add(encoded.canonicalJson);
          }
        }
        const updates = first.fields.flatMap(field => keyColumns.includes(field) || managedUpdates.includes(field.name) ? [] :
          [sql`${sql.identifier(field.name)} = incoming.${sql.identifier(field.name)}`]);
        for (const name of managedUpdates) updates.push(sql`${sql.identifier(name)} = current_timestamp`);
        const noOp = updating && updates.length === 0;
        let written: readonly JsonObject[];
        if (noOp) {
          // Preserve a key-only update on a table without managed timestamps as a
          // read of the existing row, with no mutation or change fact.
          written = yield* queryRows(sql`select ${returning} from ${target} where ${scoped} and ${selected} limit ${resources.catalogRows}`);
        } else {
          const qualifiedReturning = sql.join(table.columns.map(field => sql`stored.${sql.identifier(field.name)} as ${sql.identifier(field.identity.columnId)}`), sql`, `);
          const deletion = layout.requiredPhysicalCapabilities.find(item => item.kind === "softDelete" && item.deletedAtColumn.identity.tableId === capability.tableId);
          if (upserting && deletion?.kind !== "softDelete") return yield* Effect.fail(commerceError("unsupportedProfile"));
          const conflictUpdates = first.fields.filter(field => !keyColumns.includes(field)).map(field => sql`${sql.identifier(field.name)} = excluded.${sql.identifier(field.name)}`);
          if (upserting && deletion?.kind === "softDelete") conflictUpdates.push(sql`${sql.identifier(deletion.deletedAtColumn.columnName)} = null`);
          const conflict = upserting ? sql`on conflict (${sql.join(primary.columns.map(name => sql.identifier(name)), sql`, `)}) do update set ${sql.join(conflictUpdates, sql`, `)}` : sql``;
          const mutation = updating
            ? sql`update ${target} as stored set ${sql.join(updates, sql`, `)} from (values ${sql.join(group.map(row => sql`(${sql.join([...row.parameters], sql`, `)})`), sql`, `)}) as incoming (${sql.join(first.fields.map(field => sql.identifier(field.name)), sql`, `)}) where stored.scope_uuid = ${scope.scopeUuid}::uuid and ${sql.join(keyColumns.map(field => sql`stored.${sql.identifier(field.name)} = incoming.${sql.identifier(field.name)}`), sql` and `)} returning ${qualifiedReturning}`
            : sql`insert into ${target} (${sql.identifier("scope_uuid")}, ${sql.join(first.fields.map(field => sql.identifier(field.name)), sql`, `)}) values ${sql.join(group.map(row => sql`(${scope.scopeUuid}::uuid, ${sql.join([...row.parameters], sql`, `)})`), sql`, `)} ${conflict} returning ${returning}`;
          // All subqueries share one snapshot. Remove the selected pre-write rows
          // from that snapshot and add RETURNING rows to measure the actual
          // post-write catalog. No base-table reread pretends to observe the CTE.
          const remainingBytes = lifetime.remainingBytes();
          const raw = yield* driverRows(yield* statement(state.tx.execute(commerceWriteEnvelope({ mutation,
            retainedCatalog: sql`select ${rowJson(false, false)} as payload from ${target} where ${scoped} and not ${selected}`,
            writtenCatalogPayload: rowJson(true, false), writtenTransportPayload: rowJson(true, true), remainingBytes,
          }))));
          if (raw?.length !== 1) return yield* Effect.fail(commerceError("storedCorruption"));
          const envelope = yield* Effect.fromResult(decodeCommerceWriteEnvelope(raw[0], remainingBytes));
          catalog = { total: envelope.total, maximum: envelope.maximum, bytes: envelope.bytes };
          written = yield* decodeRows(envelope.rows);
        }
        if (written.length !== group.length) return yield* Effect.fail(commerceError(updating ? "invalidInput" : "receiptMismatch"));
        const expected = new Set(group.map(row => row.identity));
        for (const row of written) {
          if (Object.keys(row).length !== table.columns.length) return yield* Effect.fail(commerceError("receiptMismatch"));
          const encoded = yield* captureRelationalRowKey(state.descriptor.layout, table.identity.tableId, row, capability.keyId)
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (!expected.delete(encoded.canonicalJson) || output.has(encoded.canonicalJson)) return yield* Effect.fail(commerceError("receiptMismatch"));
          output.set(encoded.canonicalJson, row);
          if (!noOp) changedKeys.add(encoded.canonicalJson);
        }
        if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    // Hydration spent bytes but made no database change. Reuse only this
    // operation's last catalog measurement and compare the current budget.
    if (updating || upserting) yield* Effect.fromResult(checkCommerceCatalogSize(catalog, lifetime.remainingBytes()));
    const ordered: JsonObject[] = [];
    for (const inputRow of inputs) {
      const row = output.get(inputRow.identity);
      if (row === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (changedKeys.has(inputRow.identity)) yield* record(row, updating || existingKeys.has(inputRow.identity) ? "update" : "insert");
      else yield* observe(row, "update", false);
      ordered.push(row);
    }
    return Object.freeze(ordered);
  });
  const write: CommerceStore["write"] = Effect.fn("CommerceStore.write")((context, mode, input) => guard(context, "write", Effect.gen(function* () {
    if (capability.mode !== "scalar") {
      if (mode === "insert" || (mode === "upsert" && capability.upsert === "activeRow")) return yield* writeAdmittedRows(input, mode);
      if (capability.mode !== "readInsertUpdate" || mode !== "update") return yield* Effect.fail(commerceError("unsupportedProfile"));
      return yield* writeAdmittedRows(input, "update");
    }
    if (!["insert", "upsert", "update"].includes(mode)) return yield* Effect.fail(invalid());
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), commerceError));
    if (!representable(captured.value)) return yield* Effect.fail(invalid());
    if (!Array.isArray(captured.value) || captured.value.length > resources.catalogRows) return yield* Effect.fail(invalid());
    yield* Effect.fromResult(lifetime.charge(captured.bytes));
    yield* catalogBound();
    if (captured.value.length === 0) return [];
    const inputs: { readonly key: string; readonly fields: readonly RelationalPhysicalColumn[]; readonly parameters: readonly SQL[] }[] = [];
    const uniqueKeys = new Set<string>();
    for (const inputRow of captured.value) {
      if (!isNonArrayRecord(inputRow)) return yield* Effect.fail(invalid());
      const keyValue = inputRow[key.identity.columnId];
      if (typeof keyValue !== "string" || keyValue.length === 0 || uniqueKeys.has(keyValue)) return yield* Effect.fail(invalid());
      uniqueKeys.add(keyValue);
      const fields: RelationalPhysicalColumn[] = [];
      const parameters: SQL[] = [];
      for (const name of Object.keys(inputRow).toSorted()) {
        const field = yield* Effect.fromResult(column(name));
        const member = yield* Effect.fromResult(capturePrivateJsonData(inputRow[name], commerceLimits.rowBytes, commerceError));
        fields.push(field); parameters.push(yield* Effect.fromResult(parameter(field, member.value)));
      }
      inputs.push({ key: keyValue, fields, parameters });
    }
    const before = yield* queryRows(sql`select ${returning} from ${target} where ${scoped} and ${sql.identifier(key.name)} in (${sql.join(inputs.map(row => sql`${row.key}`), sql`, `)}) limit ${resources.catalogRows}`);
    const existing = new Map(before.map(row => [row[key.identity.columnId], row]));
    if (existing.size !== before.length || (mode === "insert" && before.length !== 0)) return yield* Effect.fail(commerceError("storedCorruption"));
    const groups = new Map<string, typeof inputs>();
    for (const row of inputs) {
      if (mode === "update" && !existing.has(row.key)) continue;
      const groupKey = `${existing.has(row.key) ? "update" : "insert"}:${row.fields.map(field => field.name).join(",")}`;
      const group = groups.get(groupKey) ?? [];
      group.push(row); groups.set(groupKey, group);
    }
    const output = new Map<string, JsonObject>();
    for (const group of groups.values()) {
      const first = group[0];
      if (first === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
      const inserting = !existing.has(first.key);
      let query: SQL;
      if (inserting) {
        query = sql`insert into ${target} (${sql.identifier("scope_uuid")}, ${sql.join(first.fields.map(field => sql.identifier(field.name)), sql`, `)}) values ${sql.join(group.map(row => sql`(${scope.scopeUuid}::uuid, ${sql.join([...row.parameters], sql`, `)})`), sql`, `)} returning ${sql.identifier(key.name)} as ${sql.identifier(key.identity.columnId)}`;
      } else {
        const updates = first.fields.flatMap(field => field.name === key.name || managedUpdates.includes(field.name) ? [] :
          [sql`${sql.identifier(field.name)} = ${sql.identifier("incoming")}.${sql.identifier(field.name)}`]);
        for (const name of managedUpdates) updates.push(sql`${sql.identifier(name)} = current_timestamp`);
        if (updates.length === 0) {
          for (const row of group) { const retained = existing.get(row.key); if (retained !== undefined) output.set(row.key, retained); }
          continue;
        }
        const qualifiedReturning = sql`stored.${sql.identifier(key.name)} as ${sql.identifier(key.identity.columnId)}`;
        query = sql`update ${target} as stored set ${sql.join(updates, sql`, `)} from (values ${sql.join(group.map(row => sql`(${sql.join([...row.parameters], sql`, `)})`), sql`, `)}) as incoming (${sql.join(first.fields.map(field => sql.identifier(field.name)), sql`, `)}) where stored.scope_uuid = ${scope.scopeUuid}::uuid and stored.${sql.identifier(key.name)} = incoming.${sql.identifier(key.name)} returning ${qualifiedReturning}`;
      }
      const identities = yield* queryRows(query);
      if (identities.length !== group.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      // SQL defaults and numeric expansion can enlarge a short input. Return
      // identities first; bound the stored catalog before hydrating new values.
      yield* catalogBound();
      const written = yield* queryRows(sql`select ${returning} from ${target} where ${scoped} and ${sql.identifier(key.name)} in (${sql.join(group.map(row => sql`${row.key}`), sql`, `)}) limit ${resources.catalogRows}`);
      if (written.length !== group.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const row of written) {
        const value = row[key.identity.columnId];
        if (typeof value !== "string" || output.has(value) || !group.some(inputRow => inputRow.key === value)) return yield* Effect.fail(commerceError("receiptMismatch"));
        output.set(value, row);
      }
    }
    yield* catalogBound();
    const ordered: JsonObject[] = [];
    for (const inputRow of inputs) {
      const row = output.get(inputRow.key);
      if (row === undefined) continue;
      if (row !== existing.get(inputRow.key)) yield* record(row, existing.has(inputRow.key) ? "update" : "insert");
      ordered.push(row);
    }
    return Object.freeze(ordered);
  })));
  const remove: CommerceStore["delete"] = Effect.fn("CommerceStore.delete")((context, input) => guard(context, "write", Effect.gen(function* () {
    if (capability.remove === "declaredKey") {
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), commerceError));
      if (!representable(captured.value) || !Array.isArray(captured.value) || captured.value.length > resources.catalogRows) return yield* Effect.fail(invalid());
      if (captured.value.length > resources.writeBatchRows) return yield* Effect.fail(commerceError("limitExceeded"));
      yield* Effect.fromResult(lifetime.charge(captured.bytes));
      if (captured.value.length === 0) return [];
      yield* catalogBound();
      const identities = new Set<string>();
      const predicates: SQL[] = [];
      for (const row of captured.value) {
        if (!isJsonObject(row) || Object.keys(row).length !== keyColumns.length || Object.keys(row).some(name => !keyColumns.some(field => field.identity.columnId === name)))
          return yield* Effect.fail(invalid());
        const encoded = yield* captureRelationalRowKey(state.descriptor.layout, capability.tableId, row, capability.keyId)
          .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
        if (identities.has(encoded.canonicalJson)) return yield* Effect.fail(invalid());
        identities.add(encoded.canonicalJson);
        predicates.push(sql`(${sql.join(keyColumns.map(field => sql`${sql.identifier(field.name)} = ${row[field.identity.columnId]}`), sql` and `)})`);
      }
      const selected = sql`${scoped} and (${sql.join(predicates, sql` or `)})`;
      const locked = yield* queryRows(sql`select ${returning} from ${target} where ${selected} for update`);
      if (locked.length !== identities.size) return yield* Effect.fail(commerceError("receiptMismatch"));
      // Explicit child-first removal keeps FK cascades from erasing unobserved
      // rows. Inspect all captured dependencies, not only admitted stores.
      const dependencies: SQL[] = [];
      for (const fk of layout.foreignKeys) {
        if (fk.kind !== "foreignKey" || fk.targetTable.tableId !== capability.tableId || fk.onDelete !== "cascade") continue;
        const dependent = layout.tables.find(candidate => candidate.identity.tableId === fk.sourceTable.tableId);
        if (dependent === undefined || fk.sourceColumns.length !== fk.targetColumns.length) return yield* Effect.fail(commerceError("storedCorruption"));
        const comparisons: SQL[] = [];
        for (const [index, name] of fk.sourceColumns.entries()) {
          const targetName = fk.targetColumns[index];
          if (targetName === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          comparisons.push(sql`child.${sql.identifier(name)} = parent.${sql.identifier(targetName)}`);
        }
        dependencies.push(sql`exists(select 1 from ${sql.identifier(layout.targetNamespace.schemaName)}.${sql.identifier(dependent.name)} as child
          where exists(select 1 from (select * from ${target} where ${selected}) as parent where ${sql.join(comparisons, sql` and `)}))`);
      }
      if (dependencies.length) {
        const checks = yield* driverRows(yield* statement(state.tx.execute(sql`select (${sql.join(dependencies, sql` or `)}) as present`)));
        if (checks?.length !== 1 || !isNonArrayRecord(checks[0]) || typeof checks[0].present !== "boolean") return yield* Effect.fail(commerceError("storedCorruption"));
        if (checks[0].present) return yield* Effect.fail(commerceError("unsupportedProfile"));
      }
      const removed = yield* queryRows(sql`delete from ${target} where ${selected} returning ${returning}`);
      const observed = new Set<string>();
      for (const row of removed) {
        const encoded = yield* captureRelationalRowKey(state.descriptor.layout, capability.tableId, row, capability.keyId)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (!identities.has(encoded.canonicalJson) || observed.has(encoded.canonicalJson)) return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.add(encoded.canonicalJson);
        yield* record(row, "delete");
      }
      if (observed.size !== identities.size) return yield* Effect.fail(commerceError("receiptMismatch"));
      return removed;
    }
    if (capability.mode !== "scalar") return yield* Effect.fail(commerceError("unsupportedProfile"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), commerceError));
    if (!representable(captured.value)) return yield* Effect.fail(invalid());
    if (!Array.isArray(captured.value) || captured.value.length > resources.catalogRows || captured.value.some(value => !isPrivateValueText(value) || value.length === 0)) return yield* Effect.fail(invalid());
    yield* Effect.fromResult(lifetime.charge(captured.bytes));
    yield* catalogBound();
    if (captured.value.length === 0) return [];
    const deleted = yield* queryRows(sql`delete from ${target} where ${scoped} and ${sql.identifier(key.name)} in (${sql.join(captured.value.map(value => sql`${value}`), sql`, `)}) returning ${returning}`);
    for (const row of deleted.toSorted((a, b) => String(a[key.identity.columnId]).localeCompare(String(b[key.identity.columnId])))) yield* record(row, "delete");
    return deleted;
  })));
  const lifecycle: CommerceStore["lifecycle"] = Effect.fn("CommerceStore.lifecycle")((context, operation, input) => guard(context, "write", Effect.gen(function* () {
    if (capability.lifecycle !== "managedSoftDelete" || (operation !== "softDelete" && operation !== "restore")) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const deletion = layout.requiredPhysicalCapabilities.find(item => item.kind === "softDelete" && item.deletedAtColumn.identity.tableId === capability.tableId);
    if (deletion?.kind !== "softDelete" || managedUpdates.length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const deleted = table.columns.find(field => field.name === deletion.deletedAtColumn.columnName);
    if (deleted === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
    const { inputs, catalog } = yield* captureWriteRows(input, true);
    if (inputs.length > resources.writeBatchRows) return yield* Effect.fail(commerceError("limitExceeded"));
    if (inputs.some(row => row.fields.length !== keyColumns.length || row.fields.some(field => !keyColumns.includes(field)))) return yield* Effect.fail(invalid());
    if (inputs.length === 0) return [];
    const selected = sql`(${sql.join(inputs.map(row => row.predicate), sql` or `)})`;
    // The existing request scope lock excludes other admitted writers; row locks
    // also retain the observed deletion state until this transaction settles.
    const before = yield* queryRows(sql`select ${returning} from ${target} where ${scoped} and ${selected} for update`);
    if (before.length !== inputs.length) return yield* Effect.fail(invalid());
    const priorByKey = new Map<string, JsonObject>();
    for (const row of before) {
      const encoded = yield* captureRelationalRowKey(state.descriptor.layout, capability.tableId, row, capability.keyId)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (priorByKey.has(encoded.canonicalJson)) return yield* Effect.fail(commerceError("receiptMismatch"));
      priorByKey.set(encoded.canonicalJson, row);
    }
    const unchanged = operation === "restore" ? before.filter(row => row[deleted.identity.columnId] === null) : [];
    let written: readonly JsonObject[] = [];
    if (unchanged.length !== inputs.length) {
      const transition = operation === "restore" ? sql`(${selected} and ${sql.identifier(deleted.name)} is not null)` : selected;
      const remainingBytes = lifetime.remainingBytes();
      const raw = yield* driverRows(yield* statement(state.tx.execute(commerceWriteEnvelope({
        mutation: sql`update ${target} set ${sql.identifier(deleted.name)} = ${operation === "restore" ? sql`null` : sql`current_timestamp`}, ${sql.join(managedUpdates.map(name => sql`${sql.identifier(name)} = current_timestamp`), sql`, `)} where ${scoped} and ${transition} returning ${returning}`,
        retainedCatalog: sql`select ${rowJson(false, false)} as payload from ${target} where ${scoped} and not ${transition}`,
        writtenCatalogPayload: rowJson(true, false), writtenTransportPayload: rowJson(true, true), remainingBytes,
      }))));
      if (raw?.length !== 1) return yield* Effect.fail(commerceError("storedCorruption"));
      const envelope = yield* Effect.fromResult(decodeCommerceWriteEnvelope(raw[0], remainingBytes));
      written = yield* decodeRows(envelope.rows);
      yield* Effect.fromResult(checkCommerceCatalogSize(envelope, lifetime.remainingBytes()));
    } else yield* Effect.fromResult(checkCommerceCatalogSize(catalog, lifetime.remainingBytes()));
    if (written.length + unchanged.length !== inputs.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set(inputs.map(row => row.identity));
    const ordered = new Map<string, JsonObject>();
    for (const row of [...written, ...unchanged]) {
      const encoded = yield* captureRelationalRowKey(state.descriptor.layout, capability.tableId, row, capability.keyId)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const prior = priorByKey.get(encoded.canonicalJson);
      const previous = prior?.[deleted.identity.columnId];
      const next = row[deleted.identity.columnId];
      if (!expected.delete(encoded.canonicalJson) || Object.keys(row).length !== table.columns.length ||
        (previous !== null && typeof previous !== "string") || (next !== null && typeof next !== "string") ||
        (operation === "restore" ? next !== null : next === null)) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (operation === "restore" && previous === null) yield* observe(row, operation, false);
      else yield* record(row, "update", operation);
      const keyBytes = new TextEncoder().encode(encoded.canonicalJson);
      yield* Effect.fromResult(lifetime.charge(keyBytes.byteLength + (previous?.length ?? 0) + (next?.length ?? 0)));
      work.lifecycle.push(Object.freeze({ tableId: capability.tableId, keyBytes, operation,
        beforeDeletedAt: previous, afterDeletedAt: next }));
      ordered.set(encoded.canonicalJson, row);
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const result: JsonObject[] = [];
    for (const row of inputs) {
      const value = ordered.get(row.identity);
      if (value === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      result.push(value);
    }
    return Object.freeze(result);
  })));
  return Object.freeze({ find, count, write, delete: remove, lifecycle } satisfies CommerceStore);
});

export const consumeCommerceRows = Effect.fn("CommerceStore.consume")(function* (
  closure: CommerceRowClosure, admission: CommerceAdmission, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const state = closures.get(closure);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime || !lifetime.isClosing()) return yield* Effect.fail(commerceError("receiptMismatch"));
  closures.delete(closure);
  return state.facts;
});
