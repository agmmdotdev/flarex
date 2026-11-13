import { Result, Schema } from "effect";
import { normalizeQueryConfig } from "@medusajs/modules-sdk/remote-query";
import { toRemoteJoinerQuery } from "@medusajs/orchestration/joiner";
import type { RemoteJoinerQuery } from "@medusajs/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { admitNativeQueryPaths, type NativeQueryMetadata } from "./native-bridge";

const Name = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/));
const Fields = Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isMaxLength(256));
const LocalFields = Schema.Array(Schema.Union([Name, Schema.Literal("*")])).check(Schema.isMaxLength(256));
const Page = Schema.Struct({ take: Schema.optionalKey(Schema.UndefinedOr(QueryLimit)), skip: Schema.optionalKey(Schema.UndefinedOr(QueryOffset)),
  order: Schema.optionalKey(Schema.UndefinedOr(Schema.Record(Name, Schema.Literals(["ASC", "DESC", "asc", "desc"])))) });
const Variables = Schema.StructWithRest(Schema.Struct({ id: Schema.optionalKey(Schema.UndefinedOr(Schema.Union([
  Schema.String, Schema.Array(Schema.UndefinedOr(Schema.String)).check(Schema.isMaxLength(256)),
]))), }), [Schema.Record(Schema.String.check(Schema.makeFilter(key => key !== "id")), Schema.Json)]);
interface SelectionNode {
  readonly fields?: readonly string[];
  readonly __args?: object;
  readonly isServiceAccess?: boolean;
  readonly [key: string]: unknown;
}
// StructWithRest also applies matching index signatures to declared fields.
// Keep transport members outside the recursive child-key domain.
const ChildName = Name.check(Schema.makeFilter(key => !["fields", "__args", "isServiceAccess"].includes(key)));
const Node: Schema.Codec<SelectionNode> = Schema.suspend(() => Schema.StructWithRest(Schema.Struct({
  fields: Schema.optionalKey(LocalFields), __args: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  isServiceAccess: Schema.optionalKey(Schema.Boolean),
}), [Schema.Record(ChildName, Node)]));
const decodeInput = commerceDecoder(Schema.Union([
  Schema.Struct({ entity: Name, fields: Fields, filters: Schema.optionalKey(Schema.UndefinedOr(Schema.JsonObject)),
    pagination: Schema.optionalKey(Schema.UndefinedOr(Page)), context: Schema.optionalKey(Schema.UndefinedOr(Schema.JsonObject)),
    withDeleted: Schema.optionalKey(Schema.UndefinedOr(Schema.Boolean)) }),
  Schema.Struct({ entryPoint: Name, fields: Fields, variables: Schema.optionalKey(Variables) }),
  Schema.Struct({ service: Name, fields: Fields, variables: Schema.optionalKey(Variables) }),
  Schema.Struct({ __value: Schema.Record(Name, Node).check(Schema.makeFilter(value => Object.keys(value).length === 1)) }),
]), "unsupportedProfile");
export const decodeNativeGraphOptions = commerceDecoder(Schema.Struct({
  throwIfKeyNotFound: Schema.optionalKey(Schema.UndefinedOr(Schema.Boolean)),
  throwIfRelationNotFound: Schema.optionalKey(Schema.UndefinedOr(Schema.Literal(false))),
  locale: Schema.optionalKey(Schema.Undefined),
  cache: Schema.optionalKey(Schema.UndefinedOr(Schema.Struct({ enable: Schema.optionalKey(Schema.UndefinedOr(Schema.Boolean)),
    tags: Schema.optionalKey(Schema.UndefinedOr(Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isMaxLength(8)))) }))),
}), "unsupportedProfile");

/** Inspect the genuine native normalized plan only for profile admission. No
 * selection tree, filter, alias, expansion or response is reconstructed here. */
export function prepareNativeGraphInput(input: unknown, metadata: NativeQueryMetadata,
  admitRoot: (name: string, service: boolean, fields?: readonly string[]) => Result.Result<void, ReturnType<typeof commerceError>>) {
  return Result.gen(function* () {
    const captured = yield* admitNativeQueryPaths(input);
    const value = yield* decodeInput(captured);
    const rootName = "entity" in value ? value.entity : "entryPoint" in value ? value.entryPoint
      : "service" in value ? value.service : Object.keys(value.__value)[0];
    if (rootName === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const service = "service" in value || "__value" in value && value.__value[rootName]?.isServiceAccess === true;
    // Flat selections must pass the owning capability check before native
    // normalization can interpret transport-shaped path components.
    yield* admitRoot(rootName, service, "fields" in value ? value.fields : undefined);
    const normalized = Reflect.apply(normalizeQueryConfig, undefined, [{ config: structuredClone(value),
      entitiesMap: metadata.entitiesMap, joinerConfigs: metadata.servicesConfig }]);
    const plan: RemoteJoinerQuery = toRemoteJoinerQuery(normalized);
    const entity = plan.service ?? plan.alias;
    if (typeof entity !== "string" || entity.length === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    // Native parsing already supplies each complete dotted expansion property.
    // These names select only the checked profile capabilities, never reads.
    const fields = [...(plan.fields ?? []), ...(plan.expands ?? []).flatMap(expand =>
      (expand.fields ?? []).map(field => `${expand.property}.${field}`))];
    if (fields.length === 0 || fields.length > 256 || (plan.expands?.length ?? 0) > 256)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return { value, plan, entity, fields, service: plan.service !== undefined };
  });
}
