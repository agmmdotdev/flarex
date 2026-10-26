import { Schema } from "effect";
import { AppCreationTimeV1Schema } from "../../../packages/flarex-protocol/src/app-document.ts";

/** Application identity uses the exact database-seeded binary64 cursor. This
 * is independent of a framework's ISO timestamp fields. */
export const CreationTime = AppCreationTimeV1Schema;
export function nextCreationTime(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  view.setBigUint64(0, view.getBigUint64(0, false) + 1n, false);
  return Schema.decodeUnknownSync(CreationTime)(view.getFloat64(0, false));
}
