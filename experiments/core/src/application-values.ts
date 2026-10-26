import { Result, Schema } from "effect";
import { AppCreationTimeV1Schema } from "../../../packages/flarex-protocol/src/app-document.ts";
import type { Definition } from "./definition.ts";
import { CoreError } from "./errors.ts";

/** One owner for the currently supported Application value profile. Shared
 * framework metadata must not silently widen either standalone or mixed App. */
export function admitApplicationDefinition(definition: Definition) {
  return definition.tableId === null || definition.fields.some(field => field.nullable || field.kind !== "text" && field.kind !== "number")
    ? Result.fail(new CoreError({ reason: "unsupported" })) : Result.succeed(definition.tableId);
}

/** Application identity uses the exact database-seeded binary64 cursor. This
 * is independent of a framework's ISO timestamp fields. */
export const CreationTime = AppCreationTimeV1Schema;
export function nextCreationTime(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  view.setBigUint64(0, view.getBigUint64(0, false) + 1n, false);
  return Schema.decodeUnknownSync(CreationTime)(view.getFloat64(0, false));
}
