import { Effect, Result, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { populateCommerceRelations, readCommerceRelationRows, type CommerceRelations } from "../../query/relations";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { ShippingProfileDeletionIds, type compileShippingProfileDeletionContracts } from "./shipping-profile-delete-input";

const decodeValidationRead = commerceDecoder(Schema.Struct({
  where: Schema.Struct({ id: ShippingProfileDeletionIds }),
  options: Schema.Struct({ populate: Schema.Tuple([Schema.Literal("shipping_options.id")]),
    orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }),
}), "unsupportedProfile");

/** Actual native deletion validation uses one complete, bounded active inverse
 * read. Both physical deletion and soft deletion share this query owner. */
export function prepareShippingProfileDeletionValidationRead(contracts: Result.Result.Success<ReturnType<typeof compileShippingProfileDeletionContracts>>) {
  const relations: CommerceRelations = new Map([[contracts.profile.name, new Map([["shipping_options", contracts.relation]])]]);
  return Effect.fn("ShippingProfile.findDeletionValidationRows")(function* (ctx: CommerceCommandContext, captured: unknown) {
    const input = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(decodeValidationRead)));
    // Bound and decode the complete selected historical root cohort before
    // native active filtering. A deleted profile does not block deletion.
    const historical = yield* readCommerceRelationRows(ctx, contracts.profile.name,
      { kind: "in", column: "id", values: input.where.id });
    if (historical.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
    const roots: Array<Result.Result.Success<ReturnType<typeof contracts.decodeProfileRow>>> = [];
    for (const stored of historical) {
      const row = yield* Effect.fromResult(contracts.decodeProfileRow(projectNativeRow(stored)));
      if (row.deleted_at === null) roots.push(row);
    }
    // Pinned Drizzle skips the scalar suffix `id` in the populate tree.
    // With fields omitted it returns full Option scalar bodies, not an
    // ID-only DTO. Shared population performs the genuine hasMany grouping.
    const readContext = { manager: ctx.manager, table: ctx.table, resources: ctx.resources,
      admitSelection: (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
        if (table !== contracts.option.name) return yield* Result.fail(commerceError("unsupportedProfile"));
        if (rows.length > 8) return yield* Result.fail(commerceError("limitExceeded"));
        for (const row of rows) yield* contracts.decodeOptionRow(projectNativeRow(row));
      }) };
    const populated = yield* populateCommerceRelations(readContext, contracts.profile.name,
      orderNativeIdRows(roots, input.where), ["shipping_options"], relations, new Map());
    // Shared logical rows carry two private document fields. The native
    // presentation must remove those from populated children as well.
    const output: JsonObject[] = [];
    for (const row of populated) {
      if (!Array.isArray(row.shipping_options)) return yield* ctx.refuse(commerceError("storedCorruption"));
      const options: JsonObject[] = [];
      for (const value of row.shipping_options) {
        if (!isJsonObject(value)) return yield* ctx.refuse(commerceError("storedCorruption"));
        options.push(yield* Effect.fromResult(contracts.decodeOptionRow(projectNativeRow(value))));
      }
      output.push({ ...row, shipping_options: options });
    }
    return output;
  });
}
