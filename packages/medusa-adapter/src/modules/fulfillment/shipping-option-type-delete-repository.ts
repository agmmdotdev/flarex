import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import { projectRows } from "../../query/projection";
import type { WherePolicy } from "../../query/predicate";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { QueryEnvelope } from "../../query/decoder";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { compileShippingOptionTypeDeletionContracts, ShippingOptionTypeDeletionIds, decodeShippingOptionTypeDeletionIds } from "./shipping-option-type-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const optionWhere: WherePolicy = {
  decode: commerceDecoder(Schema.Struct({ shipping_option_type_id: ShippingOptionTypeDeletionIds }), "unsupportedProfile"),
  fields: new Map([["shipping_option_type_id", { column: "shipping_option_type_id",
    decode: commerceDecoder(ShippingOptionTypeDeletionIds, "unsupportedProfile") }]]),
};

/** The module root has no Option business guard. The real workflow's Query
 * owns that guard; only its read-only Option DAL accompanies Type lifecycle. */
export function prepareShippingOptionTypeDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingOptionTypeDeletionContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.table, "ShippingOptionType", scalarIdWhere);
    const options = yield* prepareScalarRepository(contracts.option, "ShippingOption", optionWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const optionBound = options.bind(root, owner, events);
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const findOptions = Effect.fn("ShippingOptionTypeDelete.findOptions")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
        const plan = yield* Effect.fromResult(options.query(captured));
        if (plan.withDeleted || plan.paths.length || plan.query.take !== 1 || plan.query.skip !== 0 || plan.query.order.direction !== "asc" ||
          plan.projection.node.fields.size !== 1 || !plan.projection.node.fields.has("id"))
          return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const nativeOptions = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
        // Fetch and validate complete native scalar bodies before ID projection.
        // Database pagination remains one row, while count retains its real total.
        const found = yield* optionBound.find(ctx, { where: envelope.where,
          options: { ...nativeOptions, fields: contracts.option.columns.map(column => column.name) } }, true);
        for (const row of found.rows) yield* Effect.fromResult(contracts.decodeOptionRow(projectNativeRow(row)));
        if (found.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
        return [yield* Effect.fromResult(projectRows(found.rows, plan.projection.node)), found.count] satisfies [object[], number];
      });
      const runLifecycle = Effect.fn("ShippingOptionTypeDelete.lifecycle")(function* (ctx: CommerceCommandContext,
        captured: unknown, shared: Parameters<DAL.RepositoryService["softDelete"]>[1], operation: "softDelete" | "restore") {
        const ids = yield* Effect.fromResult(decodeShippingOptionTypeDeletionIds(captured));
        const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, operation);
        const roots = yield* lifecycle.roots(contracts.table, ids);
        const plan = yield* lifecycle.plan(contracts.table, roots);
        if (plan.rows(contracts.table).length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
        for (const row of plan.rows(contracts.table)) yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)));
        const result = yield* plan.apply();
        const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([result.roots, result.cascades]));
        if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
          return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* events.cascades(result.cascades, shared, row => ({ entity: row,
          originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
        return decoded;
      });
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, runLifecycle(ctx, captured, shared, operation)));
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      const optionRepository: DAL.RepositoryService = { ...denied, serialize: optionBound.repository.serialize,
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) =>
          bridge.checked(ctx, findOptions(ctx, captured)).pipe(Effect.map(value => structuredClone(value)))) };
      return { ...bound, repository, optionRepository, denied };
    };
    return { bind, contracts, optionTable: options.table, optionQuery: options.query };
  });
}
