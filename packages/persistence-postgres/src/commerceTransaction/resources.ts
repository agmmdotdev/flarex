import { Result, Schema } from "effect";
import { commerceError, commerceLimits } from "./model";
import { CommerceCallLimit, CommerceCommandByteLimit, commerceResourceCeilings } from "../frameworkExecutionPolicy";

const ceiling = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));
export { CommerceCallLimit } from "../frameworkExecutionPolicy";
const Resources = Schema.Struct({
  catalogRows: ceiling(commerceResourceCeilings.catalogRows), queryRows: ceiling(commerceResourceCeilings.queryRows),
  writeBatchRows: ceiling(commerceResourceCeilings.writeBatchRows), facts: ceiling(commerceResourceCeilings.facts),
  calls: CommerceCallLimit, eventMessages: ceiling(commerceResourceCeilings.eventMessages), eventIds: ceiling(commerceResourceCeilings.eventIds),
  commandBytes: CommerceCommandByteLimit, valueNodes: ceiling(commerceResourceCeilings.valueNodes),
});
export type CommerceResources = typeof Resources.Type;

/** Existing profiles keep their exact limits and canonical contract bytes. */
export const defaultCommerceResources: CommerceResources = Object.freeze({
  catalogRows: commerceLimits.catalogRows, queryRows: commerceLimits.catalogRows,
  writeBatchRows: commerceLimits.catalogRows, facts: commerceLimits.catalogRows,
  calls: commerceLimits.calls, eventMessages: commerceLimits.calls, eventIds: commerceLimits.catalogRows,
  commandBytes: commerceLimits.commandBytes, valueNodes: 8192,
});
/** Trusted logical-commerce profile for one bounded multi-page write. The
 * 2,048-row ceiling is shared with logical materialization, not request data. */
export const logicalCommerceBatchResources: CommerceResources = Object.freeze({
  ...defaultCommerceResources,
  catalogRows: 2048, queryRows: 2048, writeBatchRows: 2048, facts: 2048,
  eventIds: 2048, commandBytes: 8_388_608, valueNodes: 32_768,
});
const decode = Schema.decodeUnknownResult(Resources, { onExcessProperty: "error" });

/** Trusted registration captures the value; command arguments never select it. */
export const captureCommerceResources = (input: unknown) => decode(input).pipe(
  Result.mapError(cause => commerceError("unsupportedProfile", cause)),
  Result.flatMap(value => value.queryRows < value.catalogRows || value.writeBatchRows > value.queryRows
    ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(Object.freeze(value))),
);
