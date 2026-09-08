import { Result, Schema } from "effect";
import { commerceError, commerceLimits } from "./model";

const ceiling = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));
const Resources = Schema.Struct({
  catalogRows: ceiling(4096), queryRows: ceiling(4096), writeBatchRows: ceiling(256),
  facts: ceiling(4096), calls: ceiling(4096), eventMessages: ceiling(2048), eventIds: ceiling(4096),
  commandBytes: ceiling(16_777_216), valueNodes: ceiling(131_072),
});
export type CommerceResources = typeof Resources.Type;

/** Existing profiles keep their exact limits and canonical contract bytes. */
export const defaultCommerceResources: CommerceResources = Object.freeze({
  catalogRows: commerceLimits.catalogRows, queryRows: commerceLimits.catalogRows,
  writeBatchRows: commerceLimits.catalogRows, facts: commerceLimits.catalogRows,
  calls: commerceLimits.calls, eventMessages: commerceLimits.calls, eventIds: commerceLimits.catalogRows,
  commandBytes: commerceLimits.commandBytes, valueNodes: 8192,
});
const decode = Schema.decodeUnknownResult(Resources, { onExcessProperty: "error" });

/** Trusted registration captures the value; command arguments never select it. */
export const captureCommerceResources = (input: unknown) => decode(input).pipe(
  Result.mapError(cause => commerceError("unsupportedProfile", cause)),
  Result.flatMap(value => value.queryRows < value.catalogRows || value.writeBatchRows > value.queryRows
    ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(Object.freeze(value))),
);
