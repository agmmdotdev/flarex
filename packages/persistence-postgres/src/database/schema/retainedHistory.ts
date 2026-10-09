import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1,
  RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1,
  RETAINED_HISTORY_SCHEDULER_KEY_V1,
} from "../../storage/history/retainedHistorySchedulerModelV1";
import { bytea } from "./primitives";

/**
 * Inert, database-owned restart progress for retained-history maintenance.
 * The singleton fence controls only checkpoint mutation; every cleanup page
 * still authenticates current located scope authority and its retained floor.
 */
export const fxSystemRetainedHistoryScheduler = pgTable(
  "fx_system_retained_history_scheduler",
  {
    schedulerKey: text("scheduler_key").primaryKey(),
    schedulerState: text("scheduler_state")
      .$type<"idle" | "claimed">()
      .notNull(),
    runFence: bigint("run_fence", { mode: "bigint" }).notNull(),
    checkpointSequence: bigint("checkpoint_sequence", {
      mode: "bigint",
    }).notNull(),
    runOwner: uuid("run_owner"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    continuationCodecVersion: integer("continuation_codec_version"),
    continuationBytes: bytea("continuation_bytes"),
    continuationSha256: bytea("continuation_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "fx_system_retained_history_scheduler_key_check",
      sql`${table.schedulerKey} = ${sql.raw(
        `'${RETAINED_HISTORY_SCHEDULER_KEY_V1}'`,
      )}`,
    ),
    check(
      "fx_system_retained_history_scheduler_state_check",
      sql`${table.schedulerState} in ('idle', 'claimed')`,
    ),
    check(
      "fx_system_retained_history_scheduler_fence_check",
      sql`${table.runFence} >= 0`,
    ),
    check(
      "fx_system_retained_history_scheduler_checkpoint_sequence_check",
      sql`${table.checkpointSequence} >= 0`,
    ),
    check(
      "fx_system_retained_history_scheduler_claim_check",
      sql`
        (
          ${table.schedulerState} = 'idle'
          and ${table.runOwner} is null
          and ${table.claimedAt} is null
          and ${table.claimExpiresAt} is null
        )
        or
        (
          ${table.schedulerState} = 'claimed'
          and ${table.runOwner} is not null
          and ${table.claimedAt} is not null
          and isfinite(${table.claimedAt})
          and ${table.claimExpiresAt} is not null
          and isfinite(${table.claimExpiresAt})
          and ${table.claimExpiresAt} > ${table.claimedAt}
        )
      `,
    ),
    check(
      "fx_system_retained_history_scheduler_continuation_check",
      sql`
        (
          ${table.continuationCodecVersion} is null
          and ${table.continuationBytes} is null
          and ${table.continuationSha256} is null
        )
        or
        (
          ${table.continuationCodecVersion} = ${sql.raw(
            String(RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1),
          )}
          and ${table.continuationBytes} is not null
          and octet_length(${table.continuationBytes}) between 1 and ${sql.raw(
            String(MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1),
          )}
          and ${table.continuationSha256} is not null
          and octet_length(${table.continuationSha256}) = 32
        )
      `,
    ),
    check(
      "fx_system_retained_history_scheduler_timestamp_check",
      sql`
        isfinite(${table.nextRunAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);
