import type {
  PointMutationInternalCallExactRuntimeWorkerConfigurationV1,
} from "./Configuration.ts";

/** Typechecking placeholder; the trusted host supplies the exact literal module. */
export const exactRuntimeConfigurationV1 = Object.freeze({
  executionModule: "_flarex/execution.js",
  moduleEvaluationTime: 1,
  pinnedSourcePackageHash: "0".repeat(64),
  requestFormat: "flarex.point-mutation-exact-runtime",
  requestVersion: 1,
  resultFormat: "flarex.point-mutation-exact-runtime-result",
  resultVersion: 1,
  maxContextTextBytes: 512,
  maxAuthSemanticBytes: 64 * 1_024,
  randomSeedBytes: 32,
  maxArgumentArraySemanticBytes: 1 << 24,
  function: Object.freeze({
    path: "module:mutation",
    executionModule: "_flarex/execution.js",
    kind: "mutation",
    visibility: "public",
    argsValidator: Object.freeze({ type: "any" }),
    returnsValidator: null,
  }),
  rootFunctionOrdinal: 0,
  internalFunctionCatalog: Object.freeze([]),
} satisfies PointMutationInternalCallExactRuntimeWorkerConfigurationV1);
