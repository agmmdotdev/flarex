import { sql, type SQL } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { captureRelationalData } from "./data";
import { isNonArrayRecord } from "@flarex/utils/records";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { RelationalPhysicalTable } from "../relationalSchema/physical/model";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import {
  guardRelationalOperation,
  requireRelationalLifetime,
} from "./lifetime";
import type { RelationalLifetime } from "./lifetime";
import { relationalError, relationalLimits } from "./model";
import type {
  RelationalStore,
  RelationalTable,
  RelationalTransaction,
  ScalarRow,
  RelationalTransactionError,
} from "./model";

const tables = new WeakMap<
  object,
  Readonly<{ state: RelationalLifetime; table: RelationalPhysicalTable }>
>();
const getTable: RelationalStore["table"] = Effect.fn("RelationalStore.table")(
  (token, identity) =>
    guardRelationalOperation(token, (state) =>
      Effect.gen(function* () {
        const physical = state.tables.find((value) =>
          sameBindingValue(value.identity, identity),
        );
        if (physical === undefined)
          return yield* Effect.fail(relationalError("invalidAuthority"));
        // SAFETY: table authority is bound to its exact transaction state in this WeakMap.
        const handle = Object.freeze({}) as RelationalTable;
        tables.set(handle, Object.freeze({ state, table: physical }));
        state.onClose.push(() => {
          tables.delete(handle);
        });
        return handle;
      }),
    ),
);
const claim = Effect.fn("RelationalStore.claim")(function* (
  state: RelationalLifetime,
  handle: RelationalTable,
) {
  const entry = tables.get(handle);
  if (entry?.state !== state)
    return yield* Effect.fail(relationalError("invalidAuthority"));
  return entry.table;
});
const capture = Effect.fn("RelationalStore.capture")(function* (
  state: RelationalLifetime,
  table: RelationalPhysicalTable,
  suppliedInput: ScalarRow,
  complete: boolean,
) {
  const captured = yield* Effect.fromResult(
    captureRelationalData(suppliedInput, relationalLimits.rowBytes),
  );
  const input = captured.value;
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return yield* Effect.fail(relationalError("invalidInput"));
  const result: Record<string, string | number | null> = {};
  const keys = Reflect.ownKeys(input);
  if (keys.length === 0 || keys.length > table.columns.length)
    return yield* Effect.fail(relationalError("invalidInput"));
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    const column = table.columns.find(
      (value) => value.identity.columnId === key,
    );
    const value: unknown =
      descriptor !== undefined && "value" in descriptor
        ? descriptor.value
        : undefined;
    if (
      typeof key !== "string" ||
      column === undefined ||
      descriptor?.enumerable !== true ||
      !validScalar(column.type, column.nullable, value) ||
      (!complete && column.name === primaryName(table))
    )
      return yield* Effect.fail(relationalError("invalidInput"));
    // validScalar narrows the storage value; identifiers are authenticated columns.
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      value === null
    )
      Object.defineProperty(result, key, { value, enumerable: true });
  }
  if (complete && keys.length !== table.columns.length)
    return yield* Effect.fail(relationalError("invalidInput"));
  yield* charge(state, result, relationalLimits.rowBytes);
  return Object.freeze(result);
});
function validScalar(
  type: string,
  nullable: boolean,
  value: unknown,
): value is string | number | null {
  return value === null
    ? nullable
    : type === "text"
      ? isSqlText(value)
      : typeof value === "number" &&
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647;
}
/** Reject text that UTF-8 transport would alter, while preserving empty strings. */
function isSqlText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    !/[\uD800-\uDFFF]/u.test(value)
  );
}
function primaryName(table: RelationalPhysicalTable): string {
  const name = table.keys.find((key) => key.kind === "primary")?.columns[1];
  if (name === undefined)
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - lifetime admission already proved exactly one scoped text primary key.
    throw new Error("Admitted scalar table lost its primary key");
  return name;
}
function physicalTable(
  state: RelationalLifetime,
  table: RelationalPhysicalTable,
): SQL {
  return sql`${sql.identifier(state.admission.installation.plan.plan.physicalLayout.frame.targetNamespace.schemaName)}.${sql.identifier(table.name)}`;
}
function scoped(state: RelationalLifetime): SQL {
  return sql`${sql.identifier("scope_uuid")} = ${state.scopeUuid}::uuid`;
}
const keyPredicate = Effect.fn("RelationalStore.key")(function* (
  state: RelationalLifetime,
  table: RelationalPhysicalTable,
  key: string,
) {
  if (!isSqlText(key))
    return yield* Effect.fail(relationalError("invalidInput"));
  yield* charge(state, key, relationalLimits.rowBytes);
  return sql`${scoped(state)} and ${sql.identifier(primaryName(table))} = ${key}`;
});
const charge = Effect.fn("RelationalStore.charge")(function* (
  state: RelationalLifetime,
  value: unknown,
  maximum: number,
) {
  const measured = measureCanonicalJsonUtf8Bytes(value, maximum);
  if (measured.kind !== "success")
    return yield* Effect.fail(
      relationalError(
        measured.kind === "exceeded" ? "limitExceeded" : "invalidInput",
      ),
    );
  state.bytes += measured.bytes;
  if (state.bytes > relationalLimits.commandBytes)
    return yield* Effect.fail(relationalError("limitExceeded"));
});

