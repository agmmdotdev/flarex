import { Result, Schema, type Effect } from "effect";
import { describeToManyRelation, fillEmptyToManyRelations, fillNullToOneRelations } from "@medusajs/drizzle/relation-query";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { assembleCommerceRelations, type CommerceRelations, type CommerceRelation } from "../../query/relations";
import { compileFulfillmentGraphContracts, type FulfillmentPhysicalProfile } from "./fulfillment-graph-contracts";
import { ShippingOptionRuleCreate } from "./shipping-option-rule-input";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

export const ShippingOptionId = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ShippingOptionInlineType = Schema.Struct({ label: Schema.String, code: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)) });
// No supplied Option, Type or Rule identities are admitted by this creation
// profile. In particular, native `{ type: { id } }` updates that Type's timestamp;
// it is refused here. The executing workflow turns declared type_id into a
// scalar type reference before calling native upsert, preserving that branch.
export const ShippingOptionInlineRule = Schema.Struct({ attribute: ShippingOptionRuleCreate.fields.attribute,
  operator: ShippingOptionRuleCreate.fields.operator, value: ShippingOptionRuleCreate.fields.value });
export const ShippingOptionCreate = Schema.Struct({ name: Schema.String, price_type: Schema.Literals(["flat", "calculated"]),
  service_zone_id: ShippingOptionId, shipping_profile_id: ShippingOptionId, provider_id: ShippingOptionId,
  type: Schema.optionalKey(Schema.Union([ShippingOptionId, ShippingOptionInlineType])), type_id: Schema.optionalKey(ShippingOptionId),
  data: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)), metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  rules: Schema.optionalKey(Schema.Array(ShippingOptionInlineRule).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
  // The native workflow forwards prices to Fulfillment. Scalar persistence
  // ignores this Pricing-owned field; the root's price decoder owns its grammar.
  prices: Schema.optionalKey(Schema.Array(Schema.JsonObject).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
});
export const ShippingOptionCreates = Schema.Array(ShippingOptionCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionPhysicalIds = Schema.Array(ShippingOptionId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeShippingOptionCreates = commerceDecoder(ShippingOptionCreates, "invalidInput");
export const decodeShippingOptionPhysicalIds = commerceDecoder(ShippingOptionPhysicalIds, "invalidInput");
export const decodeShippingOptionPhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: ShippingOptionId })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");
const decodeObjects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeEmpty = commerceDecoder(Schema.Array(Schema.Never), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function compileShippingOptionCreationContracts(metadata: Metadata, profileSelection: FulfillmentPhysicalProfile = "standalone") {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentGraphContracts(metadata, profileSelection), { option, rule, zone, set } = graph;
    const type = metadata.tables.find(table => table.name === "shipping_option_type"),
      profile = metadata.tables.find(table => table.name === "shipping_profile"), provider = metadata.tables.find(table => table.name === "fulfillment_provider");
    if (type === undefined || profile === undefined || provider === undefined || option.cascades.delete.length !== 1 || option.cascades.delete[0] !== "rules" ||
      option.columns.find(column => column.name === "id")?.options?.prefix !== "so") return yield* Result.fail(commerceError("unsupportedProfile"));
    const rules = describeToManyRelation(option, "rules", metadata.tables);
    if (rules?.targetTable !== rule.name || rules.join.type !== "hasMany" || rules.join.foreignKeys[0] !== "shipping_option_id" || rules.join.foreignKeys.length !== 1)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const one = (source: typeof option, name: string, target: typeof type, foreignKey: string) => Result.gen(function* () {
      const relationship = source.relationships.find(value => value.name === name);
      if (relationship?.type !== "belongsTo" || !source.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === foreignKey &&
        key.referencedTable === target.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      return { name, sourcePrimaryKeys: ["id"], targetTable: target.name, targetPrimaryKeys: ["id"],
        join: { type: "belongsTo" as const, foreignKeys: [foreignKey] } };
    });
    const typeRelation = yield* one(option, "type", type, "shipping_option_type_id"),
      setRelation = yield* one(zone, "fulfillment_set", set, "fulfillment_set_id");
    const relations: CommerceRelations = new Map([[option.name, new Map<string, CommerceRelation>([["type", typeRelation], ["rules", rules]])],
      [zone.name, new Map([["fulfillment_set", setRelation]])]]);
    const entities = [];
    for (const [table, model, maximum] of [[type, "ShippingOptionType", 4], [option, "ShippingOption", 4], [rule, "ShippingOptionRule", 16],
      [zone, "ServiceZone", 4], [set, "FulfillmentSet", 4], [profile, "ShippingProfile", 4], [provider, "FulfillmentProvider", 8]] as const)
      entities.push({ table, model, maximum, decodeRow: yield* compileCompleteRow(table) });
    const optionEntity = entities.find(entity => entity.table === option), typeEntity = entities.find(entity => entity.table === type), ruleEntity = entities.find(entity => entity.table === rule);
    if (optionEntity === undefined || typeEntity === undefined || ruleEntity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const descriptors = new Map(option.relationships.map(relationship => [relationship.name, { relationship,
      ownerForeignKeys: option.foreignKeys.filter(key => key.columns[0] === (relationship.name === "provider" ? "provider_id" :
        relationship.name === "shipping_profile" ? "shipping_profile_id" : "")).flatMap(key => key.columns) }]));
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeObjects(input), identities = new Set<string>();
      for (const value of rows) {
        const { type: nestedType, rules: nestedRules, fulfillments, provider: nestedProvider, shipping_profile: nestedProfile, ...scalar } = value;
        const row = yield* optionEntity.decodeRow(scalar);
        if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256 || identities.has(row.id) || row.deleted_at !== null || !Object.hasOwn(value, "type"))
          return yield* Result.fail(commerceError("storedCorruption"));
        identities.add(row.id); yield* decodeEmpty(fulfillments);
        if (nestedType !== undefined && nestedType !== null) {
          const target = yield* typeEntity.decodeRow(nestedType);
          if (target.id !== row.shipping_option_type_id || target.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
        }
        if (nestedProvider !== undefined && (nestedProvider !== null || row.provider_id !== null) ||
          nestedProfile !== undefined && (nestedProfile !== null || row.shipping_profile_id !== null)) return yield* Result.fail(commerceError("storedCorruption"));
        const children = yield* decodeObjects(nestedRules), seen = new Set<string>();
        for (const child of children) {
          const decoded = yield* ruleEntity.decodeRow(child);
          if (typeof decoded.id !== "string" || seen.has(decoded.id) || decoded.shipping_option_id !== row.id || decoded.deleted_at !== null)
            return yield* Result.fail(commerceError("storedCorruption"));
          seen.add(decoded.id);
        }
      }
      return rows;
    });
    const initializeRows = (rows: ReadonlyMap<string, readonly JsonObject[]>, includeType: boolean) => Result.gen(function* () {
      const result = assembleCommerceRelations(option.name, rows, [...(includeType ? ["type"] : []), "rules"], relations);
      fillNullToOneRelations(result, descriptors); fillEmptyToManyRelations(result, descriptors);
      return yield* decodeRows(result);
    });
    return { ...graph, tables: metadata.tables, type, profile, provider, entities, optionEntity, typeEntity, ruleEntity, relations, setRelation, rules,
      physicalEntities: [optionEntity, ruleEntity, ...graph.referenceEntities], decodeRows, initializeRows };
  });
}
