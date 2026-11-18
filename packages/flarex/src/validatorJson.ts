import { isNonArrayRecord } from "@flarex/utils/records";
import { decodeValidatorJsonWireV1 } from "flarex-protocol/validator-json";

import type { ValidatorJSON } from "./values.ts";

export { decodeValidatorJsonWireV1 };
export type { ValidatorJsonWireV1 } from "flarex-protocol/validator-json";

/** Parsed SDK export JSON enters through the protocol-owned wire decoder. */
export function assertValidatorJson(
  value: unknown,
  path = "$validator",
): ValidatorJSON | null {
  if (value === null) return null;
  if (!isNonArrayRecord(value)) {
    throw new Error(`${path}: Expected validator object.`);
  }
  try {
    return decodeValidatorJsonWireV1(value);
  } catch (cause) {
    throw new Error(`${path}: Invalid validator JSON.`, { cause });
  }
}
