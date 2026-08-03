import type {
  PointQueryInternalCallExactRuntimeArtifactRefV1,
  PointQueryInternalCallExactRuntimeFunctionV1,
} from "flarex-protocol/point-query-internal-call-exact-runtime";

export interface PointQueryInternalCallExactRuntimeWorkerConfigurationV1 {
  readonly moduleEvaluationTime: number;
  readonly runtimeTargetSha256Hex: string;
  readonly requestFormat: "flarex.point-query-exact-runtime";
  readonly requestVersion: 1;
  readonly resultFormat: "flarex.point-query-exact-runtime-result";
  readonly resultVersion: 1;
  readonly randomSeedBytes: 32;
  readonly artifact: PointQueryInternalCallExactRuntimeArtifactRefV1;
  readonly function: PointQueryInternalCallExactRuntimeFunctionV1;
  readonly rootFunctionOrdinal: number;
  readonly internalQueryCatalog: ReadonlyArray<Readonly<{
    readonly ordinal: number;
    readonly path: string;
    readonly kind: "query";
    readonly visibility: "internal";
    readonly argsValidator: PointQueryInternalCallExactRuntimeFunctionV1[
      "argsValidator"
    ];
    readonly returnsValidator: PointQueryInternalCallExactRuntimeFunctionV1[
      "returnsValidator"
    ];
  }>>;
  readonly snapshotCommitSeq: bigint;
}
