import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { StockLocationsInput } from "./input";
import { planStockLocationCreates } from "./create-planning";
import type { SchemaTable } from "../../schema/model";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const decode = commerceDecoder(StockLocationsInput, "unsupportedProfile");
/** Native nested address persistence over two shared scalar repositories. The
 * DML owns the FK and cardinality; this owner supplies its declared write order. */
export function prepareStockLocationRepository(table: SchemaTable, address: SchemaTable) {
  return Result.gen(function* () {
    const locations = yield* prepareScalarRepository(table, "StockLocation", scalarIdWhere);
    const addresses = yield* prepareScalarRepository(address, "StockLocationAddress", scalarIdWhere);
    if (!table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "address_id" &&
      key.referencedTable === address.name && key.referencedColumns[0] === "id"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const prefix = table.columns.find(column => column.name === "id")?.options?.prefix;
    const bind = (...args: Parameters<typeof locations.bind>) => {
      const bound = locations.bind(...args);
      const addressBound = addresses.bind(args[0], args[1], bound.events);
      const create = Effect.fn("StockLocationRepository.create")(function* (
        ctx: Parameters<typeof bound.createRows>[0], input: unknown, shared: Parameters<typeof bound.createRows>[2],
      ) {
        const inputs = yield* Effect.fromResult(decode(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        if (inputs.some(row => row.address !== undefined && row.address_id !== undefined))
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        const plan = planStockLocationCreates(inputs, inputs.map(row => generateEntityId(row.id, prefix)));
        const createdAddresses = yield* addressBound.createRows(ctx,
          plan.addresses.flatMap(selected => selected.kind === "nested" ? [selected.input] : []), shared);
        const rows: JsonObject[] = [];
        const addressFor = new Map<number, JsonObject>();
        let ordinal = 0;
        for (const [index, row] of plan.entities.entries()) {
          const selected = plan.addresses[index]!;
          if (selected.kind !== "nested") {
            rows.push({ ...row });
            if (selected.kind === "reference") addressFor.set(index, { id: selected.id });
            continue;
          }
          const created = createdAddresses[ordinal++];
          if (!created || typeof created.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
          addressFor.set(index, created);
          rows.push({ ...row, address_id: created.id });
        }
        const inserted = yield* bound.createRows(ctx, rows, shared);
        const presented = inserted.map((row, index) => {
          const address = addressFor.get(index);
          // Native relation storage and its immediate scalar alias presentation
          // differ when a later alias supplied address_id after nested creation.
          const submitted = plan.entities[index]?.address_id;
          return address === undefined ? row : { ...row, address,
            ...(typeof submitted === "string" ? { address_id: submitted } : {}) };
        });
        return plan.positions.map(position => ({ ...presented[position]! }));
      });
      const repository: DAL.RepositoryService = { ...bound.repository,
        create: (input: unknown, shared?: Parameters<typeof bound.createRows>[2]) =>
          bound.bridge.execute(shared, ctx => bound.bridge.checked(ctx, create(ctx, input, shared))),
      };
      return { ...bound, repository };
    };
    return { ...locations, bind };
  });
}
