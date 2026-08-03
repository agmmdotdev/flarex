export {
  MAX_POINT_QUERY_EXACT_RUNTIME_ARGUMENT_BYTES_V1,
  MAX_POINT_QUERY_EXACT_RUNTIME_AUTH_BYTES_V1,
  POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
  POINT_QUERY_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1,
  POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1,
  POINT_QUERY_EXACT_RUNTIME_RESULT_VERSION_V1,
  POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
  PointQueryExactRuntimeProtocolV1Error,
  decodePointQueryExactRuntimeRequestV1Effect,
  decodePointQueryExactRuntimeResultV1Effect,
  type PointQueryExactRuntimeArtifactRefV1,
  type PointQueryExactRuntimeAuthV1,
  type PointQueryExactRuntimeFunctionV1,
  type PointQueryExactRuntimeRequestV1,
  type PointQueryExactRuntimeResultV1,
  type PointQueryExactRuntimeTableV1,
} from "./point-query-exact-runtime";

/**
 * SAP06-A1 intentionally reuses SAP05's root request/result value envelope.
 * These identities name the separately generated internal-call-capable graph
 * and syscall surface; they never widen the frozen PQV-A2 V1 profile.
 */
export const POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_PROFILE_V1 =
  "point-query-internal-call-exact-runtime-v1" as const;
export const POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_SYSCALL_ABI_V1 =
  "flarex.system/point-query-internal-call-syscall-abi/v1" as const;
export const POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1 =
  "FlarexPointQueryInternalCallExactRuntimeV1" as const;
export const POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_VERSION_V1 = 1 as const;
export {
  POINT_QUERY_EXACT_RUNTIME_FORMAT_V1 as POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_FORMAT_V1,
  POINT_QUERY_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1 as POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1,
  POINT_QUERY_EXACT_RUNTIME_RESULT_FORMAT_V1 as POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_RESULT_FORMAT_V1,
  POINT_QUERY_EXACT_RUNTIME_RESULT_VERSION_V1 as POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_RESULT_VERSION_V1,
} from "./point-query-exact-runtime";

export type {
  PointQueryExactRuntimeArtifactRefV1 as PointQueryInternalCallExactRuntimeArtifactRefV1,
  PointQueryExactRuntimeFunctionV1 as PointQueryInternalCallExactRuntimeFunctionV1,
  PointQueryExactRuntimeRequestV1 as PointQueryInternalCallExactRuntimeRequestV1,
  PointQueryExactRuntimeResultV1 as PointQueryInternalCallExactRuntimeResultV1,
} from "./point-query-exact-runtime";

export const POINT_QUERY_INTERNAL_CALL_MAXIMUM_CALLS_V1 = 64;
export const POINT_QUERY_INTERNAL_CALL_MAXIMUM_DEPTH_V1 = 8;
export const POINT_QUERY_INTERNAL_CALL_MAXIMUM_ARGUMENT_BYTES_V1 = 8 * 1_048_576;
export const POINT_QUERY_INTERNAL_CALL_MAXIMUM_RESULT_BYTES_V1 = 8 * 1_048_576;
