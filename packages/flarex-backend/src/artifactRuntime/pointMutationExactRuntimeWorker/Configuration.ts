export interface PointMutationExactRuntimeWorkerConfigurationV1 {
  readonly executionModule: string;
  readonly moduleEvaluationTime: number;
  readonly pinnedSourcePackageHash: string;
  readonly requestFormat: "flarex.point-mutation-exact-runtime";
  readonly requestVersion: 1;
  readonly resultFormat: "flarex.point-mutation-exact-runtime-result";
  readonly resultVersion: 1;
  readonly maxContextTextBytes: number;
  readonly maxAuthSemanticBytes: number;
  readonly randomSeedBytes: number;
  readonly maxArgumentArraySemanticBytes: number;
}
