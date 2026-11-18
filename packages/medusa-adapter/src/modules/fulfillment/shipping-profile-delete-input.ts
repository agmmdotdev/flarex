import { Result, Schema, type Effect } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ShippingProfileDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeShippingProfileDeletionIds = commerceDecoder(ShippingProfileDeletionIds, "invalidInput");
export const decodeShippingProfileDeletionArguments = commerceDecoder(Schema.Tuple([ShippingProfileDeletionIds]), "invalidInput");
export const decodeShippingProfileDeletionOutput = commerceDecoder(Schema.Struct({
  shipping_profile_id: Schema.optionalKey(ShippingProfileDeletionIds),
}), "storedCorruption");
const decodeTupleShape = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Struct({ ShippingProfile: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMinLength(1), Schema.isMaxLength(4))) }),
]), "storedCorruption");

type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];

/** Native Option bodies and real inverse-FK metadata support deletion's read
 * guard. Only ShippingProfile is a lifecycle entity; no Option cascade exists. */
export function compileShippingProfileDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const profile = metadata.tables.find(table => table.name === "shipping_profile");
    const option = metadata.tables.find(table => table.name === "shipping_option");
    if (metadata.tables.length !== 6 || profile === undefined || option === undefined || profile.foreignKeys.length ||
      profile.relationships.length !== 1 || profile.relationships.some(relation => relation.cascadeDelete) ||
      profile.cascades.delete.length || profile.cascades.detach.length)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relation = describeToManyRelation(profile, "shipping_options", metadata.tables);
    if (relation?.targetTable !== option.name || relation.join.type !== "hasMany" ||
      relation.sourcePrimaryKeys.length !== 1 || relation.sourcePrimaryKeys[0] !== "id" ||
      relation.targetPrimaryKeys.length !== 1 || relation.targetPrimaryKeys[0] !== "id" ||
      relation.join.foreignKeys.length !== 1 || relation.join.foreignKeys[0] !== "shipping_profile_id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const completeProfile = yield* compileCompleteRow(profile), completeOption = yield* compileCompleteRow(option);
    const identified = (decode: typeof completeProfile, input: unknown) => Result.gen(function* () {
      const row = yield* decode(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const decodeProfileRow = (input: unknown) => identified(completeProfile, input);
    const decodeOptionRow = (input: unknown) => identified(completeOption, input);
    const entities = [{ table: profile, model: "ShippingProfile", linkableKey: "shipping_profile_id", maximum: 4, decodeRow: decodeProfileRow }];
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const tuple = yield* decodeTupleShape(input);
      if (!jsonEqual(tuple[0], tuple[1].ShippingProfile ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      for (const row of tuple[0]) yield* decodeProfileRow(row);
      const cascades: Record<string, object[]> = {};
      if (tuple[1].ShippingProfile !== undefined) cascades.ShippingProfile = tuple[1].ShippingProfile.map(row => ({ ...row }));
      return [tuple[0].map(row => ({ ...row })), cascades] satisfies [object[], Record<string, unknown[]>];
    });
    return { profile, option, entities, relation, decodeProfileRow, decodeOptionRow, decodeLifecycleResult,
      decodeOutput: decodeShippingProfileDeletionOutput };
  });
}
