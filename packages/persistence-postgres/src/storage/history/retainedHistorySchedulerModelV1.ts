/**
 * Package-internal storage policy for the inert retained-history scheduler.
 * The checkpoint is restart evidence only and grants no scope or deletion
 * authority.
 */
export const MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1 = 65_536;

export const RETAINED_HISTORY_SCHEDULER_KEY_V1 =
  "retained_history_maintenance_v1" as const;

export const RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1 = 1 as const;
