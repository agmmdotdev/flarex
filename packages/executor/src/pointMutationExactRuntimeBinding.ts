import {
  makePointMutationExactRuntimeRunnerV1,
  type PointMutationExactRuntimeArtifactHostBindingV1,
} from "./pointMutationExactRuntimeRunner";
import type {
  PointMutationOccRuntimeNeutralRunnerV1,
} from "./storedAttemptAuthentication";

/**
 * Installs the private named artifact-runtime binding as the one
 * runtime-neutral runner used by the existing stored-attempt graph.
 *
 * Workers RPC does not expose a documented discriminator that separates a
 * propagated remote exception from a platform call failure. The production
 * adapter therefore classifies neither as an expected transport failure.
 * Bounded host failures cross the strict response protocol; every rejected
 * binding call remains a defect.
 */
export function makePointMutationExactRuntimeBindingRunnerV1(
  binding: PointMutationExactRuntimeArtifactHostBindingV1,
): PointMutationOccRuntimeNeutralRunnerV1 {
  return makePointMutationExactRuntimeRunnerV1({
    binding,
    isExpectedTransportFailure: () => false,
  });
}

export type {
  PointMutationExactRuntimeArtifactHostBindingV1,
} from "./pointMutationExactRuntimeRunner";
