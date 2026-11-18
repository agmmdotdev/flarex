import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { WherePolicy } from "../../query/predicate";
import { CustomerSelectionWhere, CustomerSelectionId, decodeCustomerSelectionQuery, decodeCustomerPhysicalSelection,
  CustomerSelectionCreate } from "./input";
import { compileCustomerSelectionOutput } from "./output";
import type { captureCustomerMetadata } from "./schema";

type Metadata = Effect.Success<ReturnType<typeof captureCustomerMetadata>>["frame"];
const decodePopulate = commerceDecoder(Schema.Struct({ populate: Schema.Literal(true) }), "unsupportedProfile");
const decodeSerialized = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(1)), "storedCorruption");
const decodeCreateRows = commerceDecoder(Schema.Array(CustomerSelectionCreate).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const where: WherePolicy = { decode: commerceDecoder(CustomerSelectionWhere, "unsupportedProfile"), fields: new Map([
  ["id", { column: "id", decode: commerceDecoder(CustomerSelectionId, "unsupportedProfile") }],
  ["email", { column: "email", decode: commerceDecoder(Schema.String, "unsupportedProfile") }],
  ["has_account", { column: "has_account", decode: commerceDecoder(Schema.Literal(false), "unsupportedProfile") }],
]) };

/** Genuine internal services share one borrowed manager bridge. Only Customer
 * data methods are admitted; the actual empty Address create short-circuits in
 * Medusa before its denied data repository, then reaches the base serializer. */
export function prepareCustomerSelectionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileCustomerSelectionOutput(metadata);
    const scalar = yield* prepareScalarRepository(contracts.customer, "Customer", where);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(root, Effect.gen(function* () {
          const value = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
          let result: JsonObject | JsonObject[];
          if (options === undefined) {
            result = Array.isArray(value) ? yield* Effect.fromResult(contracts.decodeRows(value))
              : yield* Effect.fromResult(contracts.decodeRow(value));
          } else {
            yield* Effect.fromResult(captureCommerceInput(options, root.resources).pipe(Result.flatMap(decodePopulate)));
            result = [];
            for (const row of yield* Effect.fromResult(decodeSerialized(value))) result.push(yield* Effect.fromResult(contracts.decodeCreatedRow(row)));
          }
          // SAFETY: DAL declares its caller-selected DTO generic. The complete
          // checked native scalar/creation DTO is authenticated above.
          return result as Output;
        }))),
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          yield* Effect.fromResult(decodeCustomerSelectionQuery(value));
          const found = yield* bound.find(ctx, value, false);
          const rows = yield* Effect.fromResult(contracts.decodeRows(found.rows));
          return structuredClone(rows);
        }))),
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(decodeCreateRows(value));
          return yield* Effect.fromResult(contracts.initializeRows(yield* bound.createRows(ctx, rows, shared)));
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(decodeCustomerPhysicalSelection(value));
          const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "delete");
          const roots = yield* operation.roots(contracts.customer, selection.$or.map(row => row.id));
          // Native pinned MikroORM leaves explicit membership rows orphaned.
          // This bounded profile refuses that unsupported inverse before writes;
          // it does not replace the native business behavior with a cascade.
          for (const row of roots) if ((yield* operation.loadReferencing(contracts.membership, ["customer_id"], row, ["id"])).length)
            return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const plan = yield* operation.plan(contracts.customer, roots);
          for (const entity of contracts.entities) {
            const rows = plan.rows(entity.table);
            if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const row of rows) yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row)));
          }
          const result = yield* plan.apply(), ids: string[] = [];
          for (const row of result.roots) ids.push((yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)))).id);
          return ids;
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, query: scalar.query };
  });
}
