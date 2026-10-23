import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import type { WherePolicy } from "../../query/predicate";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import type { captureTaxMetadata } from "./schema";
import { prepareTaxRuleCreationRepository } from "./rule-create-repository";
import { prepareTaxRuleDeletionRepository } from "./rule-delete-repository";
import { TaxRuleReplacementFilters, TaxRuleReplacementRateIds, decodeTaxRuleReplacementIds,
  decodeTaxRuleReplacementSelection } from "./rule-replacement-input";

const where: WherePolicy = { decode: commerceDecoder(TaxRuleReplacementFilters, "unsupportedProfile"),
  fields: new Map([["tax_rate_id", { column: "tax_rate_id", decode: commerceDecoder(TaxRuleReplacementRateIds, "unsupportedProfile") }]]) };

/** One native Rule repository owns the complete replacement graph. Existing
 * strict create/inverse and historical lifecycle borrow its bridge and events. */
export function prepareTaxRuleReplacementRepository(metadata: Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"]) {
  return Result.gen(function* () {
    const creation = yield* prepareTaxRuleCreationRepository(metadata), deletion = yield* prepareTaxRuleDeletionRepository(metadata);
    const contracts = creation.contracts;
    const scalar = yield* prepareScalarRepository(contracts.rule, "TaxRateRule", where, undefined, { managedTimestamps: true });
    const query = (input: unknown) => decodeTaxRuleReplacementSelection(input).pipe(Result.flatMap(() => scalar.query(input)));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const rules = scalar.bind(root, owner), { bridge } = rules;
      const create = creation.bindBorrowed(rules), lifecycle = deletion.bindBorrowed(rules);
      const denied = deniedCommerceRepository(rules.repository, rules.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: rules.repository.serialize,
        create: create.repository.create, delete: create.repository.delete,
        softDelete: lifecycle.repository.softDelete, restore: lifecycle.repository.restore,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources));
          yield* Effect.fromResult(decodeTaxRuleReplacementSelection(captured));
          const selected = yield* rules.find(ctx, captured, false);
          // The scalar catalog read obtains the complete indexed active set;
          // admission is checked before returning IDs to the deleting step.
          if (selected.rows.length > 8) return yield* ctx.refuse(commerceError("limitExceeded"));
          return yield* Effect.fromResult(decodeTaxRuleReplacementIds(selected.rows));
        }))),
      };
      return { ...rules, repository, ruleRepository: repository, denied };
    };
    return { bind, contracts, creation, deletion, query };
  });
}