/** CASE prevents oversized text from crossing the driver boundary, including RETURNING. */
function projection(table: RelationalPhysicalTable): SQL {
  const pairs = table.columns.flatMap((column) => [
    sql`${column.identity.columnId}::text`,
    sql`${sql.identifier(column.name)}`,
  ]);
  const json = sql`jsonb_build_object(${sql.join(pairs, sql`, `)})`;
  return sql`case when octet_length((${json})::text) <= ${relationalLimits.rowBytes} then ${json} else null end as row`;
}
const execute = Effect.fn("RelationalStore.execute")(function* (
  state: RelationalLifetime,
  table: RelationalPhysicalTable,
  query: SQL,
): Effect.fn.Return<readonly ScalarRow[], RelationalTransactionError> {
  const remaining = state.expiresAt - (yield* Clock.currentTimeMillis);
  if (remaining <= 0)
    return yield* Effect.fail(relationalError("deadlineExceeded"));
  yield* runDrizzleStatementEffect(
    state.tx.execute(
      sql`select set_config('statement_timeout', ${`${Math.min(remaining, relationalLimits.statementMs)}ms`}, true)`,
    ),
    (cause) => relationalError("statementFailure", cause),
  );
  const result: unknown = yield* runDrizzleStatementEffect(
    state.tx.execute(query),
    (cause) => relationalError("statementFailure", cause),
  );
  const rows = yield* Effect.try({
    try: () =>
      rowsFromDriverExecuteResult(result, () => {
        // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: compatibility - the owned driver wrapper decoder requires a throwing invalid-result callback, caught by this narrow adapter.
        throw new Error("Invalid Drizzle execute wrapper");
      }),
    catch: (cause) => relationalError("statementFailure", cause),
  });
  if (rows.length > relationalLimits.page + 1)
    return yield* Effect.fail(relationalError("limitExceeded"));
  const output: ScalarRow[] = [];
  for (const entry of rows) {
    const row: unknown =
      typeof entry === "object" && entry !== null
        ? Reflect.get(entry, "row")
        : undefined;
    if (row === null)
      return yield* Effect.fail(relationalError("limitExceeded"));
    if (
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row) ||
      Object.keys(row).length !== table.columns.length
    )
      return yield* Effect.fail(relationalError("statementFailure"));
    const owned: Record<string, string | number | null> = {};
    for (const column of table.columns) {
      const value: unknown = Reflect.get(row, column.identity.columnId);
      if (!validScalar(column.type, column.nullable, value))
        return yield* Effect.fail(relationalError("statementFailure"));
      Object.defineProperty(owned, column.identity.columnId, {
        value,
        enumerable: true,
      });
    }
    yield* charge(state, owned, relationalLimits.rowBytes);
    state.returnedRows += 1;
    if (state.returnedRows > relationalLimits.rows)
      return yield* Effect.fail(relationalError("limitExceeded"));
    output.push(Object.freeze(owned));
  }
  return Object.freeze(output);
});
const get: RelationalStore["get"] = Effect.fn("RelationalStore.get")(
  (token, handle, key) =>
    guardRelationalOperation(token, (state) =>
      Effect.gen(function* () {
        const table = yield* claim(state, handle);
        const where = yield* keyPredicate(state, table, key);
        return Option.fromNullishOr(
          (yield* execute(
            state,
            table,
            sql`select ${projection(table)} from ${physicalTable(state, table)} where ${where}`,
          ))[0],
        );
      }),
    ),
);
const list: RelationalStore["list"] = Effect.fn("RelationalStore.list")(
  (token, handle, suppliedInput) =>
    guardRelationalOperation(token, (state) =>
      Effect.gen(function* () {
        const table = yield* claim(state, handle);
        const captured = yield* Effect.fromResult(
          captureRelationalData(suppliedInput, relationalLimits.rowBytes),
        );
        state.bytes += captured.bytes;
        if (state.bytes > relationalLimits.commandBytes)
          return yield* Effect.fail(relationalError("limitExceeded"));
        const input = captured.value;
        if (
          !isNonArrayRecord(input) ||
          typeof input.limit !== "number" ||
          !Number.isInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > relationalLimits.page ||
          Object.keys(input).some(
            (key) => !["limit", "after", "equal"].includes(key),
          )
        )
          return yield* Effect.fail(relationalError("invalidInput"));
        let where = scoped(state);
        if (input.after !== undefined) {
          if (!isSqlText(input.after))
            return yield* Effect.fail(relationalError("invalidInput"));
          yield* charge(state, input.after, relationalLimits.rowBytes);
          where = sql`${where} and ${sql.identifier(primaryName(table))} > ${input.after}`;
        }
        if (input.equal !== undefined) {
          if (
            !isNonArrayRecord(input.equal) ||
            Object.keys(input.equal).length !== 2 ||
            !Object.hasOwn(input.equal, "column") ||
            !Object.hasOwn(input.equal, "value")
          )
            return yield* Effect.fail(relationalError("invalidInput"));
          const equal = input.equal;
          const column = table.columns.find(
            (value) => value.identity.columnId === equal.column,
          );
          if (
            column === undefined ||
            !validScalar(column.type, column.nullable, input.equal.value)
          )
            return yield* Effect.fail(relationalError("invalidInput"));
          yield* charge(state, input.equal, relationalLimits.rowBytes);
          where =
            input.equal.value === null
              ? sql`${where} and ${sql.identifier(column.name)} is null`
              : sql`${where} and ${sql.identifier(column.name)} = ${input.equal.value}`;
        }
        const rows = yield* execute(
          state,
          table,
          sql`select ${projection(table)} from ${physicalTable(state, table)} where ${where} order by ${sql.identifier(primaryName(table))} asc limit ${input.limit + 1}`,
        );
        const page = rows.slice(0, input.limit);
        const primaryId = table.columns.find(
          (column) => column.name === primaryName(table),
        )?.identity.columnId;
        const last =
          primaryId === undefined ? undefined : page.at(-1)?.[primaryId];
        return Object.freeze({
          rows: Object.freeze(page),
          next:
            rows.length > input.limit && typeof last === "string"
              ? Option.some(last)
              : Option.none(),
        });
      }),
    ),
);
const insert: RelationalStore["insert"] = Effect.fn("RelationalStore.insert")(
  (token, handle, input) =>
    guardRelationalOperation(token, (state) =>
      Effect.gen(function* () {
        const table = yield* claim(state, handle);
        const row = yield* capture(state, table, input, true);
        state.mutationAttempted = true;
        const columns = [
          sql.identifier("scope_uuid"),
          ...table.columns.map((column) => sql.identifier(column.name)),
        ];
        const values = [
          sql`${state.scopeUuid}::uuid`,
          ...table.columns.map(
            (column) => sql`${row[column.identity.columnId]}`,
          ),
        ];
        const result = (yield* execute(
          state,
          table,
          sql`insert into ${physicalTable(state, table)} (${sql.join(columns, sql`, `)}) values (${sql.join(values, sql`, `)}) returning ${projection(table)}`,
        ))[0];
        if (result === undefined)
          return yield* Effect.fail(relationalError("statementFailure"));
        return result;
      }),
    ),
);
const update: RelationalStore["update"] = Effect.fn("RelationalStore.update")(
  (token, handle, key, input) =>
    guardRelationalOperation(token, (state) =>
      Effect.gen(function* () {
        const table = yield* claim(state, handle);
        const where = yield* keyPredicate(state, table, key);
        const row = yield* capture(state, table, input, false);
        const assignments = table.columns
          .filter((column) => Object.hasOwn(row, column.identity.columnId))
          .map(
            (column) =>
              sql`${sql.identifier(column.name)} = ${row[column.identity.columnId]}`,
          );
        state.mutationAttempted = true;
        return Option.fromNullishOr(
          (yield* execute(
            state,
            table,
            sql`update ${physicalTable(state, table)} set ${sql.join(assignments, sql`, `)} where ${where} returning ${projection(table)}`,
          ))[0],
        );
      }),
    ),
);
const remove: RelationalStore["delete"] = Effect.fn("RelationalStore.delete")(
  (token, handle, key) =>
    guardRelationalOperation(token, (state) =>
      Effect.gen(function* () {
        const table = yield* claim(state, handle);
        const where = yield* keyPredicate(state, table, key);
        state.mutationAttempted = true;
        return Option.fromNullishOr(
          (yield* execute(
            state,
            table,
            sql`delete from ${physicalTable(state, table)} where ${where} returning ${projection(table)}`,
          ))[0],
        );
      }),
    ),
);
export const relationalStore: RelationalStore = Object.freeze({
  table: getTable,
  get,
  list,
  insert,
  update,
  delete: remove,
});

/** The command-facing facade requires its own borrowed transaction, even if another token is still live. */
export function bindRelationalStore(
  token: RelationalTransaction,
): RelationalStore {
  const checked = Effect.fn("RelationalStore.boundCall")(
    <Value>(
      given: RelationalTransaction,
      work: Effect.Effect<Value, RelationalTransactionError>,
    ) =>
      given === token
        ? work
        : requireRelationalLifetime(token).pipe(
            Effect.flatMap((state) => {
              state.status = "rollbackOnly";
              return Effect.fail(relationalError("invalidAuthority"));
            }),
          ),
  );
  const bound: RelationalStore = {
    table: (given, identity) => checked(given, getTable(given, identity)),
    get: (given, handle, key) => checked(given, get(given, handle, key)),
    list: (given, handle, input) => checked(given, list(given, handle, input)),
    insert: (given, handle, row) => checked(given, insert(given, handle, row)),
    update: (given, handle, key, row) =>
      checked(given, update(given, handle, key, row)),
    delete: (given, handle, key) => checked(given, remove(given, handle, key)),
  };
  return Object.freeze(bound);
}
