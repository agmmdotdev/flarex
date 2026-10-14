import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { inventoryLevelAvailableQuantity } from "@medusajs/inventory/inventory-level-quantity";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { encodeExactNumeric, decodeExactNumeric, ExactNumericRaw } from "../../value/exact-numeric";
import { InventoryLevelsInput } from "./level-input";
import type { SchemaTable } from "../../schema/model";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const decode = commerceDecoder(InventoryLevelsInput, "unsupportedProfile");
const decodeRaw = commerceDecoder(ExactNumericRaw, "storedCorruption");
/** Inventory owns its computed DTO quantity; exact pair storage belongs to the
 * existing numeric owner and all writes/events use the shared scalar DAL. */
export function prepareInventoryLevelRepository(table: SchemaTable) {
  return Result.gen(function* () {
    const scalar = yield* prepareScalarRepository(table, "InventoryLevel", scalarIdWhere);
    const numeric = table.columns.filter(column => column.type === "bigNumber");
    if (numeric.length !== 3 || !["stocked_quantity", "reserved_quantity", "incoming_quantity"].every(
      name => numeric.some(column => column.name === name),
    )) return yield* Result.fail(commerceError("unsupportedProfile"));
    const bind = (...args: Parameters<typeof scalar.bind>) => {
      const bound = scalar.bind(...args);
      const create = Effect.fn("InventoryLevelRepository.create")(function* (
        ctx: Parameters<typeof bound.createRows>[0], input: unknown,
        shared: Parameters<typeof bound.createRows>[2],
      ) {
        const inputs = yield* Effect.fromResult(decode(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        const rows: JsonObject[] = [];
        for (const input of inputs) {
          const row: Record<string, Json> = { ...input };
          for (const column of numeric) {
            const encoded = yield* encodeExactNumeric(row[column.name] ?? column.defaultValue);
            row[column.name] = encoded.value;
            row["raw_" + column.name] = yield* Effect.fromResult(captureCommerceInput(encoded.raw, ctx.resources));
          }
          rows.push(row);
        }
        const inserted = yield* bound.createRows(ctx, rows, shared);
        const output: JsonObject[] = [];
        for (const stored of inserted) {
          const row = { ...stored };
          for (const column of numeric) row[column.name] = yield* decodeExactNumeric(stored[column.name], stored["raw_" + column.name]);
          const stocked = yield* Effect.fromResult(decodeRaw(stored.raw_stocked_quantity));
          const reserved = yield* Effect.fromResult(decodeRaw(stored.raw_reserved_quantity));
          const available = yield* Effect.try({ try: () => inventoryLevelAvailableQuantity(stocked, reserved).numeric,
            catch: cause => commerceError("storedCorruption", cause) });
          if (!Number.isFinite(available)) return yield* Effect.fail(commerceError("storedCorruption"));
          output.push({ ...row, available_quantity: available });
        }
        return output;
      });
      const repository: DAL.RepositoryService = { ...bound.repository,
        create: (input: unknown, shared?: Parameters<typeof bound.createRows>[2]) =>
          bound.bridge.execute(shared, ctx => bound.bridge.checked(ctx, create(ctx, input, shared))),
        find: bound.refuse, findAndCount: bound.refuse,
      };
      return { ...bound, repository };
    };
    return { ...scalar, bind };
  });
}
