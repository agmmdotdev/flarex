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
import { compileTaxRuleDeletionContracts, decodeTaxRuleDeletionIds } from "./rule-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** Historical selection preserves the native retained-request behavior. Shared
 * lifecycle owns writes, timestamps and constraints; parent repositories deny. */
export function prepareTaxRuleDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileTaxRuleDeletionContracts(metadata);
    const rule = yield* prepareScalarRepository(contracts.rule, "TaxRateRule", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const rules = rule.bind(root, owner), { bridge, events } = rules;
      const denied = deniedCommerceRepository(rules.repository, rules.refuse);
      const lifecycleMethod = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeTaxRuleDeletionIds)));
          const historical = ids.length === 0 ? [] : yield* readCommerceRelationRows(ctx, contracts.rule.name,
            { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true });
          if (historical.length > 8) return yield* ctx.refuse(commerceError("limitExceeded"));
          const parents = new Set<string>();
          for (const value of historical) {
            const row = yield* Effect.fromResult(contracts.decodeRuleRow(projectNativeRow(value)));
            if (typeof row.tax_rate_id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
            parents.add(row.tax_rate_id);
          }
          if (parents.size > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          const roots = historical.filter(row => operation === "restore" || row.deleted_at === null);
          const lifecycle = medusaLifecycle(ctx, { tables: contracts.tables, entities: [{ table: contracts.rule, model: "TaxRateRule" }] }, operation);
          const result = yield* (yield* lifecycle.plan(contracts.rule, roots)).apply();
          const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([result.roots, result.cascades]));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          // The native restore service has no mutation subscriber. Active
          // no-ops and changed restores return maps without restored events.
          if (operation === "softDelete") yield* events.cascades(result.cascades, shared,
            row => ({ entity: row, originalEntity: { deleted_at: null } }));
          return decoded;
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize: rules.repository.serialize,
        softDelete: lifecycleMethod("softDelete"), restore: lifecycleMethod("restore") };
      return { ...rules, repository, ruleRepository: repository, denied };
    };
    return { bind, contracts };
  });
}
