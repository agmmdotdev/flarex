import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { populateCommerceRelations, readCommerceRelationRows, type CommerceRelations } from "../../query/relations";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { compileShippingProfileDeletionContracts, ShippingProfileDeletionIds, decodeShippingProfileDeletionIds } from "./shipping-profile-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];
const decodeValidationRead = commerceDecoder(Schema.Struct({
  where: Schema.Struct({ id: ShippingProfileDeletionIds }),
  options: Schema.Struct({ populate: Schema.Tuple([Schema.Literal("shipping_options.id")]),
    orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }),
}), "unsupportedProfile");

/** The genuine service invokes this one internal read before lifecycle writes.
 * Its Option repository and FK parents remain denied sibling capabilities. */
export function prepareShippingProfileDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingProfileDeletionContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.profile, "ShippingProfile", scalarIdWhere);
    const relations: CommerceRelations = new Map([[contracts.profile.name, new Map([["shipping_options", contracts.relation]])]]);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("ShippingProfileDelete.findValidationRows")(function* (ctx: CommerceCommandContext, captured: unknown) {
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
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(decodeShippingProfileDeletionIds(captured));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, operation);
          const roots = yield* lifecycle.roots(contracts.profile, ids);
          const plan = yield* lifecycle.plan(contracts.profile, roots);
          if (plan.rows(contracts.profile).length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of plan.rows(contracts.profile)) yield* Effect.fromResult(contracts.decodeProfileRow(projectNativeRow(row)));
          const result = yield* plan.apply();
          const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([result.roots, result.cascades]));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.cascades(result.cascades, shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return decoded;
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured))
          .pipe(Effect.map(rows => structuredClone(rows)))),
        softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
