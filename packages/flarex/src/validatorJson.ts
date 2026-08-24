import { isNonArrayRecord } from "@flarex/utils/records";
import { decodeValidatorJsonV1 } from "flarex-protocol/validator-json";

import type { ValidatorJSON } from "./values.ts";

/** Compatibility projection over the protocol-owned bounded decoder. */
export function assertValidatorJson(
  value: unknown,
  path = "$validator",
): ValidatorJSON | null {
  if (value === null) return null;
  if (!isNonArrayRecord(value)) {
    throw new Error(`${path}: Expected validator object.`);
  }
  try {
    return decodeValidatorJsonV1(value);
  } catch (cause) {
    throw new Error(`${path}: Invalid validator JSON.`, { cause });
  }
}
