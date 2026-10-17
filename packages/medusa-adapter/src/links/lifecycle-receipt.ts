import { Effect, Result, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../schema/model";
import { compileCompleteRow } from "../value/complete-row";
import { commerceDecoder } from "../value/decoder";
import { projectNativeRow } from "../repository/result";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { QueryLimit } from "../query/decoder";
import type { prepareLinkRepository } from "./repository";

/** Authenticate a single generated Link family's complete endpoint lifecycle.
 * Native repositories retain selection/cascade authority; this reads only the
 * issued call evidence and correlates its complete rich rows and return map. */
export function compileLinkLifecycleReceipt(configuration: {
  readonly table: SchemaTable;
  readonly endpoints: readonly [string, string];
  readonly returnLinkableKeys: readonly string[];
  readonly softDeleteCommand: string;
  readonly restoreCommand: string;
  readonly maximumEndpoints: number;
  readonly maximumRows: number;
  readonly selectionPlan: Result.Result.Success<ReturnType<typeof prepareLinkRepository>>["lifecycleReadPlan"];
}) {
  return Result.gen(function* () {
    const complete = yield* compileCompleteRow(configuration.table);
    const [primary, foreign] = configuration.endpoints;
    const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
    const Ids = Schema.Array(Id).check(Schema.isMaxLength(configuration.maximumEndpoints));
    const decodeInput = commerceDecoder(Schema.Struct({
      selector: Schema.Union([Schema.Struct({ [primary]: Ids }), Schema.Struct({ [foreign]: Ids })]),
      config: Schema.Struct({ returnLinkableKeys: Schema.Array(Schema.String) }),
    }), "receiptMismatch");
    const decodeResult = commerceDecoder(Schema.Struct({
      [primary]: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(configuration.maximumRows))),
      [foreign]: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(configuration.maximumRows))),
    }), "receiptMismatch");
    const integer = commerceDecoder(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 })), "receiptMismatch");
    const decodeReadWindow = commerceDecoder(Schema.StructWithRest(Schema.Struct({ take: QueryLimit }),
      [Schema.Record(Schema.String, Schema.Json)]), "receiptMismatch");
    const decodeRow = (value: JsonObject) => complete(projectNativeRow(value)).pipe(Result.flatMap(row => Result.gen(function* () {
      for (const column of configuration.table.columns) if (column.type === "number") yield* integer(row[column.name]);
      if (typeof row.id !== "string" || typeof row[primary] !== "string" || typeof row[foreign] !== "string")
        return yield* Result.fail(commerceError("receiptMismatch"));
      return row;
    })));
    const identity = (row: JsonObject) => JSON.stringify([row[primary], row[foreign]]);
    const validate: LogicalCallReceiptValidation = Effect.fn("LinkReceipt.validateLifecycle")(function* (call, activity) {
      const mismatch = () => commerceError("receiptMismatch");
      const operation = call.commandName === configuration.softDeleteCommand ? "softDelete"
        : call.commandName === configuration.restoreCommand ? "restore" : undefined;
      if (operation === undefined || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeInput(call.input));
      if (!jsonEqual([...configuration.returnLinkableKeys], input.config.returnLinkableKeys)) return yield* Effect.fail(mismatch());
      const selector = Object.entries(input.selector)[0];
      if (selector === undefined) return yield* Effect.fail(mismatch());
      const [endpoint, ids] = selector, requested = new Set(ids);
      // Successful core-issued selection evidence authenticates absence as well
      // as rows. Use the executing DAL's planner and retain its resource window;
      // count/returned equality below proves that window contains the full set.
      const firstRead = activity.relationalReads[0];
      if (firstRead === undefined || activity.relationalReads.length !== 2) return yield* Effect.fail(mismatch());
      const window = yield* Effect.fromResult(decodeReadWindow(firstRead.query));
      const plan = yield* Effect.fromResult(configuration.selectionPlan(operation, input.selector, window.take))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (activity.relationalReads.some(read => read.table !== configuration.table.name || !jsonEqual(read.query, plan.query) ||
        read.total > configuration.maximumRows || read.returned !== read.total)) return yield* Effect.fail(mismatch());
      const observed = new Map<string, JsonObject>();
      const record = Effect.fn("LinkReceipt.observeLifecycleRow")(function* (table: string, value: JsonObject) {
        if (table !== configuration.table.name) return yield* Effect.fail(mismatch());
        const row = yield* Effect.fromResult(decodeRow(value)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        observed.set(identity(row), row);
      });
      for (const item of activity.observedRows) yield* record(item.table, item.row);
      for (const item of activity.lifecycle) if (item.rowAtOperation !== null) yield* record(item.table, item.rowAtOperation);
      const preimages = new Set<string>();
      for (const mutation of activity.mutations) {
        if (mutation.before === null) return yield* Effect.fail(mismatch());
        const key = identity(mutation.before);
        if (!preimages.has(key)) {
          preimages.add(key);
          yield* record(mutation.table, mutation.before);
        }
      }
      // An actual table/index access can observe additional candidate bodies.
      // Authenticate them above, then select only the native endpoint members.
      const members = [...observed].filter(([, row]) => typeof row[endpoint] === "string" && requested.has(row[endpoint]));
      const selected = members.filter(([, row]) => plan.withDeleted || row.deleted_at === null);
      if (members.length > configuration.maximumRows || activity.relationalReads.some(read => read.total !== selected.length))
        return yield* Effect.fail(mismatch());
      const pending = new Map(members.filter(([, row]) => operation === "restore" || row.deleted_at === null));
      const matched = new Set<number>(), ordered: JsonObject[] = [];
      for (const change of activity.lifecycle) {
        const key = identity(change.key), before = pending.get(key);
        if (change.table !== configuration.table.name || change.operation !== operation || before === undefined ||
          Object.keys(change.key).length !== 2 || typeof change.key[primary] !== "string" || typeof change.key[foreign] !== "string" ||
          before.deleted_at !== change.beforeDeletedAt ||
          (operation === "softDelete" ? change.beforeDeletedAt !== null || typeof change.afterDeletedAt !== "string" : change.afterDeletedAt !== null))
          return yield* Effect.fail(mismatch());
        pending.delete(key);
        if (change.attemptOrdinal === null) {
          if (operation !== "restore" || change.beforeDeletedAt !== null || change.rowAtOperation === null ||
            !jsonEqual(before, projectNativeRow(change.rowAtOperation))) return yield* Effect.fail(mismatch());
        } else {
          const ordinal = change.attemptOrdinal, mutation = activity.mutations[ordinal];
          if (matched.has(ordinal) || mutation === undefined || mutation.ordinal !== ordinal || mutation.operation !== "patch" ||
            mutation.table !== configuration.table.name || mutation.before === null || mutation.after === null ||
            identity(mutation.before) !== key || identity(mutation.after) !== key ||
            mutation.before.deleted_at !== change.beforeDeletedAt || mutation.after.deleted_at !== change.afterDeletedAt ||
            operation === "restore" && change.beforeDeletedAt === null) return yield* Effect.fail(mismatch());
          const after = yield* Effect.fromResult(decodeRow(mutation.after)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          for (const [field, value] of Object.entries(before)) if (field !== "deleted_at" && field !== "updated_at" &&
            (after[field] === undefined || !jsonEqual(value, after[field]))) return yield* Effect.fail(mismatch());
          matched.add(ordinal);
        }
        ordered.push(before);
      }
      yield* Effect.fromResult(decodeResult(call.result));
      const expected: JsonObject = ordered.length === 0 ? {} : {
        [primary]: ordered.map(row => row[primary] ?? null), [foreign]: ordered.map(row => row[foreign] ?? null),
      };
      if (pending.size || matched.size !== activity.mutations.length || ordered.length > configuration.maximumRows || !jsonEqual(call.result, expected))
        return yield* Effect.fail(mismatch());
    });
    return validate;
  });
}
