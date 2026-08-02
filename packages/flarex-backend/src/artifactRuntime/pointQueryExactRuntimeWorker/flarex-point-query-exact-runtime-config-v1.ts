import type { PointQueryExactRuntimeWorkerConfigurationV1 } from "./Configuration";

export const exactQueryRuntimeConfigurationV1 = Object.freeze({
  moduleEvaluationTime: 0,
  runtimeTargetSha256Hex: "0".repeat(64),
  requestFormat: "flarex.point-query-exact-runtime",
  requestVersion: 1,
  resultFormat: "flarex.point-query-exact-runtime-result",
  resultVersion: 1,
  randomSeedBytes: 32,
  artifact: Object.freeze({
    runtime: "dynamic-worker",
    artifactId: `artifact_${"0".repeat(32)}`,
    sourcePackageHash: "0".repeat(64),
    executionModule: "orders.js",
  }),
  function: Object.freeze({
    path: "orders:get",
    executionModule: "orders.js",
    kind: "query",
    visibility: "public",
    argsValidator: Object.freeze({ type: "any" }),
    returnsValidator: null,
  }),
  snapshotCommitSeq: 0n,
} satisfies PointQueryExactRuntimeWorkerConfigurationV1);
