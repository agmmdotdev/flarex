import { Effect, Result } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError, defaultCommerceResources, isJsonObject, type CommerceResources, type Json, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareScalarRepository } from "../../repository/scalar";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { makeReadCatalog } from "../../query/catalog";
import type { CommerceRelation } from "../../query/relations";
import type { captureOrderMetadata } from "./schema";
import { orderFinanceWhere } from "./finance-query";
import { captureExactNumericRow, decodeExactNumeric, projectExactNumericColumns } from "../../value/exact-numeric";
import { captureNativeDateRecord } from "../../value/native-record";
import { captureCommerceInput } from "../../value/input";
import { captureOrderFinanceTotals } from "./finance-summary";

const selected = [
  ["Order", "order"], ["OrderSummary", "order_summary"], ["OrderTransaction", "order_transaction"],
  ["OrderChange", "order_change"], ["OrderChangeAction", "order_change_action"], ["OrderCreditLine", "order_credit_line"],
  ["OrderItem", "order_item"], ["OrderLineItem", "order_line_item"], ["OrderLineItemAdjustment", "order_line_item_adjustment"],
  ["OrderLineItemTaxLine", "order_line_item_tax_line"], ["OrderShipping", "order_shipping"],
  ["OrderShippingMethod", "order_shipping_method"], ["OrderShippingMethodAdjustment", "order_shipping_method_adjustment"],
  ["OrderShippingMethodTaxLine", "order_shipping_method_tax_line"],
] as const;
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Only the financial closure receives repositories. Complete checked native
 * scalar contracts precede all relation population and DTO formatting. */
export function compileOrderFinanceContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const entities = yield* Result.all(selected.map(([model, name]) => Result.gen(function* () {
      const table = metadata.tables.find(table => table.name === name);
      if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      return { model, table, complete: yield* compileCompleteRow(table), projection: yield* compileRowProjection(table),
        scalar: yield* prepareScalarRepository(table, model, orderFinanceWhere(table), undefined, { managedTimestamps: true }),
        creationRelations: new Map(table.relationships.map(relationship => [relationship.name, { relationship }])),
        numbers: table.columns.filter(column => column.type === "bigNumber") };
    })));
    const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
    const relations = new Map<string, Map<string, CommerceRelation>>();
    for (const entity of entities) {
      const members = new Map<string, CommerceRelation>();
      for (const declared of entity.table.relationships) {
        if (!byTable.has(declared.targetTable)) continue;
        if (declared.type === "hasMany") {
          const relation = describeToManyRelation(entity.table, declared.name, entities.map(entity => entity.table));
          if (relation === undefined || relation.join.type !== "hasMany") return yield* Result.fail(commerceError("unsupportedProfile"));
          members.set(declared.name, relation);
        } else if (declared.type === "belongsTo" || declared.type === "hasOneWithFK") {
          const columns = declared.foreignKeyNames;
          if (columns?.length !== 1 || !entity.table.foreignKeys.some(key => key.referencedTable === declared.targetTable &&
            key.columns.length === 1 && key.columns[0] === columns[0] && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
            return yield* Result.fail(commerceError("unsupportedProfile"));
          members.set(declared.name, { name: declared.name, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
            targetTable: declared.targetTable, join: { type: "belongsTo", foreignKeys: columns } });
        } else return yield* Result.fail(commerceError("unsupportedProfile"));
      }
      relations.set(entity.table.name, members);
    }
    const catalog = yield* makeReadCatalog(entities.map(({ table }) => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])),
    })), relations);
    const entity = (name: string) => {
      const value = byTable.get(name);
      return value === undefined ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(value);
    };
    const present = Effect.fn("OrderFinance.presentStoredRows")(function* (input: Json, table: string): Effect.fn.Return<Json, CommerceTransactionError> {
      const contract = yield* Effect.fromResult(entity(table)), output: JsonObject[] = [];
      for (const value of Array.isArray(input) ? input : [input]) {
        if (!isJsonObject(value)) return yield* Effect.fail(commerceError("storedCorruption"));
        const scalar = { ...value }, children: Record<string, Json> = {};
        for (const relation of contract.table.relationships) if (Object.hasOwn(scalar, relation.name)) {
          const child = scalar[relation.name]; delete scalar[relation.name];
          if (child === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          children[relation.name] = child === null ? null : yield* present(child, relation.targetTable);
        }
        yield* Effect.fromResult(contract.projection(scalar));
        const projected = yield* projectExactNumericColumns(scalar, contract.numbers, "reserialize");
        if (!isJsonObject(projected)) return yield* Effect.fail(commerceError("storedCorruption"));
        output.push({ ...projected, ...children });
      }
      return Array.isArray(input) ? output : output[0]!;
    });
    // Repository writes and their receipts share the native value boundary.
    // This conversion owns no manager, write, identity, default or timestamp.
    const normalize = Effect.fn("OrderFinance.normalizeNativeRow")(function* (input: unknown, table: string,
      resources: CommerceResources = defaultCommerceResources, retainedRaw = false) {
      const contract = yield* Effect.fromResult(entity(table));
      const row = yield* captureNativeDateRecord(input, ["confirmed_at", "created_at", "updated_at", "deleted_at"]);
      if (table === "order_summary" && Object.hasOwn(row, "totals")) row.totals = yield* captureOrderFinanceTotals(row.totals);
      const raw = new Map<string, Json>();
      if (retainedRaw) for (const number of contract.numbers) if (Object.hasOwn(row, "raw_" + number.name)) {
        const key = "raw_" + number.name, companion = yield* Effect.fromResult(captureCommerceInput(row[key], resources));
        raw.set(key, companion); delete row[key];
      }
      const encoded = yield* captureExactNumericRow(row, contract.numbers, false, "nativeRaw");
      for (const number of contract.numbers) {
        const companion = raw.get("raw_" + number.name);
        if (companion !== undefined) yield* decodeExactNumeric(encoded[number.name], companion, number.nullable);
      }
      return encoded;
    });
    return { entities, entity, catalog, relations: catalog.relations, present, normalize };
  });
}
