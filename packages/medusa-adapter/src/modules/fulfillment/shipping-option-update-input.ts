import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { compileShippingOptionCreationContracts, ShippingOptionId, ShippingOptionInlineType } from "./shipping-option-create-input";
import { ShippingOptionRuleCreate } from "./shipping-option-rule-input";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Managed = { created_at: Schema.optionalKey(Schema.String), updated_at: Schema.optionalKey(Schema.String),
  deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)) };
export const ShippingOptionUpdateRule = Schema.Struct({ ...ShippingOptionRuleCreate.fields, ...Managed });
export const ShippingOptionUpdateType = Schema.Struct({ id: Schema.optionalKey(ShippingOptionId),
  label: Schema.optionalKey(Schema.String), code: Schema.optionalKey(Schema.String),
  description: ShippingOptionInlineType.fields.description, ...Managed });
export const ShippingOptionUpdate = Schema.Struct({ id: ShippingOptionId,
  name: Schema.optionalKey(Schema.String), price_type: Schema.optionalKey(Schema.Literals(["flat", "calculated"])),
  service_zone_id: Schema.optionalKey(ShippingOptionId), shipping_profile_id: Schema.optionalKey(Schema.NullOr(ShippingOptionId)),
  provider_id: Schema.optionalKey(Schema.NullOr(ShippingOptionId)), shipping_option_type_id: Schema.optionalKey(ShippingOptionId),
  type_id: Schema.optionalKey(ShippingOptionId), type: Schema.optionalKey(Schema.Union([ShippingOptionId, ShippingOptionUpdateType])),
  data: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)), metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  rules: Schema.optionalKey(Schema.Array(ShippingOptionUpdateRule).pipe(Schema.mutable).check(Schema.isMaxLength(4))), ...Managed });
/** The same genuine upsert receives detached forward updates and native retained
 * projections. Identities and managed fields are checked again by shared writes. */
export const ShippingOptionUpdates = Schema.Array(ShippingOptionUpdate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionUpdateIds = Schema.Array(ShippingOptionId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionUpdateFilters = Schema.Struct({ id: Schema.optionalKey(Schema.Union([ShippingOptionId, ShippingOptionUpdateIds])) });
export const ShippingOptionUpdateReadConfig = Schema.Struct({ ...NativePreimageConfig.fields, take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })) });
export const ShippingOptionUpdateReadInput = Schema.Struct({ filters: Schema.optionalKey(ShippingOptionUpdateFilters), config: Schema.optionalKey(ShippingOptionUpdateReadConfig) });
export const decodeShippingOptionUpdates = commerceDecoder(ShippingOptionUpdates, "invalidInput");
export const decodeShippingOptionUpdateRead = commerceDecoder(ShippingOptionUpdateReadInput, "invalidInput");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function compileShippingOptionUpdateContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const creation = yield* compileShippingOptionCreationContracts(metadata);
    const optionProjection = yield* compileRowProjection(creation.option), ruleProjection = yield* compileRowProjection(creation.rule),
      typeProjection = yield* compileRowProjection(creation.type);
    const objects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(16)), "storedCorruption");
    const identified = (input: unknown, entity: typeof creation.optionEntity, full: boolean) => Result.gen(function* () {
      const projection = entity === creation.optionEntity ? optionProjection : entity === creation.ruleEntity ? ruleProjection : typeProjection;
      const row = yield* (full ? entity.decodeRow(input) : projection(input));
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256 || row.deleted_at !== undefined && row.deleted_at !== null)
        return yield* Result.fail(commerceError("storedCorruption"));
      const result: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return result;
    });
    const decodeRows = (input: unknown, full: boolean) => Result.gen(function* () {
      const rows = yield* objects(input), roots = new Set<string>(), children = new Set<string>(), output: Array<JsonObject & { readonly id: string }> = [];
      if (rows.length > 4) return yield* Result.fail(commerceError("storedCorruption"));
      for (const value of rows) {
        const { rules, type, provider, shipping_profile, ...scalar } = value, row = yield* identified(scalar, creation.optionEntity, full);
        if (provider !== undefined && (provider !== null || row.provider_id !== null) ||
          shipping_profile !== undefined && (shipping_profile !== null || row.shipping_profile_id !== null))
          return yield* Result.fail(commerceError("storedCorruption"));
        if (roots.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
        roots.add(row.id);
        if (rules !== undefined) {
          const members = yield* objects(rules);
          if (members.length > 4) return yield* Result.fail(commerceError("storedCorruption"));
          for (const member of members) {
            const child = yield* identified(member, creation.ruleEntity, full);
            if (children.has(child.id) || child.shipping_option_id !== undefined && child.shipping_option_id !== row.id)
              return yield* Result.fail(commerceError("storedCorruption"));
            children.add(child.id);
          }
        }
        if (type !== undefined && type !== null) {
          const child = yield* identified(type, creation.typeEntity, full);
          if (row.shipping_option_type_id !== undefined && child.id !== row.shipping_option_type_id)
            return yield* Result.fail(commerceError("storedCorruption"));
        }
        output.push({ ...value, id: row.id });
      }
      return output;
    });
    const decodeRuleRows = (input: unknown, full = true) => Result.gen(function* () {
      const rows = yield* objects(input), output: Array<JsonObject & { readonly id: string }> = [], seen = new Set<string>();
      for (const row of rows) {
        const decoded = yield* identified(row, creation.ruleEntity, full);
        if (seen.has(decoded.id)) return yield* Result.fail(commerceError("storedCorruption"));
        seen.add(decoded.id); output.push(decoded);
      }
      return output;
    });
    const entities = creation.entities.map(entity => entity.table === creation.type ? { ...entity, maximum: 8 } : entity);
    return { ...creation, entities, optionProjection, ruleProjection, typeProjection, identified,
      decodeRows: (input: unknown) => decodeRows(input, true), decodePreimages: (input: unknown) => decodeRows(input, false), decodeRuleRows };
  });
}
