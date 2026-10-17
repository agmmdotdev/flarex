import { Effect, Result, Schema } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { commerceServiceCommands, commerceCommandPreparation } from "../module/commands";
import { defineWorkflowMethod, type WorkflowMethod } from "../workflow/module";
import { linkServiceLifecycleDefinition, type prepareLinkService } from "./service";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Rows = Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8));
const decodeRows = commerceDecoder(Rows, "storedCorruption");
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.JsonObject, config: Schema.JsonObject }), "invalidInput");
const decodeReadArguments = commerceDecoder(Schema.Tuple([Schema.JsonObject, Schema.JsonObject]), "invalidInput");
interface LinkWorkflowServiceDefinition {
  readonly admission: "create" | "dismiss" | "cascade" | "product-deletions" | "inventory-deletions" | "inventory-item-deletions" | "sales-channel-deletions" | "stock-location-deletions" | "shipping-profile-deletions";
  readonly routing: Effect.Success<ReturnType<typeof prepareLinkService>>["routing"];
  readonly lifecycle: Effect.Success<ReturnType<typeof prepareLinkService>>["lifecycle"];
  readonly createMethod: WorkflowMethod<readonly unknown[], readonly JsonObject[]>;
  readonly listMethod: WorkflowMethod<readonly unknown[], readonly JsonObject[]>;
  readonly dismissMethod?: WorkflowMethod<readonly unknown[], readonly JsonObject[]>;
  readonly softDeleteMethod?: WorkflowMethod;
  readonly restoreMethod?: WorkflowMethod;
}
const preparedServices = new WeakMap<object, LinkWorkflowServiceDefinition>();
export function linkWorkflowServiceDefinition(input: unknown) {
  const definition = typeof input === "object" && input !== null ? preparedServices.get(input) : undefined;
  return definition === undefined ? undefined : { ...definition, routing: structuredClone(definition.routing),
    lifecycle: Object.freeze({ ...definition.lifecycle }) };
}

/** Native Link service ABI over a single source's normal borrowed commands.
 * The composing native router owns routing/cardinality; the DAL remains local. */
