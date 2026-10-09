/**
 * Package-internal storage policy for the inert Task repair scheduler row.
 * These values grant no claim, checkpoint, scope, or execution authority.
 */
export const MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1 = 4_194_304;

export const TASK_REPAIR_SCHEDULER_KEY_V1 = "durable_task_repair_v1" as const;

export const TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1 = 1 as const;
