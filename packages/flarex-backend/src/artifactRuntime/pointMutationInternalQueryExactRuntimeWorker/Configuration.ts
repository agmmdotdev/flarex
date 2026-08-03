export interface PointMutationInternalQueryExactRuntimeWorkerConfigurationV1 {
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
  readonly function: Readonly<{
    readonly path: string;
    readonly executionModule: string;
    readonly kind: "mutation";
    readonly visibility: "public";
    readonly argsValidator: unknown;
    readonly returnsValidator: unknown;
  }>;
  readonly rootFunctionOrdinal: number;
  readonly internalQueryCatalog: ReadonlyArray<Readonly<{
    readonly ordinal: number;
    readonly path: string;
    readonly kind: "query";
    readonly visibility: "internal";
    readonly argsValidator: unknown;
    readonly returnsValidator: unknown;
  }>>;
}
