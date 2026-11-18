import { Effect, Result } from "effect";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { makeReadCatalog } from "../../query/catalog";
import { executeRead } from "../../query/read";
import { QueryEnvelope } from "../../query/decoder";
import type { WherePolicy } from "../../query/predicate";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { RegionFilters, compileRegionReadContracts, regionReadLimit } from "./input";
import type { captureRegionMetadata } from "./schema";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile"), decodeFilters = commerceDecoder(RegionFilters, "unsupportedProfile");
const where: WherePolicy = { decode: decodeFilters, fields: new Map([["id", { column: "id", decode: commerceDecoder(RegionFilters.fields.id, "unsupportedProfile") }]]) };

/** Scalar storage mechanics are shared. The named profile adds native
 * ID-filter ordering and complete eight-row validation before projection. */
export function prepareRegionReadRepository(metadata: Effect.Success<ReturnType<typeof captureRegionMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compileRegionReadContracts(metadata), scalar = yield* prepareScalarRepository(contracts.table, "Region", where),
      catalog = yield* makeReadCatalog([scalar.table], new Map());
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input), filters = yield* decodeFilters(envelope.where), plan = yield* scalar.query(input);
      if (plan.withDeleted || plan.paths.length) return yield* Result.fail(commerceError("unsupportedProfile"));
      const direction = plan.query.order.direction;
      if (direction !== "asc" && direction !== "desc") return yield* Result.fail(commerceError("unsupportedProfile"));
      const window = { kind: "catalog" as const, order: "id", select: (rows: readonly JsonObject[]) => ({ rows: preservePrimaryKeyOrFilterOrder(
        (direction === "asc" ? rows : [...rows].reverse()).slice(plan.query.skip, plan.query.take === undefined ? undefined : plan.query.skip + plan.query.take),
        filters, ["id"], [["id", direction === "asc" ? "ASC" : "DESC"]]), count: rows.length }) };
      return { ...plan, window, filters };
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound, denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("RegionRead.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources)), plan = yield* Effect.fromResult(query(captured));
        return yield* executeRead({ manager: ctx.manager, table: ctx.table, resources: ctx.resources,
          admitSelection: (table, rows) => Result.gen(function* () {
            if (table !== contracts.table.name) return yield* Result.fail(commerceError("unsupportedProfile"));
            if (rows.length > regionReadLimit) return yield* Result.fail(commerceError("limitExceeded"));
            for (const row of rows) yield* contracts.decodeRow(projectNativeRow(row));
          }) }, catalog, plan, count);
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured, false)).pipe(Effect.map(result => structuredClone(result.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* find(ctx, captured, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [structuredClone(result.rows), result.count] satisfies [JsonObject[], number];
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts, table: scalar.table, query };
  });
}
