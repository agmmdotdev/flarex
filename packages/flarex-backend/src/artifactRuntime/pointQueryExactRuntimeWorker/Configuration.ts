export interface PointQueryExactRuntimeWorkerConfigurationV1 {
  readonly moduleEvaluationTime: number;
  readonly runtimeTargetSha256Hex: string;
  readonly requestFormat: "flarex.point-query-exact-runtime";
  readonly requestVersion: 1;
  readonly resultFormat: "flarex.point-query-exact-runtime-result";
  readonly resultVersion: 1;
  readonly randomSeedBytes: 32;
  readonly artifact: Readonly<{
    readonly runtime: "dynamic-worker";
    readonly artifactId: string;
    readonly sourcePackageHash: string;
    readonly executionModule: string;
  }>;
  readonly function: Readonly<{
    readonly path: string;
    readonly executionModule: string;
    readonly kind: "query";
    readonly visibility: "public";
    readonly argsValidator: unknown;
    readonly returnsValidator: unknown;
  }>;
  readonly snapshotCommitSeq: bigint;
}
