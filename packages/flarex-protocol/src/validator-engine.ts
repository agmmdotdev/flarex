import { Data, Result } from "effect";

import {
  validateValidatorValueIssueV1,
  type ValidateValidatorValueV1Options,
  type ValidatorValueIssueV1,
} from "./validator-engine-core";
import type { CanonicalFlarexRuntimeValueV1 } from "./value";
import type { ValidatorJsonV1 } from "./validator-json";

export type {
  ValidateValidatorValueV1Options,
  ValidatorIdPolicyV1,
  ValidatorValueExpectedV1,
  ValidatorValueIssueV1,
} from "./validator-engine-core";

export class ValidatorValueErrorV1 extends Data.TaggedError(
  "ValidatorValueErrorV1",
)<{
  readonly issue: ValidatorValueIssueV1;
}> {}

/**
 * Effect Result adapter over the protocol-owned, Effect-free validation core.
 * Unknown-input decoding and resource limits belong to Value Codec V1.
 */
export function validateValidatorValueV1(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  options: ValidateValidatorValueV1Options,
): Result.Result<void, ValidatorValueErrorV1> {
  const issue = validateValidatorValueIssueV1(validator, value, options);
  return issue === undefined
    ? Result.succeed(undefined)
    : Result.fail(new ValidatorValueErrorV1({ issue }));
}
