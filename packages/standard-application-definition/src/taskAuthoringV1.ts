import { Result } from "effect";

import {
  decodeCanonicalTaskManifestV1,
  type CanonicalTaskComputeProfileInputV1,
  type CanonicalTaskManifestV1,
  type CanonicalTaskRunAttemptPolicyInputV1,
  type InvalidStandardApplicationTaskDefinitionV1Error,
  type TaskIdV1,
} from "./taskDefinition/v1.js";
import type {
  InferStandardValidatorV1,
  StandardValidatorV1,
} from "./authoringV1.js";

type RequiredStandardTaskValidatorV1 = StandardValidatorV1<
  unknown,
  "required"
>;

declare const StandardApplicationTaskReferenceTypeV1: unique symbol;

/**
 * Typed producer evidence for one canonical Task identity. Active selection
 * and the selected canonical manifest remain the runtime authorities.
 */
export interface StandardApplicationTaskReferenceV1<Payload, Output> {
  readonly taskId: TaskIdV1;
  readonly [StandardApplicationTaskReferenceTypeV1]: Readonly<{
    readonly payload: Payload;
    readonly output: Output;
  }>;
}

class StandardApplicationTaskReference<Payload, Output>
  implements StandardApplicationTaskReferenceV1<Payload, Output>
{
  declare readonly [StandardApplicationTaskReferenceTypeV1]: Readonly<{
    readonly payload: Payload;
    readonly output: Output;
  }>;

  constructor(readonly taskId: TaskIdV1) {
    Object.freeze(this);
  }
}

export type InferStandardApplicationTaskPayloadV1<Reference> =
  Reference extends StandardApplicationTaskReferenceV1<infer Payload, unknown>
    ? Payload
    : never;

export type InferStandardApplicationTaskOutputV1<Reference> =
  Reference extends StandardApplicationTaskReferenceV1<unknown, infer Output>
    ? Output
    : never;

type InferOutputValidatorV1<
  Validator extends RequiredStandardTaskValidatorV1 | null,
> = Validator extends RequiredStandardTaskValidatorV1
  ? InferStandardValidatorV1<Validator>
  : unknown;

export interface StandardApplicationTaskDefinitionInputV1<
  PayloadValidator extends RequiredStandardTaskValidatorV1,
  OutputValidator extends RequiredStandardTaskValidatorV1 | null,
> {
  readonly taskId: unknown;
  readonly handler: CanonicalTaskManifestV1["handler"];
  readonly payload: PayloadValidator;
  readonly output: OutputValidator;
  readonly runAttemptPolicy: CanonicalTaskRunAttemptPolicyInputV1;
  readonly maximumDurationInSeconds:
    CanonicalTaskManifestV1["maximumDurationInSeconds"];
  readonly computeProfile: CanonicalTaskComputeProfileInputV1;
  readonly queue: CanonicalTaskManifestV1["queue"];
}

export interface StandardApplicationTaskDefinitionV1<Payload, Output> {
  readonly manifest: CanonicalTaskManifestV1;
  readonly reference: StandardApplicationTaskReferenceV1<Payload, Output>;
}

/**
 * Lowers typed Standard validators into the canonical Task manifest owner.
 * This constructor does not activate, select, publish, or schedule the Task.
 */
export function defineStandardApplicationTaskV1<
  PayloadValidator extends RequiredStandardTaskValidatorV1,
  OutputValidator extends RequiredStandardTaskValidatorV1 | null,
>(
  input: StandardApplicationTaskDefinitionInputV1<
    PayloadValidator,
    OutputValidator
  >,
): Result.Result<
  StandardApplicationTaskDefinitionV1<
    InferStandardValidatorV1<PayloadValidator>,
    InferOutputValidatorV1<OutputValidator>
  >,
  InvalidStandardApplicationTaskDefinitionV1Error
> {
  return decodeCanonicalTaskManifestV1({
    version: 1,
    taskId: input.taskId,
    handler: input.handler,
    payloadValidator: input.payload.json,
    outputValidator: input.output === null ? null : input.output.json,
    runAttemptPolicy: input.runAttemptPolicy,
    maximumDurationInSeconds: input.maximumDurationInSeconds,
    computeProfile: input.computeProfile,
    queue: input.queue,
  }).pipe(
    Result.map(manifest => Object.freeze({
      manifest,
      reference: new StandardApplicationTaskReference<
        InferStandardValidatorV1<PayloadValidator>,
        InferOutputValidatorV1<OutputValidator>
      >(manifest.taskId),
    })),
  );
}
