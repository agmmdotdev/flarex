/**
 * Package-internal storage policy for the inert point-mutation redelivery
 * scheduler checkpoint. This value is neither a wire limit nor execution
 * authority. The repository and its cause-bearing errors remain unexported.
 */
export const MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1 =
  4_194_304;

export const POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1 =
  "point_mutation_redelivery_v1" as const;

export const POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1 =
  1 as const;
