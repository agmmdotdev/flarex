import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { deniedCommerceRepository } from "../../repository/denied";
import { prepareScalarRepository } from "../../repository/scalar";
import { projectNativeRow } from "../../repository/result";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { readCommerceRelationRows } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { QueryEnvelope } from "../../query/decoder";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileStoreCartReadContracts, StoreCartReadFilters } from "./cart-read-input";
import type { captureStoreMetadata } from "./schema";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(StoreCartReadFilters, "unsupportedProfile");

/** Scalar Store reads for the native Cart context; child repositories and all
 * writes remain denied. The complete actual selection is decoded before any
 * scalar projection, including the default-channel two-column selection. */
export function prepareStoreCartReadRepository(metadata: Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compileStoreCartReadContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.table, "Store", scalarIdWhere);
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input);
      yield* decodeWhere(envelope.where ?? {});
      const plan = yield* scalar.query(input);
      if (plan.withDeleted) return yield* Result.fail(commerceError("unsupportedProfile"));
      return plan;
    });
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(ctx, owner), denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("StoreCartRead.find")(function* (current: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, current.resources));
        const plan = yield* Effect.fromResult(query(captured));
        const rows = yield* readCommerceRelationRows({ ...current, admitSelection: (table, selected) => Result.gen(function* () {
          if (table !== contracts.table.name) return yield* Result.fail(commerceError("unsupportedProfile"));
          for (const row of selected) yield* contracts.decodeRow(projectNativeRow(row));
        }) }, contracts.table.name, plan.query.predicate, "id", { includeIdentities: true });
        const ordered = plan.query.order.direction === "desc" ? [...rows].reverse() : rows;
        const selected = ordered.slice(plan.query.skip, plan.query.take === undefined ? undefined : plan.query.skip + plan.query.take);
        return { rows: yield* Effect.fromResult(projectRows(selected, plan.projection.node)), count: rows.length };
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bound.bridge.executeInput(shared, input, (current, captured) => bound.bridge.checked(current,
          find(current, captured)).pipe(Effect.map(result => structuredClone(result.rows)))),
        findAndCount: (input, shared) => bound.bridge.executeInput(shared, input, (current, captured) => bound.bridge.checked(current,
          find(current, captured)).pipe(Effect.map(result => [structuredClone(result.rows), result.count] satisfies [object[], number]))),
      };
      return { ...bound, repository, denied };
    };
    return { contracts, table: scalar.table, query, bind };
  });
}
