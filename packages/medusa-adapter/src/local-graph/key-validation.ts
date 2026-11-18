import { Effect, Result, Schema } from "effect";
import { validateNativeQueryKeys, validateNativeQueryPrimaryKey } from "@medusajs/orchestration/joiner-key-validation";
import { MedusaError } from "@medusajs/utils/common/errors";
import { capturePrivateJsonData, commerceError, commerceLimits, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import type { GraphReadDefinition } from "./model";

export const GraphKeyOptions = Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true) });
const decodeOptions = commerceDecoder(GraphKeyOptions, "unsupportedProfile");
const Key = Schema.String.check(Schema.isMaxLength(256));
const decodeKeys = commerceDecoder(Schema.Union([Key, Schema.Array(Key).check(Schema.isMaxLength(commerceLimits.catalogRows))]), "unsupportedProfile");

/** Key validation does not select another cohort or grant relation failures.
 * Native business checks run separately, before selector-shape admission. */
export function prepareGraphKeyValidation(read: GraphReadDefinition, filters: JsonObject | undefined, options: unknown) {
  return Result.gen(function* () {
    if (options === undefined) return undefined;
    const captured = yield* capturePrivateJsonData(options, commerceLimits.commandBytes, commerceError);
    const checked = yield* decodeOptions(captured.value);
    const pkField = read.table.primaryKeys[0];
    if (pkField === undefined || read.table.primaryKeys.length !== 1) return yield* Result.fail(commerceError("unsupportedProfile"));
    const serviceConfig = { serviceName: read.model, entity: read.model, primaryKeys: [pkField] };
    const primaryKeyArg = filters !== undefined && Object.hasOwn(filters, pkField) ? { name: pkField, value: filters[pkField] } : undefined;
    return { pkField, serviceConfig, primaryKeyArg, options: checked };
  });
}

const nativeValidation = Effect.fn("LocalGraph.nativeKeyValidation")(function* (check: () => void) {
  yield* Effect.try({ try: check, catch: cause => {
    // The selected pure helper originates only NOT_FOUND. Its native error
    // recognition survives loading paths; this does not classify arbitrary Causes.
    if (MedusaError.isMedusaError(cause) && cause.type === MedusaError.Types.NOT_FOUND)
      return commerceError("adapterFailure", cause);
    // Unknown native throws are defects, never missing-key business failures.
    throw cause;
  } });
});

export function validateGraphPrimaryKey(plan: NonNullable<Result.Result.Success<ReturnType<typeof prepareGraphKeyValidation>>>) {
  return nativeValidation(() => validateNativeQueryPrimaryKey(plan.serviceConfig, plan.primaryKeyArg, plan.options));
}
export function prepareGraphKeys(plan: NonNullable<Result.Result.Success<ReturnType<typeof prepareGraphKeyValidation>>>) {
  return decodeKeys(plan.primaryKeyArg?.value).pipe(Result.map(value => [...new Set(typeof value === "string" ? [value] : value)]));
}
export function validateGraphKeys(input: Parameters<typeof validateNativeQueryKeys>[0]) {
  return nativeValidation(() => validateNativeQueryKeys(input));
}
