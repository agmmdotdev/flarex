import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { readCommerceRelationRows } from "../../query/relations";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import type { captureTaxMetadata } from "./schema";
import { compileTaxRateCreationContracts, decodeTaxRatePhysicalSelection } from "./rate-create-input";

type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];
const decodeScalars = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "unsupportedProfile");

/** Native Tax splits Rates and Rules into scalar creates. Both repositories
 * borrow the same request bridge, manager token and mutation subscriber. */
export function prepareTaxRateCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileTaxRateCreationContracts(metadata);
    const rate = yield* prepareScalarRepository(contracts.rate, "TaxRate", scalarIdWhere, undefined,
      { managedTimestamps: true, nativeRealPresentation: true });
    const rule = yield* prepareScalarRepository(contracts.rule, "TaxRateRule", scalarIdWhere, undefined, { managedTimestamps: true });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const rates = rate.bind(root, owner), rules = rule.bind(root, owner, rates.events, rates.bridge), { bridge } = rates;
      const denied = deniedCommerceRepository(rates.repository, rates.refuse);
      const rateRepository: DAL.RepositoryService = { ...denied, serialize: rates.repository.serialize,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeScalars)));
          if (captured.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          const inserted = yield* rates.createRows(ctx, captured, shared);
          return yield* Effect.fromResult(contracts.initializeRows(inserted));
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeTaxRatePhysicalSelection)));
          const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "delete");
          const ids = selection.$or.map(row => row.id);
          const roots = ids.length === 0 ? [] : yield* readCommerceRelationRows(ctx, contracts.rate.name,
            { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true });
          const plan = yield* operation.plan(contracts.rate, roots);
          for (const entity of contracts.entities) {
            if (plan.rows(entity.table).length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const row of plan.rows(entity.table)) yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row)));
          }
          const removed = yield* plan.apply(), removedIds: string[] = [];
          for (const row of removed.roots) removedIds.push((yield* Effect.fromResult(contracts.decodeRateRow(projectNativeRow(row)))).id);
          return removedIds;
        }))),
      };
      const ruleRepository: DAL.RepositoryService = { ...denied, create: (input, shared) => bridge.executeInput(shared, input,
        (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const inserted = yield* rules.createRows(ctx, value, shared);
          if (inserted.length > 8) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of inserted) yield* Effect.fromResult(contracts.decodeRuleRow(row));
          return inserted;
        }))) };
      return { ...rates, repository: rateRepository, rateRepository, ruleRepository, denied };
    };
    return { bind, contracts };
  });
}
