import { Effect, Result, Schema } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { commerceServiceCommands, commerceCommandPreparation } from "../module/commands";
import { defineWorkflowMethod, type WorkflowMethod } from "../workflow/module";
import type { prepareLinkService } from "./service";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Rows = Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8));
const decodeRows = commerceDecoder(Rows, "storedCorruption");
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.JsonObject, config: Schema.JsonObject }), "invalidInput");
const decodeReadArguments = commerceDecoder(Schema.Tuple([Schema.JsonObject, Schema.JsonObject]), "invalidInput");
interface LinkWorkflowServiceDefinition {
  readonly routing: Effect.Success<ReturnType<typeof prepareLinkService>>["routing"];
  readonly createMethod: WorkflowMethod<readonly unknown[], readonly JsonObject[]>;
  readonly listMethod: WorkflowMethod<readonly unknown[], readonly JsonObject[]>;
  readonly dismissMethod?: WorkflowMethod<readonly unknown[], readonly JsonObject[]>;
}
const preparedServices = new WeakMap<object, LinkWorkflowServiceDefinition>();
export function linkWorkflowServiceDefinition(input: unknown) {
  const definition = typeof input === "object" && input !== null ? preparedServices.get(input) : undefined;
  return definition === undefined ? undefined : { ...definition, routing: structuredClone(definition.routing) };
}

/** Native Link service ABI over a single source's normal borrowed commands.
 * The composing native router owns routing/cardinality; the DAL remains local. */
export function prepareLinkWorkflowService(prepared: Effect.Success<ReturnType<typeof prepareLinkService>>, prefix: string, mutable = false) {
  return Result.gen(function* () {
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
    const result = Object.freeze({ create, list, createName, createMethod, listMethod, routing: structuredClone(prepared.routing),
      ...(mutable ? { dismiss, dismissName, dismissMethod } : {}) });
    preparedServices.set(result, { routing: structuredClone(prepared.routing), createMethod, listMethod,
      ...(mutable ? { dismissMethod } : {}) });
    return result;
  });
}
