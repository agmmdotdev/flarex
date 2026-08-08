import type {
  PointMutationExactRuntimeWorkerConfigurationV1,
} from "./Configuration.ts";

/**
 * Typechecking placeholder only.
 *
 * The build externalizes this module, and the trusted host supplies an
 * artifact-specific module with the same export at Worker Loader time.
 */
export const exactRuntimeConfigurationV1 = Object.freeze({
  executionModule: "_flarex/execution.js",
  moduleEvaluationTime: 1,
  pinnedSourcePackageHash: "0".repeat(64),
  requestFormat: "flarex.point-mutation-exact-runtime",
  requestVersion: 1,
  resultFormat: "flarex.point-mutation-exact-runtime-result",
  resultVersion: 1,
  hostResponseFormat: "flarex.point-mutation-exact-runtime-host-response",
  hostResponseVersion: 2,
  maxContextTextBytes: 512,
  maxAuthSemanticBytes: 64 * 1_024,
  randomSeedBytes: 32,
  maxArgumentArraySemanticBytes: 1 << 24,
} satisfies PointMutationExactRuntimeWorkerConfigurationV1);
