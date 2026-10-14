import { Effect, Result, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { commerceServiceCommands } from "./service-commands";
import { defineWorkflowMethod } from "./workflow/module";
import type { prepareLinkService } from "./link-service";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Rows = Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8));
const decodeRows = commerceDecoder(Rows, "storedCorruption");
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.JsonObject, config: Schema.JsonObject }), "invalidInput");
const decodeReadArguments = commerceDecoder(Schema.Tuple([Schema.JsonObject, Schema.JsonObject]), "invalidInput");

/** Native Link service ABI over a single source's normal borrowed commands.
 * The composing native router owns routing/cardinality; the DAL remains local. */
export function prepareLinkWorkflowService(prepared: Effect.Success<ReturnType<typeof prepareLinkService>>, prefix: string) {
  return Result.gen(function* () {
    const extras = Schema.Struct({ id: Schema.optionalKey(Id),
      ...Object.fromEntries(Object.keys(prepared.joiner.databaseConfig?.extraFields ?? {}).map(name =>
        [name, Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 })))])),
    });
    const Bulk = Schema.Array(Schema.Union([Schema.Tuple([Id, Id]), Schema.Tuple([Id, Id, extras])])).check(Schema.isMaxLength(8));
    const decodeBulk = commerceDecoder(Bulk, "invalidInput");
    const decodeArguments = commerceDecoder(Schema.Tuple([Bulk]), "invalidInput");
    const prepare = <Value>(decode: (value: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
      Effect.fn("LinkWorkflow.prepare")((ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(
        Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
    const commands = commerceServiceCommands(prepared.useService);
    const createName = prefix + "NativeCreate";
    const create = commands.write(createName, prepare(decodeBulk), ({ service, context }, bulk) => service.create(
      bulk.map((row): [string, string, Record<string, unknown>?] => row.length === 2 ? [row[0], row[1]] : [row[0], row[1], { ...row[2] }]), undefined, undefined, context));
    const list = commands.read(prefix + "NativeList", prepare(decodeRead), ({ service, context }, input) => service.list(input.filters, input.config, context));
    const createMethod = yield* defineWorkflowMethod({ command: create, arguments: decodeArguments, encode: ([bulk]) => bulk,
      output: decodeRows, moduleEvents: [prepared.entityName + ".attached"] });
    const listMethod = yield* defineWorkflowMethod({ command: list, arguments: decodeReadArguments, encode: ([filters, config]) => ({ filters, config }), output: decodeRows });
    return { create, list, createName, createMethod, listMethod, routing: prepared.routing };
  });
}
