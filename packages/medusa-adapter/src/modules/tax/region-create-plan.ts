import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import type { ScalarCreationPlan } from "../../repository/scalar";
import type { compileTaxRegionCreationContracts } from "./region-create-input";
import type { Result } from "effect";

type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRegionCreationContracts>>;
type Accept = (beforeCreatedEvents?: Effect.Effect<void, CommerceTransactionError>) => Effect.Effect<JsonObject[], CommerceTransactionError>;
interface PendingCreation {
  readonly table: Contracts["region"];
  readonly model: string;
  readonly plan: ScalarCreationPlan;
  readonly returned: JsonObject[];
  readonly accept: Accept;
}

/** Native callbacks prepare identities and relation collections before the
 * transaction flush accepts complete rows. This plan owns only that Tax call's
 * three creation groups; the existing borrowed context owns every write and
 * reference check, failure latch and eventual settlement. */
export function makeTaxRegionCreationPlan(contracts: Contracts) {
  const groups = new Map<string, PendingCreation>();
  const ordered = [contracts.region, contracts.rate, contracts.rule];
  let phase: "collecting" | "flushing" | "complete" = "collecting";
  let manager: CommerceCommandContext["manager"] | undefined;
  let current: PendingCreation | undefined;
  const stage = (table: Contracts["region"], model: string, maximum: number) => ({
    stage: Effect.fn("TaxRegion.stageCreation")(function* (ctx: CommerceCommandContext, plan: ScalarCreationPlan, accept: Accept) {
      if (phase !== "collecting" || groups.has(table.name) || plan.created.length > maximum ||
        manager !== undefined && manager !== ctx.manager ||
        table !== ordered[groups.size]) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      manager = ctx.manager;
      const returned = plan.entities.map(entity => structuredClone(entity));
      fillEmptyToManyRelations(returned, new Map(table.relationships.map(relationship => [relationship.name, { relationship }])));
      groups.set(table.name, { table, model, plan, returned, accept });
      // Repeated explicit identities retain the same pending entity until the
      // native serializer detaches each DTO, exactly as the native create plan.
      return plan.positions.map(position => returned[position]!);
    }),
  });
  const flush = Effect.fn("TaxRegion.flushCreation")(function* (ctx: CommerceCommandContext) {
    if (phase !== "collecting" || manager !== undefined && manager !== ctx.manager || ctx.checkpointRelationalReferences === undefined)
      return yield* ctx.refuse(commerceError("invalidAuthority"));
    phase = "flushing";
    for (const table of ordered) {
      current = groups.get(table.name);
      if (current === undefined) continue;
      // The genuine row owner may reject a required field before this reference
      // check. A reference failure must precede afterCreate/event delivery.
      const accepted = yield* current.accept(ctx.checkpointRelationalReferences(table.name));
      if (accepted.length !== current.plan.created.length) return yield* ctx.refuse(commerceError("storedCorruption"));
      for (const [index, position] of current.plan.positions.entries()) {
        const row = accepted[index], pending = current.returned[position];
        if (row === undefined || pending === undefined || row.id !== pending.id)
          return yield* ctx.refuse(commerceError("storedCorruption"));
        Object.assign(pending, structuredClone(row));
      }
    }
    current = undefined;
    phase = "complete";
  });
  return { region: stage(contracts.region, "TaxRegion", 4), rate: stage(contracts.rate, "TaxRate", 4),
    rule: stage(contracts.rule, "TaxRateRule", 8), flush,
    pendingFailure: () => phase === "flushing" ? current : undefined };
}
