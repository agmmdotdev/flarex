import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { OrderChangeId, compileOrderChangeContracts } from "./change-contracts";
import type { captureOrderMetadata } from "./schema";

// Preserve native requested positions, including duplicate, missing and empty IDs.
export const OrderChangeDeletionIds = Schema.Array(Schema.String.check(Schema.isMaxLength(256)))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeOrderChangeDeletionIds = commerceDecoder(OrderChangeDeletionIds, "invalidInput");
export const decodeOrderChangeDeletionArguments = commerceDecoder(Schema.Tuple([OrderChangeDeletionIds]), "invalidInput");
const affectedIds = (maximum: number) => Schema.Array(OrderChangeId).pipe(Schema.mutable).check(
  Schema.isLengthBetween(1, maximum), Schema.makeFilter(ids => new Set(ids).size === ids.length || "Expected distinct affected identities"));
export const OrderChangeDeletionOutput = Schema.Struct({
  order_change_id: Schema.optionalKey(affectedIds(4)),
  OrderChangeAction: Schema.optionalKey(Schema.Array(Schema.JsonObject).pipe(Schema.mutable)
    .check(Schema.isLengthBetween(1, 8))),
});
const decodeOutputShape = commerceDecoder(OrderChangeDeletionOutput, "storedCorruption");
const decodeTuple = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Struct({
    OrderChange: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4))),
    OrderChangeAction: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8))),
  }),
]), "storedCorruption");
const decodeActionIdentity = commerceDecoder(Schema.StructWithRest(Schema.Struct({
  id: OrderChangeId, order_change_id: Schema.NullOr(OrderChangeId),
}), [Schema.Record(Schema.String, Schema.Json)]), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** The full native Order catalog remains installed. Only Change roots and their
 * declared Action cascade participate in this bounded soft lifecycle. */
export function compileOrderChangeDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const common = yield* compileOrderChangeContracts(metadata), change = common.table;
    const action = metadata.tables.find(table => table.name === "order_change_action");
    if (metadata.tables.length !== 23 || action === undefined || change.foreignKeys.length !== 1 ||
      !change.relationships.some(relation => relation.name === "actions" && relation.type === "hasMany" &&
        relation.targetTable === action.name && relation.cascadeDelete) ||
      change.relationships.filter(relation => relation.cascadeDelete).length !== 1 ||
      change.columns.find(column => column.name === "order_id")?.nullable !== false ||
      action.foreignKeys.length !== 1 || !action.foreignKeys.some(key => key.columns.length === 1 &&
        key.columns[0] === "order_change_id" && key.referencedTable === change.name &&
        key.referencedColumns.length === 1 && key.referencedColumns[0] === "id" && key.onDelete === "cascade") ||
      action.columns.find(column => column.name === "order_change_id")?.nullable !== true ||
      action.relationships.length !== 1 || !action.relationships.some(relation => relation.name === "order_change" &&
        relation.type === "belongsTo" && relation.targetTable === change.name && relation.mappedBy === "actions" &&
        relation.foreignKeyNames?.length === 1 && relation.foreignKeyNames[0] === "order_change_id") ||
      action.relationships.some(relation => relation.cascadeDelete))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const completeAction = yield* compileCompleteRow(action);
    const decodeActionRow = (input: unknown) => completeAction(input).pipe(Result.flatMap(decodeActionIdentity));
    // OrderChange is configured as linkable; the native mapper retains the
    // unmapped Action rows instead of IDs. This portable profile returns the
    // complete checked DML rows; physical native drivers may project less.
    const decodeOutput = (input: unknown): Result.Result<{
      readonly order_change_id?: string[];
      readonly OrderChangeAction?: Array<Result.Result.Success<ReturnType<typeof decodeActionRow>>>;
    }, CommerceTransactionError> => Result.gen(function* () {
      const { OrderChangeAction, ...output } = yield* decodeOutputShape(input);
      if (OrderChangeAction === undefined) return output;
      const actions: Array<Result.Result.Success<ReturnType<typeof decodeActionRow>>> = [], identities = new Set<string>();
      for (const value of OrderChangeAction) {
        const row = yield* decodeActionRow(value);
        if (identities.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
        identities.add(row.id); actions.push(row);
      }
      return { ...output, OrderChangeAction: actions };
    });
    const entities = [
      { table: change, model: "OrderChange", linkableKey: "order_change_id", maximum: 4, decodeRow: common.decodeRow },
      { table: action, model: "OrderChangeAction", linkableKey: "OrderChangeAction", maximum: 8, decodeRow: decodeActionRow },
    ] as const;
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const [rawRoots, rawGroups] = yield* decodeTuple(input), roots: JsonObject[] = [], cascades: Record<string, JsonObject[]> = {};
      for (const value of rawRoots) roots.push(yield* common.decodeRow(value));
      for (const entity of entities) {
        const values = rawGroups[entity.model];
        if (values === undefined) continue;
        const group: JsonObject[] = [], identities = new Set<string>();
        for (const value of values) {
          const row = yield* entity.decodeRow(value);
          if (identities.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
          identities.add(row.id); group.push(row);
        }
        cascades[entity.model] = group;
      }
      if (!jsonEqual(roots, cascades.OrderChange ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      const rootIds = new Set(roots.map(row => row.id));
      for (const row of cascades.OrderChangeAction ?? []) if (!rootIds.has(row.order_change_id))
        return yield* Result.fail(commerceError("storedCorruption"));
      return [roots, cascades] satisfies [JsonObject[], Record<string, JsonObject[]>];
    });
    return { ...common, change, action, entities, decodeChangeRow: common.decodeRow, decodeActionRow,
      decodeLifecycleResult, decodeOutput,
      Input: OrderChangeDeletionIds, Output: OrderChangeDeletionOutput };
  });
}