export function prepareLinkWorkflowService(prepared: Effect.Success<ReturnType<typeof prepareLinkService>>, prefix: string,
  admission: LinkWorkflowServiceDefinition["admission"] = "create") {
  return Result.gen(function* () {
    const lifecycle = linkServiceLifecycleDefinition(prepared);
    if (lifecycle === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if ((admission === "inventory-item-deletions" || admission === "shipping-profile-deletions") && (lifecycle.maximumRows !== 8 || lifecycle.completeHistory !== true))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const extras = Schema.Struct({ id: Schema.optionalKey(Id),
      ...Object.fromEntries(Object.keys(prepared.joiner.databaseConfig?.extraFields ?? {}).map(name =>
        [name, Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 })))])),
    });
    const Bulk = Schema.Array(Schema.Union([Schema.Tuple([Id, Id]), Schema.Tuple([Id, Id, extras])])).check(Schema.isMaxLength(8));
    const decodeBulk = commerceDecoder(Bulk, "invalidInput");
    const decodeArguments = commerceDecoder(Schema.Tuple([Bulk]), "invalidInput");
    const prepare = commerceCommandPreparation("LinkWorkflow.prepare");
    const commands = commerceServiceCommands(prepared.useService);
    const createName = prefix + "NativeCreate";
    const create = commands.write(createName, prepare(decodeBulk), ({ service, context }, bulk) => service.create(
      bulk.map((row): [string, string, Record<string, unknown>?] => row.length === 2 ? [row[0], row[1]] : [row[0], row[1], { ...row[2] }]), undefined, undefined, context));
    const list = commands.read(prefix + "NativeList", prepare(decodeRead), ({ service, context }, input) => service.list(input.filters, input.config, context));
    const createMethod = yield* defineWorkflowMethod({ command: create, arguments: decodeArguments, encode: ([bulk]) => bulk,
      output: decodeRows, moduleEvents: [prepared.entityName + ".attached"] });
    const listMethod = yield* defineWorkflowMethod({ command: list, arguments: decodeReadArguments, encode: ([filters, config]) => ({ filters, config }), output: decodeRows });
    const Pairs = Schema.Array(Schema.Tuple([Id, Id])).check(Schema.isMaxLength(8));
    const decodeDismiss = commerceDecoder(Pairs, "invalidInput");
    const decodeDismissArguments = commerceDecoder(Schema.Tuple([Pairs]), "invalidInput");
    const dismissName = prefix + "NativeDismiss";
    const dismiss = commands.write(dismissName, prepare(decodeDismiss), ({ service, context }, bulk) =>
      service.dismiss(bulk.map((row): [string, string] => [row[0], row[1]]), undefined, context));
    const dismissMethod = yield* defineWorkflowMethod({ command: dismiss, arguments: decodeDismissArguments,
      encode: ([pairs]) => pairs, output: decodeRows, moduleEvents: [prepared.entityName + ".detached"] });
    const [primary, foreign] = prepared.joiner.relationships ?? [];
    if (primary === undefined || foreign === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const endpointIds = Schema.Array(Id).check(Schema.isMaxLength(4));
    const reverseIds = Schema.Array(Id).check(Schema.isMaxLength(admission === "inventory-deletions" ? 8 : 4));
    const Endpoint = admission === "shipping-profile-deletions" ? Schema.Struct({ [foreign.foreignKey]: reverseIds })
      : Schema.Union([Schema.Struct({ [primary.foreignKey]: endpointIds }), Schema.Struct({ [foreign.foreignKey]: reverseIds })]);
    const ReturnKeys = Schema.Struct({ returnLinkableKeys: Schema.Array(Schema.Literals(["id", primary.foreignKey, foreign.foreignKey])).check(Schema.isLengthBetween(3, 3)) });
    const decodeSoftDelete = commerceDecoder(Schema.Struct({ selector: Endpoint, config: ReturnKeys }), "invalidInput");
    const decodeSoftDeleteArguments = commerceDecoder(Schema.Tuple([Endpoint, ReturnKeys]), "invalidInput");
    const softDeleteName = prefix + "NativeSoftDelete";
    const softDelete = commands.write(softDeleteName, prepare(decodeSoftDelete), ({ service, context }, input) =>
      service.softDelete(input.selector, { returnLinkableKeys: [...input.config.returnLinkableKeys] }, context));
    const decodeLifecycle = commerceDecoder(Schema.Struct({ [primary.foreignKey]: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
      [foreign.foreignKey]: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))) }), "storedCorruption");
    const softDeleteMethod = yield* defineWorkflowMethod({ command: softDelete, arguments: decodeSoftDeleteArguments,
      encode: ([selector, config]) => ({ selector, config }),
      output: decodeLifecycle,
      moduleEvents: [prepared.entityName + ".detached"] });
    // Restoration belongs to the connected endpoint-deletion profiles, whose
    // retained native compensators supply the authenticated forward endpoint.
    const restoration = (admission === "inventory-item-deletions" || admission === "sales-channel-deletions" || admission === "stock-location-deletions" || admission === "shipping-profile-deletions") ? yield* Result.gen(function* () {
      const restoreName = prefix + "NativeRestore";
      const restore = commands.write(restoreName, prepare(decodeSoftDelete), ({ service, context }, input) =>
        service.restore(input.selector, { returnLinkableKeys: [...input.config.returnLinkableKeys] }, context));
      const restoreMethod = yield* defineWorkflowMethod({ command: restore, arguments: decodeSoftDeleteArguments,
        encode: ([selector, config]) => ({ selector, config }), output: decodeLifecycle,
        moduleEvents: [prepared.entityName + ".attached"] });
      return { restore, restoreName, restoreMethod };
    }) : undefined;
    const deletes = admission === "cascade" || admission === "product-deletions" || admission === "inventory-deletions" || admission === "inventory-item-deletions" || admission === "sales-channel-deletions" || admission === "stock-location-deletions" || admission === "shipping-profile-deletions";
    const result = Object.freeze({ create, list, createName, createMethod, listMethod, routing: structuredClone(prepared.routing),
      ...(admission === "create" ? {} : { dismiss, dismissName, dismissMethod }),
      ...(deletes ? { softDelete, softDeleteName, softDeleteMethod } : {}), ...restoration });
    preparedServices.set(result, { admission, lifecycle, routing: structuredClone(prepared.routing), createMethod, listMethod,
      ...(admission === "create" ? {} : { dismissMethod }), ...(deletes ? { softDeleteMethod } : {}), ...(restoration === undefined ? {} : { restoreMethod: restoration.restoreMethod }) });
    return result;
  });
}
