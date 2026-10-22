import { Effect, Result } from "effect";
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
import type { captureTaxMetadata } from "./schema";
import { compileTaxRuleCreationContracts, decodeTaxRulePhysicalSelection } from "./rule-create-input";

type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** Native standalone Rule persistence borrows the shared scalar bridge. Parent
 * existence and active uniqueness remain storage constraints, without reads. */
export function prepareTaxRuleCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileTaxRuleCreationContracts(metadata);
    const rule = yield* prepareScalarRepository(contracts.rule, "TaxRateRule", scalarIdWhere, undefined, { managedTimestamps: true });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const rules = rule.bind(root, owner), { bridge } = rules;
      const denied = deniedCommerceRepository(rules.repository, rules.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: rules.repository.serialize,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(contracts.decodeInput)));
          const inserted = yield* rules.createRows(ctx, captured, shared);
          return yield* Effect.fromResult(contracts.decodeOutput(inserted));
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeTaxRulePhysicalSelection)));
          const ids = selection.$or.map(row => row.id);
          const roots = ids.length === 0 ? [] : yield* readCommerceRelationRows(ctx, contracts.rule.name,
            { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true });
          const operation = medusaLifecycle(ctx, { tables: contracts.tables, entities: contracts.entities }, "delete");
          const plan = yield* operation.plan(contracts.rule, roots);
          if (plan.rows(contracts.rule).length > 8) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of plan.rows(contracts.rule)) yield* Effect.fromResult(contracts.decodeRuleRow(projectNativeRow(row)));
          const removed = yield* plan.apply(), removedIds: string[] = [];
          for (const row of removed.roots) removedIds.push((yield* Effect.fromResult(contracts.decodeRuleRow(projectNativeRow(row)))).id);
          return removedIds;
        }))),
      };
      return { ...rules, repository, ruleRepository: repository, denied };
    };
    return { bind, contracts };
  });
}
