import type { EdgeActionExactRuntimeWorkerConfigurationV1 } from "./Configuration";

export const exactEdgeActionRuntimeConfigurationV1:
  EdgeActionExactRuntimeWorkerConfigurationV1 = Object.freeze({
  requestFormat: "flarex.edge-action-exact-runtime",
  requestVersion: 1,
  resultFormat: "flarex.edge-action-exact-runtime-result",
  resultVersion: 1,
  runtimeTargetSha256Hex: "0".repeat(64),
  hostPolicySha256Hex: "0".repeat(64),
  artifact: Object.freeze({
    runtime: "dynamic-worker",
    artifactId: "artifact_00000000000000000000000000000000",
    sourcePackageHash: "0".repeat(64),
    executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
  }),
  function: Object.freeze({
    path: "placeholder:action",
    executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
    kind: "action",
    visibility: "public",
    argsValidator: Object.freeze({ type: "any" }),
    returnsValidator: null,
  }),
  moduleEvaluationTime: 0,
  maximumSyscalls: 1,
  maximumArgumentBytes: 1,
  maximumResultBytes: 1,
  maximumCallbackArgumentBytes: 1,
  maximumCallbackResultBytes: 1,
});
