export {
  MAX_POINT_MUTATION_EXACT_RUNTIME_AUTH_SEMANTIC_BYTES_V1,
  POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1,
  POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
  PointMutationExactRuntimeProtocolV1Error,
  decodePointMutationExactRuntimeRequestV1Effect,
  decodePointMutationExactRuntimeResultV1Effect,
  type PointMutationExactRuntimeArtifactRefV1,
  type PointMutationExactRuntimeAuthV1,
  type PointMutationExactRuntimeFunctionV1,
  type PointMutationExactRuntimeRequestV1,
  type PointMutationExactRuntimeResultV1,
  type PointMutationExactRuntimeTableV1,
} from "./point-mutation-exact-runtime";

/**
 * SAP06-A3 reuses SAP04's root request/result value envelope while naming a
 * separately generated graph and syscall surface that can execute authenticated
 * same-attempt internal query and mutation calls. Earlier private profiles are
 * not widened.
 */
export const POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_PROFILE_V1 =
  "point-mutation-internal-call-exact-runtime-v1" as const;
export const POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_SYSCALL_ABI_V1 =
  "flarex.system/point-mutation-internal-call-syscall-abi/v1" as const;
export const POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_ENTRYPOINT_V1 =
  "FlarexPointMutationInternalCallExactRuntimeV1" as const;
export const POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_VERSION_V1 = 1 as const;
export {
  POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1 as POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1 as POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1 as POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_RESULT_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1 as POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_RESULT_VERSION_V1,
} from "./point-mutation-exact-runtime";

export type {
  PointMutationExactRuntimeArtifactRefV1 as PointMutationInternalCallExactRuntimeArtifactRefV1,
  PointMutationExactRuntimeFunctionV1 as PointMutationInternalCallExactRuntimeFunctionV1,
  PointMutationExactRuntimeRequestV1 as PointMutationInternalCallExactRuntimeRequestV1,
  PointMutationExactRuntimeResultV1 as PointMutationInternalCallExactRuntimeResultV1,
} from "./point-mutation-exact-runtime";

export const POINT_MUTATION_INTERNAL_CALL_MAXIMUM_CALLS_V1 = 64;
export const POINT_MUTATION_INTERNAL_CALL_MAXIMUM_DEPTH_V1 = 8;
export const POINT_MUTATION_INTERNAL_CALL_MAXIMUM_ARGUMENT_BYTES_V1 =
  8 * 1_048_576;
export const POINT_MUTATION_INTERNAL_CALL_MAXIMUM_RESULT_BYTES_V1 =
  8 * 1_048_576;
